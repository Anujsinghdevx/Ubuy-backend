import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import { Server, ServerOptions } from 'socket.io';
import { getRedisOptions } from '@/common/redis/redis.config';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter>;
  private readonly redisOptions: RedisOptions;

  constructor(
    appOrHttpServer: object,
    private readonly configService: ConfigService,
  ) {
    super(appOrHttpServer);
    this.redisOptions = getRedisOptions(this.configService);
  }

  async connectToRedis(): Promise<void> {
    const pubClient = new Redis({
      ...this.redisOptions,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });

    const subClient = new Redis({
      ...this.redisOptions,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });

    pubClient.on('error', (error) => {
      this.logger.warn(`Redis pub client error: ${error.message}`);
    });

    subClient.on('error', (error) => {
      this.logger.warn(`Redis sub client error: ${error.message}`);
    });

    await Promise.all([pubClient.connect(), subClient.connect()]);

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as unknown as Server;

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }

    return server;
  }
}
