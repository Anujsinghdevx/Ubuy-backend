import { ConfigService } from '@nestjs/config';
import { getRedisOptions } from './redis.config';

describe('getRedisOptions', () => {
  it('should parse REDIS_URL when configured', () => {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'REDIS_URL') {
          return 'rediss://user:pass@redis.example.com:6380/2';
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    expect(getRedisOptions(configService)).toEqual(
      expect.objectContaining({
        host: 'redis.example.com',
        port: 6380,
        username: 'user',
        password: 'pass',
        db: 2,
        tls: {},
      }),
    );
  });

  it('should fall back to host and port settings when REDIS_URL is absent', () => {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'REDIS_HOST') {
          return '127.0.0.1';
        }
        if (key === 'REDIS_PORT') {
          return '6379';
        }
        if (key === 'REDIS_USERNAME') {
          return 'redis-user';
        }
        if (key === 'REDIS_PASSWORD') {
          return 'redis-pass';
        }
        if (key === 'REDIS_DB') {
          return '3';
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    expect(getRedisOptions(configService)).toEqual({
      host: '127.0.0.1',
      port: 6379,
      username: 'redis-user',
      password: 'redis-pass',
      db: 3,
    });
  });
});
