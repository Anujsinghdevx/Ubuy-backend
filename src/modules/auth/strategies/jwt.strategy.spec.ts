import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '@/modules/users/users.service';

describe('JwtStrategy', () => {
  it('should throw when JWT_SECRET is missing', () => {
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    expect(() => new JwtStrategy(configService, {} as UsersService)).toThrow(
      'JWT_SECRET is not configured',
    );
  });

  it('should return user payload when user is verified', async () => {
    const configService = {
      get: jest.fn().mockReturnValue('secret'),
    } as unknown as ConfigService;
    const usersService = {
      findById: jest.fn().mockResolvedValue({
        _id: 'user-1',
        email: 'user@ubuy.dev',
        isVerified: true,
      }),
    } as unknown as UsersService;

    const strategy = new JwtStrategy(configService, usersService);

    await expect(strategy.validate({ sub: 'user-1', email: 'user@ubuy.dev' })).resolves.toEqual(
      {
        userId: 'user-1',
        email: 'user@ubuy.dev',
      },
    );
  });

  it('should throw UnauthorizedException when user is missing or unverified', async () => {
    const configService = {
      get: jest.fn().mockReturnValue('secret'),
    } as unknown as ConfigService;
    const usersService = {
      findById: jest.fn().mockResolvedValue({
        _id: 'user-1',
        email: 'user@ubuy.dev',
        isVerified: false,
      }),
    } as unknown as UsersService;

    const strategy = new JwtStrategy(configService, usersService);

    await expect(strategy.validate({ sub: 'user-1', email: 'user@ubuy.dev' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
