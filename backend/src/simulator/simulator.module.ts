import { Global, Module } from '@nestjs/common';
import { SimulatorService } from './simulator.service';

/** 全局唯一的节点模拟器实例：节点注入与计划下发必须操作同一份内存状态 */
@Global()
@Module({
  providers: [SimulatorService],
  exports: [SimulatorService],
})
export class SimulatorModule {}
