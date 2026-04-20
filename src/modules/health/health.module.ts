import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { RedisService } from '@/common/redis/redis.service';
import { ObservabilityModule } from '@/common/observability/observability.module';

@Module({
  imports: [ObservabilityModule],
  controllers: [HealthController],
  providers: [HealthService, RedisService],
})
export class HealthModule {}
