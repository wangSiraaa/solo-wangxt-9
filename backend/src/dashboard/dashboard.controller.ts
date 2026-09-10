import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Certificate } from '../entities/certificate.entity';
import { DeployNode } from '../entities/deploy-node.entity';
import { DeploymentPlan } from '../entities/deployment-plan.entity';
import { certStatusAt } from '../cert/cert.service';
import { coversDomain } from '../cert/crypto.util';

@Controller('api/dashboard')
export class DashboardController {
  constructor(
    @InjectRepository(Certificate)
    private readonly certRepo: Repository<Certificate>,
    @InjectRepository(DeployNode)
    private readonly nodeRepo: Repository<DeployNode>,
    @InjectRepository(DeploymentPlan)
    private readonly planRepo: Repository<DeploymentPlan>,
  ) {}

  @Get()
  async overview() {
    const now = new Date();
    const certs = await this.certRepo.find({ order: { notAfter: 'ASC' } });
    const nodes = await this.nodeRepo.find({ order: { type: 'ASC', name: 'ASC' } });
    const plans = await this.planRepo.find({ order: { createdAt: 'DESC' }, take: 10 });

    const expiryList = certs.map((c) => {
      const daysLeft = Math.ceil((c.notAfter.getTime() - now.getTime()) / 86400000);
      // 证书对每个受管域名的覆盖情况（近似：按 SAN 反推，节点域名实际匹配情况在矩阵给出）
      const onNodes = nodes.filter((n) => n.activeCertificateId === c.id);
      return {
        id: c.id,
        label: c.label,
        issuerCn: c.issuerCn,
        sanDomains: c.sanDomains,
        notAfter: c.notAfter,
        notBefore: c.notBefore,
        daysLeft,
        status: certStatusAt(c.notAfter, now),
        fingerprintSha256: c.fingerprintSha256,
        activeNodeCount: onNodes.length,
        activeNodes: onNodes.map((n) => n.name),
      };
    });

    const certMap = new Map(certs.map((c) => [c.id, c]));
    const nodeMatrix = nodes.map((n) => {
      const active = n.activeCertificateId ? certMap.get(n.activeCertificateId) ?? null : null;
      return {
        id: n.id,
        name: n.name,
        domain: n.domain,
        type: n.type,
        behavior: n.behavior,
        enabled: n.enabled,
        lastSeenAt: n.lastSeenAt,
        activeCertificateId: n.activeCertificateId,
        activeCertLabel: active?.label ?? null,
        activeFingerprintSha256: n.activeFingerprintSha256,
        activeSince: n.activeSince,
        activeStatus: active ? certStatusAt(active.notAfter, now) : null,
        activeDaysLeft: active
          ? Math.ceil((active.notAfter.getTime() - now.getTime()) / 86400000)
          : null,
        // 该节点可选的新版本：仍有效、覆盖域名、不是当前版本
        upgradeCount: certs.filter(
          (c) =>
            c.id !== n.activeCertificateId &&
            certStatusAt(c.notAfter, now) !== 'expired' &&
            coversDomain(c.sanDomains, n.domain),
        ).length,
      };
    });

    const counts = {
      expired: expiryList.filter((c) => c.status === 'expired').length,
      expiring: expiryList.filter((c) => c.status === 'expiring').length,
      valid: expiryList.filter((c) => c.status === 'valid').length,
      nodesRunningExpired: nodeMatrix.filter((n) => n.activeStatus === 'expired').length,
      nodesRunningExpiring: nodeMatrix.filter((n) => n.activeStatus === 'expiring').length,
      activePlans: plans.filter((p) =>
        ['draft', 'canary_running', 'awaiting_approval', 'bulk_running', 'paused', 'partial', 'canary_failed'].includes(p.status),
      ).length,
    };

    return { now, counts, expiryList, nodeMatrix, recentPlans: plans };
  }
}
