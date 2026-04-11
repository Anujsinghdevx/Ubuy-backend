import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';
import { RedisService } from '@/common/redis/redis.service';

describe('HealthService', () => {
  let service: HealthService;

  const configService = {
    get: jest.fn(),
  };

  const redisService = {
    ping: jest.fn(),
  };

  const mongoConnection = {
    readyState: 1,
    db: {
      admin: () => ({
        ping: jest.fn().mockResolvedValue({ ok: 1 }),
      }),
    },
    name: 'test-db',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.get.mockImplementation((key: string) => {
      if (key === 'MONGO_URI') {
        return 'mongodb://localhost:27017/test';
      }
      if (key === 'REDIS_URL') {
        return 'redis://localhost:6379';
      }
      return undefined;
    });
    redisService.ping.mockResolvedValue({ response: 'PONG', status: 'ready' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: 'DatabaseConnection', useValue: mongoConnection },
        { provide: RedisService, useValue: redisService },
        { provide: ConfigService, useValue: configService },
      ],
    })
      .overrideProvider('DatabaseConnection')
      .useValue(mongoConnection)
      .compile();

    service = module.get<HealthService>(HealthService);
  });

  it('should return ok when all health checks pass', async () => {
    const result = await service.getHealth();

    expect(result.status).toBe('ok');
    expect(result.checks.mongo.status).toBe('up');
    expect(result.checks.redis.status).toBe('up');
    expect(result.checks.config.status).toBe('up');
  });
});
