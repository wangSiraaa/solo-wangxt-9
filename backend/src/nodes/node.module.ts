import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployNode } from '../entities/deploy-node.entity';
import { ManagedDomain } from '../entities/managed-domain.entity';
import { Certificate } from '../entities/certificate.entity';
import { NodeService } from './node.service';
import { NodeController } from './node.controller';
import { CertModule } from '../cert/cert.module';

@Module({
  imports: [TypeOrmModule.forFeature([DeployNode, ManagedDomain, Certificate]), CertModule],
  providers: [NodeService],
  controllers: [NodeController],
  exports: [NodeService],
})
export class NodeModule {}
