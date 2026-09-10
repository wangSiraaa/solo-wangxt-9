import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { NodeService } from './node.service';
import { NodeBehavior } from '../domain.types';

class BehaviorDto {
  behavior: NodeBehavior;
}

@Controller('api/nodes')
export class NodeController {
  constructor(private readonly service: NodeService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post(':id/behavior')
  setBehavior(@Param('id') id: string, @Body() dto: BehaviorDto) {
    return this.service.setBehavior(id, dto.behavior);
  }

  /** 一次性注入：下一次下发按指定行为模拟 */
  @Post(':id/inject')
  inject(@Param('id') id: string, @Body() dto: BehaviorDto) {
    return this.service.injectOnce(id, dto.behavior);
  }

  @Post('simulator/reset')
  reset() {
    return this.service.resetAttempts();
  }

  @Get(':id/rollback-candidates')
  candidates(@Param('id') id: string) {
    return this.service.rollbackCandidates(id);
  }
}
