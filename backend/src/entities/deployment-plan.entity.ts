import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { randomUUID } from 'crypto';
import { PlanStatus } from '../domain.types';

/**
 * 一次证书轮换计划：把 newCertificateId 灰度发布到一组节点。
 * 推进顺序固定为 canary -> 人工确认 -> bulk -> 完成/暂停/回滚。
 */
@Entity('deployment_plans')
export class DeploymentPlan {
  @PrimaryColumn('uuid')
  id: string = randomUUID();

  @Column({ type: 'varchar', length: 200 })
  label: string;

  @Index()
  @Column({ type: 'uuid' })
  newCertificateId: string;

  /** 建计划时各节点的基线版本，用于判断节点实际版本是否被改动 */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  baseline: Record<string, { certificateId: string | null; fingerprint: string | null }>;

  /** 回滚目标证书快照（创建时锁定的有效匹配证书），key=nodeId */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  rollbackTargets: Record<string, { certificateId: string; fingerprint: string }>;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: PlanStatus;

  @Column({ type: 'timestamptz', nullable: true })
  canaryStartedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  bulkStartedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pausedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  /** 最近一次失败/暂停原因，供前端展示 */
  @Column({ type: 'varchar', length: 500, default: '' })
  lastMessage: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
