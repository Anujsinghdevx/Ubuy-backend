import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');

        if (redisUrl) {
          const parsedUrl = new URL(redisUrl);

          return {
            connection: {
              host: parsedUrl.hostname,
              port: Number(parsedUrl.port || 6379),
              username: parsedUrl.username || undefined,
              password: parsedUrl.password || undefined,
              tls: parsedUrl.protocol === 'rediss:' ? {} : undefined,
            },
          };
        }

        return {
          connection: {
            host: configService.get<string>('REDIS_HOST') ?? '127.0.0.1',
            port: Number(configService.get<string>('REDIS_PORT') ?? 6379),
            password: configService.get<string>('REDIS_PASSWORD') || undefined,
          },
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
