import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  WebSocketServer,
} from '@nestjs/websockets';
import { UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

import { WsJwtGuard } from '../../common/guards/ws-jwt.guard';
import { BidsService } from './bids.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

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

  constructor(private readonly bidsService: BidsService) {}

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
      throw new Error('Unauthorized user');
    }

    const auction = await this.bidsService.placeBid(
      user.userId,
      data.auctionId,
      data.amount,
    );

    return auction;
  }
}
