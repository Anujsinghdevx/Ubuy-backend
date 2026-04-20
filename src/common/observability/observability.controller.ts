import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ObservabilityMetricsService } from './observability-metrics.service';

@ApiTags('system')
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class ObservabilityController {
  constructor(
    private readonly observabilityMetricsService: ObservabilityMetricsService,
  ) {}

  @ApiOperation({ summary: 'Prometheus-style service metrics' })
  @ApiResponse({
    status: 200,
    description: 'Prometheus text exposition format',
    schema: {
      type: 'string',
      example:
        '# HELP ubuy_http_requests_total Total number of HTTP requests observed\n# TYPE ubuy_http_requests_total counter\nubuy_http_requests_total{method="GET",route="/health",status="200"} 1\n',
    },
  })
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Get()
  getMetrics() {
    return this.observabilityMetricsService.getPrometheusMetrics();
  }
}
