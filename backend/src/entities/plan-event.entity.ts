import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { randomUUID } from 'crypto';

/** 计划级操作审计流：创建 / 灰度 / 推进 / 暂停 / 超时 / 回滚 */
@Entity('plan_events')
export class PlanEvent {
  @PrimaryColumn('uuid')
  id: string = randomUUID();

  @Index()
  @Column({ type: 'uuid' })
  planId: string;

  @Column({ type: 'varchar', length: 30 })
  action: string;

  @Column({ type: 'varchar', length: 20, default: 'info' })
  level: 'info' | 'warn' | 'error';

  @Column({ type: 'varchar', length: 500, default: '' })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  detail: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  at: Date;
}
