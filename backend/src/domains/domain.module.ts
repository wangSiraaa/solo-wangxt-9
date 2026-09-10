import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManagedDomain } from '../entities/managed-domain.entity';
import { DomainController } from './domain.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ManagedDomain])],
  controllers: [DomainController],
  exports: [TypeOrmModule],
})
export class DomainModule {}
