import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { randomUUID } from 'crypto';
import { ItemStage, ItemStatus } from '../domain.types';

/** 计划内每个节点的发布状态机（正向发布与回滚共用） */
@Entity('deployment_items')
@Unique('uq_plan_node', ['planId', 'nodeId', 'isRollback'])
export class DeploymentItem {
  @PrimaryColumn('uuid')
  id: string = randomUUID();

  @Index()
  @Column({ type: 'uuid' })
  planId: string;

  @Index()
  @Column({ type: 'uuid' })
  nodeId: string;

  @Column({ type: 'varchar', length: 12 })
  stage: ItemStage;

  /** true 表示该行为回滚条目（targetCertificateId 为回滚目标） */
  @Column({ type: 'boolean', default: false })
  isRollback: boolean;

  /** 本条下发要部署到的证书（正向=计划新证书，回滚=回滚目标） */
  @Column({ type: 'uuid' })
  targetCertificateId: string;

  @Column({ type: 'varchar', length: 12, default: 'pending' })
  status: ItemStatus;

  /** 后端下发的请求令牌；节点回执必须携带，用于识别重复回执 */
  @Column({ type: 'varchar', length: 64 })
  requestToken: string;

  @Column({ type: 'timestamptz', nullable: true })
  dispatchedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  ackedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  /** 成功后节点实际生效的指纹（由节点回执自报） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  reportedFingerprintSha256: string | null;

  @Column({ type: 'varchar', length: 500, default: '' })
  errorMessage: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
