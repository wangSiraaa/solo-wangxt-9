import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Certificate } from '../entities/certificate.entity';
import { ManagedDomain } from '../entities/managed-domain.entity';
import { EXPIRY_WARN_DAYS, CertStatus } from '../domain.types';
import {
  assertNoPrivateKey,
  coversDomain,
  normalizeChainPem,
  parseChain,
  verifyChain,
} from './crypto.util';

export interface UploadResult {
  certificate: Certificate;
  coveredDomains: { name: string; covered: boolean }[];
}

export function certStatusAt(notAfter: Date, now: Date = new Date()): CertStatus {
  const ms = notAfter.getTime() - now.getTime();
  if (ms <= 0) return 'expired';
  if (ms <= EXPIRY_WARN_DAYS * 24 * 3600 * 1000) return 'expiring';
  return 'valid';
}

@Injectable()
export class CertService {
  constructor(
    @InjectRepository(Certificate)
    private readonly certRepo: Repository<Certificate>,
    @InjectRepository(ManagedDomain)
    private readonly domainRepo: Repository<ManagedDomain>,
  ) {}

  async list(): Promise<Certificate[]> {
    return this.certRepo.find({ order: { createdAt: 'DESC' } });
  }

  async get(id: string): Promise<Certificate> {
    const cert = await this.certRepo.findOne({ where: { id } });
    if (!cert) throw new NotFoundException('证书不存在');
    return cert;
  }

  /**
   * 上传新证书，三重核对：
   *  1) 有效期（叶子与链上所有 CA 当前必须有效）；
   *  2) 证书链（签名关系连续，链尾自签根）；
   *  3) 域名覆盖（必须覆盖至少一个受管域名，返回逐域名覆盖情况）。
   * 私钥内容直接拒绝；同一指纹（同一叶子证书）不可重复入库。
   */
  async uploadChainPem(pem: string, label: string, note = ''): Promise<UploadResult> {
    if (!pem || !pem.trim()) throw new BadRequestException('证书链内容为空');
    try {
      assertNoPrivateKey(pem);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    let parsed: ReturnType<typeof parseChain>;
    try {
      parsed = parseChain(pem);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const chainCheck = verifyChain(parsed);
    if (!chainCheck.valid) {
      throw new BadRequestException({
        message: '证书链校验失败',
        problems: chainCheck.problems,
      });
    }

    const domains = await this.domainRepo.find({ order: { name: 'ASC' } });
    const coveredDomains = domains.map((d) => ({
      name: d.name,
      covered: this.covers(parsed.sanDomains, d.name),
    }));
    if (domains.length > 0 && !coveredDomains.some((d) => d.covered)) {
      throw new BadRequestException({
        message: '域名覆盖不通过：证书 SAN 未覆盖任何受管域名',
        sanDomains: parsed.sanDomains,
        managedDomains: domains.map((d) => d.name),
      });
    }

    const dup = await this.certRepo.findOne({
      where: { fingerprintSha256: parsed.fingerprintSha256 },
    });
    if (dup) {
      throw new ConflictException({
        message: '同一叶子证书已存在（指纹重复），无需重复上传',
        certificateId: dup.id,
        fingerprintSha256: dup.fingerprintSha256,
      });
    }

    const entity = this.certRepo.create({
      label: label?.trim() || `证书 ${parsed.issuerCn}`,
      issuerCn: parsed.issuerCn,
      serialHex: parsed.serialHex,
      notBefore: parsed.notBefore,
      notAfter: parsed.notAfter,
      fingerprintSha256: parsed.fingerprintSha256,
      sanDomains: parsed.sanDomains,
      chainLength: parsed.chainLength,
      chainPem: normalizeChainPem(pem),
      status: certStatusAt(parsed.notAfter),
      uploadNote: note,
    });
    const saved = await this.certRepo.save(entity);
    return { certificate: saved, coveredDomains };
  }

  covers(sanDomains: string[], host: string): boolean {
    return coversDomain(sanDomains, host);
  }
}
