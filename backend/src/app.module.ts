import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CertModule } from './cert/cert.module';
import { DomainModule } from './domains/domain.module';
import { NodeModule } from './nodes/node.module';
import { DeploymentModule } from './deployment/deployment.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SimulatorModule } from './simulator/simulator.module';
import { NodeService } from './nodes/node.service';
import { CertService } from './cert/cert.service';
import { Certificate } from './entities/certificate.entity';
import { ManagedDomain } from './entities/managed-domain.entity';
import { DeployNode } from './entities/deploy-node.entity';
import { DeploymentPlan } from './entities/deployment-plan.entity';
import { DeploymentItem } from './entities/deployment-item.entity';
import { NodeReceipt } from './entities/node-receipt.entity';
import { PlanEvent } from './entities/plan-event.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5499),
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'tls_workbench',
      entities: [
        Certificate,
        ManagedDomain,
        DeployNode,
        DeploymentPlan,
        DeploymentItem,
        NodeReceipt,
        PlanEvent,
      ],
      synchronize: true,
      logging: false,
    }),
    CertModule,
    DomainModule,
    SimulatorModule,
    NodeModule,
    DeploymentModule,
    DashboardModule,
  ],
})
export class AppModule implements OnApplicationBootstrap {
  constructor(
    private readonly nodeService: NodeService,
    private readonly certService: CertService,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.SEED_DEMO !== 'false') {
      await this.nodeService.refreshStatuses();
      await this.nodeService.seedDemo(this.certService);
    }
  }
}
