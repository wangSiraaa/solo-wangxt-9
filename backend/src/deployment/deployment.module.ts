import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeploymentPlan } from '../entities/deployment-plan.entity';
import { DeploymentItem } from '../entities/deployment-item.entity';
import { DeployNode } from '../entities/deploy-node.entity';
import { NodeReceipt } from '../entities/node-receipt.entity';
import { PlanEvent } from '../entities/plan-event.entity';
import { Certificate } from '../entities/certificate.entity';
import { DeploymentService } from './deployment.service';
import { DeploymentController } from './deployment.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeploymentPlan,
      DeploymentItem,
      DeployNode,
      NodeReceipt,
      PlanEvent,
      Certificate,
    ]),
  ],
  providers: [DeploymentService],
  controllers: [DeploymentController],
  exports: [DeploymentService],
})
export class DeploymentModule {}
