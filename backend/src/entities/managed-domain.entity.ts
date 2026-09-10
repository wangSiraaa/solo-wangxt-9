import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { randomUUID } from 'crypto';

@Entity('managed_domains')
export class ManagedDomain {
  @PrimaryColumn('uuid')
  id: string = randomUUID();

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 500, default: '' })
  description: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
