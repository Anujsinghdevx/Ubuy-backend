import { Controller, Get, HttpStatus, Res, VERSION_NEUTRAL } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';
import { ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';

@ApiTags('system')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @ApiOperation({ summary: 'Service and dependency health check' })
  @ApiResponse({ status: 200, description: 'All systems healthy', example: { status: 'ok', timestamp: '2026-04-04T10:30:00Z', checks: { database: 'ok', redis: 'ok', memory: '45%' } } })
  @ApiResponse({ status: 503, description: 'One or more services unhealthy' })
  @Get()
  async check(@Res() response: Response) {
    const health = await this.healthService.getHealth();
    const statusCode =
      health.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;

    return response.status(statusCode).json(health);
  }
}
