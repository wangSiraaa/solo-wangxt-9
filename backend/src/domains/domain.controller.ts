import { Body, Controller, Get, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ManagedDomain } from '../entities/managed-domain.entity';

class CreateDomainDto {
  name: string;
  description?: string;
}

@Controller('api/domains')
export class DomainController {
  constructor(
    @InjectRepository(ManagedDomain)
    private readonly repo: Repository<ManagedDomain>,
  ) {}

  @Get()
  list() {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  @Post()
  async create(@Body() dto: CreateDomainDto) {
    const name = dto.name?.toLowerCase().trim();
    if (!name) return;
    const existing = await this.repo.findOne({ where: { name } });
    if (existing) return existing;
    return this.repo.save(
      this.repo.create({ name, description: dto.description ?? '' }),
    );
  }
}
