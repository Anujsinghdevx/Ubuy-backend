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

@UseGuards(WsJwtGuard)
@WebSocketGateway({
  cors: true,
})
export class BidsGateway {
  private readonly logger = new Logger(BidsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(forwardRef(() => BidsService))
    private readonly bidsService: BidsService,
  ) {}

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

    const user = client.data.user;

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
