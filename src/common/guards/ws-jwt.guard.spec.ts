import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ExecutionContext } from '@nestjs/common';
import { WsJwtGuard } from './ws-jwt.guard';

describe('WsJwtGuard', () => {
  let guard: WsJwtGuard;
  let jwtService: Pick<JwtService, 'verify'> & { verify: jest.Mock };

  const buildContext = (client: any): ExecutionContext =>
    ({
      switchToWs: () => ({
        getClient: () => client,
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jwtService = {
      verify: jest.fn(),
    };

    guard = new WsJwtGuard(jwtService as unknown as JwtService);
  });

  it('should throw UnauthorizedException when token is missing', () => {
    const client = {
      handshake: {
        auth: {},
        query: {},
        headers: {},
      },
      data: {},
    };

    expect(() => guard.canActivate(buildContext(client))).toThrow(
      UnauthorizedException,
    );
  });

  it('should use auth token and attach user payload', () => {
    jwtService.verify.mockReturnValue({
      sub: 'user-1',
      email: 'user@ubuy.dev',
    });

    const client = {
      handshake: {
        auth: { token: 'auth-token' },
        query: {},
        headers: {},
      },
      data: {},
    };

    const allowed = guard.canActivate(buildContext(client));

    expect(allowed).toBe(true);
    expect(jwtService.verify).toHaveBeenCalledWith('auth-token');
    expect((client.data as { user?: unknown }).user).toEqual({
      userId: 'user-1',
      email: 'user@ubuy.dev',
    });
  });

  it('should fallback to query token when auth token is not provided', () => {
    jwtService.verify.mockReturnValue({
      sub: 'user-2',
      email: 'query@ubuy.dev',
    });

    const client = {
      handshake: {
        auth: {},
        query: { token: 'query-token' },
        headers: {},
      },
      data: {},
    };

    const allowed = guard.canActivate(buildContext(client));

    expect(allowed).toBe(true);
    expect(jwtService.verify).toHaveBeenCalledWith('query-token');
  });

  it('should throw UnauthorizedException when token verification fails', () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('invalid token');
    });

    const client = {
      handshake: {
        auth: {},
        query: {},
        headers: {
          authorization: 'Bearer invalid-token',
        },
      },
      data: {},
    };

    expect(() => guard.canActivate(buildContext(client))).toThrow(
      UnauthorizedException,
    );
  });
});
