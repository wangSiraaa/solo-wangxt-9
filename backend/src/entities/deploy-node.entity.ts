import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { randomUUID } from 'crypto';
import { NodeBehavior, NodeType } from '../domain.types';

@Entity('deploy_nodes')
export class DeployNode {
  @PrimaryColumn('uuid')
  id: string = randomUUID();

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** 节点负责服务的域名（决定可部署哪些证书） */
  @Column({ type: 'varchar', length: 255 })
  domain: string;

  @Column({ type: 'varchar', length: 12, default: 'bulk' })
  type: NodeType;

  @Column({ type: 'varchar', length: 16, default: 'success' })
  behavior: NodeBehavior;

  /** 节点当前实际运行版本；null 表示从未部署过 */
  @Column({ type: 'uuid', nullable: true })
  activeCertificateId: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  activeFingerprintSha256: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  activeSince: Date | null;

  /** 节点模拟器最近一次活动时间 */
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
