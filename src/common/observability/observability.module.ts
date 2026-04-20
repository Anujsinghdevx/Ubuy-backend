import { Module } from '@nestjs/common';
import { ObservabilityController } from './observability.controller';
import { ObservabilityMetricsService } from './observability-metrics.service';

@Module({
  controllers: [ObservabilityController],
  providers: [ObservabilityMetricsService],
  exports: [ObservabilityMetricsService],
})
export class ObservabilityModule {}
