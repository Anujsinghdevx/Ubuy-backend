import { ConfigService } from '@nestjs/config';
import { RedisOptions } from 'ioredis';

export function getRedisOptions(configService: ConfigService): RedisOptions {
  const redisUrl = configService.get<string>('REDIS_URL');

  if (redisUrl) {
    const parsedUrl = new URL(redisUrl);
    const dbFromPath = parsedUrl.pathname.replace('/', '');

    return {
      host: parsedUrl.hostname,
      port: Number(parsedUrl.port || 6379),
      username: parsedUrl.username || undefined,
      password: parsedUrl.password || undefined,
      db: dbFromPath ? Number(dbFromPath) : undefined,
      tls: parsedUrl.protocol === 'rediss:' ? {} : undefined,
    };
  }

  return {
    host: configService.get<string>('REDIS_HOST') ?? '127.0.0.1',
    port: Number(configService.get<string>('REDIS_PORT') ?? 6379),
    username: configService.get<string>('REDIS_USERNAME') || undefined,
    password: configService.get<string>('REDIS_PASSWORD') || undefined,
    db: Number(configService.get<string>('REDIS_DB') ?? 0),
  };
}
