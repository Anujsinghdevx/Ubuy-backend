import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  WebSocketServer,
  WsException,
  Ack,
} from '@nestjs/websockets';
import { Logger, forwardRef, Inject, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

import { WsJwtGuard } from '@/common/guards/ws-jwt.guard';
import { BidsService } from './bids.service';
import { AuthenticatedUser } from '@/common/decorators/current-user.decorator';

type AuthenticatedSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  {
    user?: AuthenticatedUser;
  }
>;

@WebSocketGateway({
  cors: true,
})
export class BidsGateway {
  private readonly logger = new Logger(BidsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(forwardRef(() => BidsService))
    private readonly bidsService: BidsService,
    private readonly jwtService: JwtService,
  ) {}

  private tryHydrateUserFromHandshake(client: AuthenticatedSocket) {
    if (client.data.user?.userId) {
      return client.data.user;
    }

    const authToken: unknown = client.handshake.auth?.token;
    const queryToken: unknown = client.handshake.query?.token;
    const bearerToken: unknown =
      client.handshake.headers.authorization?.split(' ')[1];

    const normalizedQueryToken =
      typeof queryToken === 'string'
        ? queryToken
        : Array.isArray(queryToken) && typeof queryToken[0] === 'string'
          ? queryToken[0]
          : undefined;

    const token =
      typeof authToken === 'string'
        ? authToken
        : typeof bearerToken === 'string'
          ? bearerToken
          : normalizedQueryToken;

    if (!token) {
      return undefined;
    }

    try {
      const payload = this.jwtService.verify<{ sub: string; email: string }>(token);
      client.data.user = {
        userId: payload.sub,
        email: payload.email,
      };

      return client.data.user;
    } catch {
      return undefined;
    }
  }

  @SubscribeMessage('joinAuction')
  async handleJoinAuction(
    @MessageBody() payload: string | { auctionId?: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const auctionId =
      typeof payload === 'string' ? payload : payload?.auctionId ?? '';

    if (!auctionId) {
      throw new WsException('auctionId is required');
    }

    const user = this.tryHydrateUserFromHandshake(client);

    if (user?.userId) {
      await client.join(`user:${user.userId}`);
    }

    await client.join(auctionId);

    return { message: `Joined auction ${auctionId}` };
  }

  @SubscribeMessage('leaveAuction')
  async handleLeaveAuction(
    @MessageBody() payload: string | { auctionId?: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const auctionId =
      typeof payload === 'string' ? payload : payload?.auctionId ?? '';

    if (!auctionId) {
      throw new WsException('auctionId is required');
    }

    await client.leave(auctionId);

    return { message: `Left auction ${auctionId}` };
  }

  @SubscribeMessage('placeBid')
  @UseGuards(WsJwtGuard)
  async handlePlaceBid(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: { auctionId?: string; amount?: number | string } | undefined,
    @Ack() ack?: (response: unknown) => void,
  ) {
    const user = client.data.user;

    if (!user) {
      const message = 'Unauthorized user';

      if (ack) {
        ack({ ok: false, error: message });
        return;
      }

      throw new WsException(message);
    }

    const auctionId = typeof data?.auctionId === 'string' ? data.auctionId : '';
    const normalizedAmount =
      typeof data?.amount === 'number'
        ? data.amount
        : typeof data?.amount === 'string'
          ? Number(data.amount)
          : Number.NaN;

    if (!auctionId) {
      const message = 'auctionId is required';

      if (ack) {
        ack({ ok: false, error: message });
        return;
      }

      throw new WsException(message);
    }

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      const message = 'amount must be a number greater than 0';

      if (ack) {
        ack({ ok: false, error: message });
        return;
      }

      throw new WsException(message);
    }

    try {
      const auction = await this.bidsService.placeBid(
        user.userId,
        auctionId,
        normalizedAmount,
      );

      const response = { ok: true, data: auction };

      if (ack) {
        ack(response);
        return;
      }

      return response;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to place bid';

      this.logger.warn(
        `Bid rejected for auction ${auctionId}: ${message} (user ${user.userId})`,
      );

      if (ack) {
        ack({ ok: false, error: message });
        return;
      }

      throw new WsException(message);
    }
  }
}
