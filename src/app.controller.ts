import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('system')
@Controller({ version: VERSION_NEUTRAL })
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: 'Service status and quick links' })
  @ApiResponse({ status: 200, description: 'Service status', example: { status: 'ok', message: 'Ubuy backend is running', service: 'Ubuy Backend', environment: 'development', uptime: 1234.56 } })
  @Get()
  getRootStatus() {
    return this.appService.getRootStatus();
  }

  @ApiOperation({ summary: 'API discovery index' })
  @ApiResponse({ status: 200, description: 'Full API index', example: { status: 'ok', message: 'API discovery document', endpoints: { auth: [{ method: 'POST', path: '/v1/auth/signup' }] }, websockets: ['joinAuction', 'placeBid'] } })
  @Get('api-info')
  getApiInfo() {
    return this.appService.getApiInfo();
  }
}
