import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { randomUUID } from 'crypto';
import { ReceiptKind } from '../domain.types';

/** 节点回执流水：每条都记录，重复回执不覆盖既有结果 */
@Entity('node_receipts')
export class NodeReceipt {
  @PrimaryColumn('uuid')
  id: string = randomUUID();

  @Index()
  @Column({ type: 'uuid' })
  planId: string;

  @Index()
  @Column({ type: 'uuid' })
  nodeId: string;

  @Column({ type: 'varchar', length: 64 })
  requestToken: string;

  @Column({ type: 'varchar', length: 12 })
  kind: ReceiptKind;

  /** 节点自报当前指纹；可能与目标不一致（部分成功 / 旧版重复回执） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  fingerprintSha256: string | null;

  @Column({ type: 'varchar', length: 500, default: '' })
  message: string;

  /** false 表示该回执被识别为重复或过期令牌，未驱动状态机 */
  @Column({ type: 'boolean', default: true })
  accepted: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  receivedAt: Date;
}
