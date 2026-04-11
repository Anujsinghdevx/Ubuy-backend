import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisService } from './redis.service';
import { getRedisOptions } from './redis.config';

jest.mock('ioredis', () => jest.fn());
jest.mock('./redis.config', () => ({
  getRedisOptions: jest.fn(),
}));

describe('RedisService', () => {
  const RedisMock = Redis as unknown as jest.Mock;
  const getRedisOptionsMock = getRedisOptions as jest.Mock;
  let redisClient: any;

  const configService = {} as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    redisClient = {
      status: 'wait',
      connect: jest.fn().mockImplementation(async () => {
        redisClient.status = 'ready';
      }),
      ping: jest.fn().mockResolvedValue('PONG'),
      quit: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
      on: jest.fn(),
    };
    RedisMock.mockImplementation(() => redisClient);
    getRedisOptionsMock.mockReturnValue({ host: '127.0.0.1', port: 6379 });
  });

  it('should connect lazily and return ping result', async () => {
    const service = new RedisService(configService);

    await expect(service.ping()).resolves.toEqual({
      response: 'PONG',
      status: 'ready',
    });
    expect(redisClient.connect).toHaveBeenCalled();
  });

  it('should quit ready redis client on shutdown', async () => {
    redisClient.status = 'ready';
    const service = new RedisService(configService);

    await service.onApplicationShutdown();
    expect(redisClient.quit).toHaveBeenCalled();
  });
});
