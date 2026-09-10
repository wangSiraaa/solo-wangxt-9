import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Certificate } from '../entities/certificate.entity';
import { ManagedDomain } from '../entities/managed-domain.entity';
import { CertService } from './cert.service';
import { CertController } from './cert.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Certificate, ManagedDomain])],
  providers: [CertService],
  controllers: [CertController],
  exports: [CertService, TypeOrmModule],
})
export class CertModule {}
