import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { forwardRef, Inject, UseGuards } from '@nestjs/common';
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
  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(forwardRef(() => BidsService))
    private readonly bidsService: BidsService,
  ) {}

  @SubscribeMessage('joinAuction')
  async handleJoinAuction(
    @MessageBody() auctionId: string,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    await client.join(auctionId);

    return { message: `Joined auction ${auctionId}` };
  }

  @SubscribeMessage('leaveAuction')
  async handleLeaveAuction(
    @MessageBody() auctionId: string,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    await client.leave(auctionId);

    return { message: `Left auction ${auctionId}` };
  }

  @SubscribeMessage('placeBid')
  async handlePlaceBid(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { auctionId: string; amount: number },
  ) {
    const user = client.data.user;

    if (!user) {
      throw new WsException('Unauthorized user');
    }

    if (!data || typeof data.auctionId !== 'string') {
      throw new WsException('auctionId is required');
    }

    if (typeof data.amount !== 'number' || data.amount <= 0) {
      throw new WsException('amount must be a number greater than 0');
    }

    try {
      const auction = await this.bidsService.placeBid(
        user.userId,
        data.auctionId,
        data.amount,
      );

      return auction;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to place bid';
      throw new WsException(message);
    }
  }
}
