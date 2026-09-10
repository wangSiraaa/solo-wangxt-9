import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Certificate } from '../entities/certificate.entity';
import { DeployNode } from '../entities/deploy-node.entity';
import { DeploymentPlan } from '../entities/deployment-plan.entity';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Certificate, DeployNode, DeploymentPlan])],
  controllers: [DashboardController],
})
export class DashboardModule {}
