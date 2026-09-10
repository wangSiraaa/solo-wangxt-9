import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { DeploymentService } from './deployment.service';

class CreatePlanDto {
  label?: string;
  certificateId: string;
  nodeIds: string[];
}

@Controller('api/plans')
export class DeploymentController {
  constructor(private readonly service: DeploymentService) {}

  @Get()
  list() {
    return this.service.listPlans();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.service.getPlan(id);
  }

  @Post()
  create(@Body() dto: CreatePlanDto) {
    return this.service.createPlan({
      label: dto.label ?? '',
      certificateId: dto.certificateId,
      nodeIds: dto.nodeIds,
    });
  }

  @Post(':id/canary')
  startCanary(@Param('id') id: string) {
    return this.service.startCanary(id);
  }

  @Post(':id/advance')
  advance(@Param('id') id: string) {
    return this.service.advanceBulk(id);
  }

  @Post(':id/pause')
  pause(@Param('id') id: string) {
    return this.service.pause(id);
  }

  @Post(':id/resume')
  resume(@Param('id') id: string) {
    return this.service.resume(id);
  }

  @Post(':id/rollback')
  rollback(@Param('id') id: string) {
    return this.service.rollback(id);
  }

  @Post(':id/items/:itemId/retry')
  retryItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.retryItem(id, itemId);
  }
}
