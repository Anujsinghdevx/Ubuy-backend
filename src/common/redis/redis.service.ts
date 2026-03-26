import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { getRedisOptions } from './redis.config';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly configService: ConfigService) {
    this.client = this.createClient();
  }

  private createClient() {
    const redisClient = new Redis({
      ...getRedisOptions(this.configService),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });

    redisClient.on('error', (error) => {
      this.logger.warn(`Redis client error: ${error.message}`);
    });

    return redisClient;
  }

  private async ensureConnected() {
    if (this.client.status === 'end' || this.client.status === 'close') {
      this.client = this.createClient();
    }

    if (this.client.status === 'wait') {
      await this.client.connect();
    }

    return this.client;
  }

  async ping() {
    const client = await this.ensureConnected();
    const response = await client.ping();

    return {
      response,
      status: client.status,
    };
  }

  getClient() {
    return this.client;
  }
}
