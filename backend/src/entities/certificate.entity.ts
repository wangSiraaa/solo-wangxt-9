import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { randomUUID } from 'crypto';
import { CertStatus } from '../domain.types';

/**
 * 仅保存证书元数据与证书链 PEM（公钥材料）。
 * 系统设计上不接收、不存储任何私钥。
 */
@Entity('certificates')
export class Certificate {
  @PrimaryColumn('uuid')
  id: string = randomUUID();

  @Column({ type: 'varchar', length: 200 })
  label: string;

  /** 叶子证书签发者 CN（来自链中签发叶子的证书） */
  @Column({ type: 'varchar', length: 255 })
  issuerCn: string;

  @Column({ type: 'varchar', length: 128 })
  serialHex: string;

  @Column({ type: 'timestamptz' })
  notBefore: Date;

  @Column({ type: 'timestamptz' })
  notAfter: Date;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  fingerprintSha256: string;

  /** 叶子证书 SAN 中的全部 DNS 名（含通配符） */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  sanDomains: string[];

  /** 链中证书数量（叶子 + 中间 + 根） */
  @Column({ type: 'int' })
  chainLength: number;

  /** 上传时提交的完整链 PEM：叶子 -> 中间 -> 根 */
  @Column({ type: 'text' })
  chainPem: string;

  @Column({ type: 'varchar', length: 16, default: 'valid' })
  status: CertStatus;

  @Column({ type: 'varchar', length: 500, default: '' })
  uploadNote: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
