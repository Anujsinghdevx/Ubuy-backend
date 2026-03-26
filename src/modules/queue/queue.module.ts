import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getRedisOptions } from '@/common/redis/redis.config';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: getRedisOptions(configService),
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
