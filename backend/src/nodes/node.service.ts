import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DeployNode } from '../entities/deploy-node.entity';
import { ManagedDomain } from '../entities/managed-domain.entity';
import { Certificate } from '../entities/certificate.entity';
import { SimulatorService } from '../simulator/simulator.service';
import { certStatusAt } from '../cert/cert.service';
import { NodeBehavior, NodeType } from '../domain.types';
import { coversDomain } from '../cert/crypto.util';

interface NodeSeed {
  name: string;
  domain: string;
  type: NodeType;
  behavior: NodeBehavior;
}

const DOMAIN_SEEDS = [
  { name: 'api.example.com', description: '对外 API' },
  { name: 'www.example.com', description: '官网' },
  { name: 'internal.example.com', description: '内部管理面' },
];

const NODE_SEEDS: NodeSeed[] = [
  { name: 'canary-shanghai-01', domain: 'api.example.com', type: 'canary', behavior: 'success' },
  { name: 'edge-beijing-01', domain: 'api.example.com', type: 'bulk', behavior: 'success' },
  { name: 'edge-guangzhou-02', domain: 'www.example.com', type: 'bulk', behavior: 'timeout' },
  { name: 'edge-chengdu-03', domain: 'internal.example.com', type: 'bulk', behavior: 'flaky' },
  { name: 'edge-shenzhen-04', domain: 'www.example.com', type: 'bulk', behavior: 'duplicate' },
];

@Injectable()
export class NodeService {
  constructor(
    @InjectRepository(DeployNode)
    private readonly nodeRepo: Repository<DeployNode>,
    @InjectRepository(Certificate)
    private readonly certRepo: Repository<Certificate>,
    @InjectRepository(ManagedDomain)
    private readonly domainRepo: Repository<ManagedDomain>,
    private readonly simulator: SimulatorService,
  ) {}

  async list() {
    const nodes = await this.nodeRepo.find({ order: { type: 'ASC', name: 'ASC' } });
    const certs = await this.certRepo.find();
    const certMap = new Map(certs.map((c) => [c.id, c]));
    return nodes.map((n) => ({
      ...n,
      activeCert: n.activeCertificateId ? certMap.get(n.activeCertificateId) ?? null : null,
      attemptCount: this.simulator.getAttemptCount(n.id),
    }));
  }

  async setBehavior(id: string, behavior: NodeBehavior) {
    const node = await this.nodeRepo.findOne({ where: { id } });
    if (!node) throw new NotFoundException('节点不存在');
    node.behavior = behavior;
    await this.nodeRepo.save(node);
    return node;
  }

  /** 测试钩子：让节点下一次下发表现为指定行为（一次性） */
  async injectOnce(id: string, behavior: NodeBehavior) {
    const node = await this.nodeRepo.findOne({ where: { id } });
    if (!node) throw new NotFoundException('节点不存在');
    this.simulator.setOverride(id, behavior);
    return { nodeId: id, nextBehavior: behavior, oneShot: true };
  }

  async resetAttempts(id?: string) {
    this.simulator.resetAttempts(id);
    return { ok: true };
  }

  /**
   * 幂等初始化演示数据：
   *  - 3 个受管域名；
   *  - 1 张"即将到期"的 v2 证书（从 fixtures 上传，等同于用户上传，走同样校验）；
   *  - 5 个节点，全部先运行 v2；
   * v1（已过期）不入库，仅作为 fixtures 供上传尝试观察拒绝效果。
   */
  async seedDemo(certService: {
    uploadChainPem(
      pem: string,
      label: string,
      note?: string,
    ): Promise<{ certificate: Certificate }>;
  }) {
    for (const d of DOMAIN_SEEDS) {
      const exists = await this.domainRepo.findOne({ where: { name: d.name } });
      if (!exists) await this.domainRepo.save(this.domainRepo.create(d));
    }

    let v2 = await this.certRepo
      .createQueryBuilder('c')
      .where('LOWER(c.label) = :l', { l: 'v2-即将到期' })
      .getOne();
    if (!v2) {
      const pem = readFileSync(join(__dirname, '..', '..', 'fixtures', 'chain-v2.pem'), 'utf8');
      const res = await certService.uploadChainPem(pem, 'v2-即将到期', '初始化种子：18 天后到期，当前生产版本');
      v2 = res.certificate;
    }

    for (const s of NODE_SEEDS) {
      const exists = await this.nodeRepo.findOne({ where: { name: s.name } });
      if (!exists) {
        await this.nodeRepo.save(
          this.nodeRepo.create({
            name: s.name,
            domain: s.domain,
            type: s.type,
            behavior: s.behavior,
            activeCertificateId: v2.id,
            activeFingerprintSha256: v2.fingerprintSha256,
            activeSince: new Date(),
            lastSeenAt: new Date(),
          }),
        );
      }
    }
    return { ok: true };
  }

  /** 过期巡检：刷新证书状态字段，供到期清单展示 */
  async refreshStatuses() {
    const certs = await this.certRepo.find();
    for (const c of certs) {
      const s = certStatusAt(c.notAfter);
      if (s !== c.status) await this.certRepo.update(c.id, { status: s });
    }
  }

  /** 哪些证书可以回滚到某节点：仍有效且域名匹配 */
  async rollbackCandidates(nodeId: string) {
    const node = await this.nodeRepo.findOne({ where: { id: nodeId } });
    if (!node) throw new NotFoundException('节点不存在');
    const certs = await this.certRepo.find({ order: { createdAt: 'DESC' } });
    return certs
      .filter((c) => certStatusAt(c.notAfter) !== 'expired')
      .filter((c) => coversDomain(c.sanDomains, node.domain))
      .map((c) => ({
        id: c.id,
        label: c.label,
        fingerprintSha256: c.fingerprintSha256,
        notAfter: c.notAfter,
        activeOnNode: c.id === node.activeCertificateId,
      }));
  }
}
