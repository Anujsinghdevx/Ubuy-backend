import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

type WsSocketData = {
  user?: AuthenticatedUser;
};

type WsJwtPayload = {
  sub: string;
  email: string;
};

type AuthenticatedSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  WsSocketData
>;

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<AuthenticatedSocket>();
    const authToken: unknown = client.handshake.auth?.token;
    const bearerToken: unknown =
      client.handshake.headers.authorization?.split(' ')[1];

    const token =
      typeof authToken === 'string'
        ? authToken
        : typeof bearerToken === 'string'
          ? bearerToken
          : undefined;

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      const payload = this.jwtService.verify<WsJwtPayload>(token);

      client.data.user = {
        userId: payload.sub,
        email: payload.email,
      };

      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
