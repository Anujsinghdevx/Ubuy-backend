import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { RedisService } from '@/common/redis/redis.service';
import { Connection } from 'mongoose';

type HealthState = 'up' | 'down';

interface HealthCheckResult {
  status: HealthState;
  details?: Record<string, unknown>;
  error?: string;
}

@Injectable()
export class HealthService {
  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async getHealth() {
    const [mongo, redis, config, memory, backend] = await Promise.all([
      this.checkMongo(),
      this.checkRedis(),
      this.checkConfig(),
      Promise.resolve(this.checkMemory()),
      Promise.resolve(this.checkBackend()),
    ]);

    const checks = {
      backend,
      mongo,
      redis,
      config,
      memory,
    };

    const isHealthy = Object.values(checks).every(
      (check) => check.status === 'up',
    );

    return {
      status: isHealthy ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private checkBackend(): HealthCheckResult {
    return {
      status: 'up',
      details: {
        uptimeSeconds: Number(process.uptime().toFixed(2)),
        nodeVersion: process.version,
        pid: process.pid,
      },
    };
  }

  private async checkMongo(): Promise<HealthCheckResult> {
    try {
      if (this.mongoConnection.readyState !== 1) {
        return {
          status: 'down',
          error: `Mongo connection state is ${this.mongoConnection.readyState}`,
        };
      }

      if (!this.mongoConnection.db) {
        return {
          status: 'down',
          error: 'Mongo DB handle is not initialized',
        };
      }

      const pingResponse = await this.mongoConnection.db.admin().ping();

      return {
        status: pingResponse.ok === 1 ? 'up' : 'down',
        details: {
          readyState: this.mongoConnection.readyState,
          dbName: this.mongoConnection.name,
          pingOk: pingResponse.ok,
        },
      };
    } catch (error) {
      return {
        status: 'down',
        error: error instanceof Error ? error.message : 'Unknown Mongo error',
      };
    }
  }

  private async checkRedis(): Promise<HealthCheckResult> {
    try {
      const pingResult = await this.redisService.ping();

      return {
        status: pingResult.response === 'PONG' ? 'up' : 'down',
        details: {
          response: pingResult.response,
          redisStatus: pingResult.status,
        },
      };
    } catch (error) {
      return {
        status: 'down',
        error: error instanceof Error ? error.message : 'Unknown Redis error',
      };
    }
  }

  private checkConfig(): HealthCheckResult {
    const requiredKeys = ['MONGO_URI'];

    const missingRequired = requiredKeys.filter(
      (key) => !this.configService.get<string>(key),
    );

    if (missingRequired.length > 0) {
      return {
        status: 'down',
        error: `Missing configuration: ${missingRequired.join(', ')}`,
      };
    }

    const redisUrl = this.configService.get<string>('REDIS_URL');
    const redisHost = this.configService.get<string>('REDIS_HOST') ?? '127.0.0.1';
    const redisPort = Number(this.configService.get<string>('REDIS_PORT') ?? 6379);

    return {
      status: 'up',
      details: {
        requiredPresent: true,
        redisConfigSource: redisUrl ? 'REDIS_URL' : 'REDIS_HOST/REDIS_PORT defaults',
        redisHost,
        redisPort,
      },
    };
  }

  private checkMemory(): HealthCheckResult {
    const used = process.memoryUsage();
    const heapUsedMb = used.heapUsed / 1024 / 1024;
    const rssMb = used.rss / 1024 / 1024;

    return {
      status: 'up',
      details: {
        heapUsedMb: Number(heapUsedMb.toFixed(2)),
        rssMb: Number(rssMb.toFixed(2)),
      },
    };
  }
}
