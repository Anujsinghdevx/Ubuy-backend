import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  WebSocketServer,
  WsException,
  Ack,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, forwardRef, Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

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
export class BidsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(BidsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(forwardRef(() => BidsService))
    private readonly bidsService: BidsService,
    private readonly jwtService: JwtService,
  ) {}

  afterInit(server: Server) {
    server.engine.on('connection_error', (error: Error & { code?: string }) => {
      this.logger.warn(
        JSON.stringify({
          event: 'socket_connection_error',
          code: error.code,
          message: error.message,
        }),
      );
    });
  }

  handleConnection(client: AuthenticatedSocket) {
    const user = this.tryHydrateUserFromHandshake(client);

    this.logger.log(
      JSON.stringify({
        event: 'socket_connected',
        socketId: client.id,
        userId: user?.userId,
        transport: client.conn.transport.name,
        hasAuthToken: typeof client.handshake.auth?.token === 'string',
      }),
    );
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.warn(
      JSON.stringify({
        event: 'socket_disconnected',
        socketId: client.id,
        userId: client.data.user?.userId,
        reason: 'unknown',
      }),
    );
  }

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
      const payload = this.jwtService.verify<{ sub: string; email: string }>(
        token,
      );
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
      typeof payload === 'string' ? payload : (payload?.auctionId ?? '');

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
      typeof payload === 'string' ? payload : (payload?.auctionId ?? '');

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
    const ackProvided = typeof ack === 'function';
    let ackSent = false;
    let stage: 'auth' | 'validation' | 'service' | 'unexpected' = 'unexpected';
    let userIdForLogs = 'anonymous';
    let auctionIdForLogs =
      typeof data?.auctionId === 'string' ? data.auctionId : undefined;

    const sendAckOnce = (response: {
      ok: boolean;
      data?: unknown;
      error?: string;
    }) => {
      if (!ackProvided || !ack) {
        this.logger.warn(
          JSON.stringify({
            event: 'placeBid',
            socketId: client.id,
            stage,
            userId: userIdForLogs,
            auctionId: auctionIdForLogs,
            ackProvided,
            ackSent,
            reason: 'ack_not_provided',
            result: response.ok ? 'success' : 'failure',
          }),
        );

        return false;
      }

      if (ackSent) {
        this.logger.error(
          JSON.stringify({
            event: 'placeBid',
            socketId: client.id,
            stage,
            userId: userIdForLogs,
            auctionId: auctionIdForLogs,
            ackProvided,
            ackSent,
            reason: 'duplicate_ack_attempt_blocked',
          }),
        );

        return true;
      }

      ackSent = true;
      let ackCallbackError: string | undefined;

      try {
        ack(response);
      } catch (error) {
        ackCallbackError =
          error instanceof Error
            ? error.message
            : 'ack callback threw non-error value';
      }

      this.logger.log(
        JSON.stringify({
          event: 'placeBid',
          socketId: client.id,
          stage,
          userId: userIdForLogs,
          auctionId: auctionIdForLogs,
          ackProvided,
          ackSent,
          result: response.ok ? 'success' : 'failure',
          ackCallbackError,
        }),
      );

      return true;
    };

    try {
      stage = 'auth';
      const user = this.tryHydrateUserFromHandshake(client);

      if (!user?.userId) {
        throw new Error('Unauthorized user');
      }

      userIdForLogs = user.userId;

      stage = 'validation';
      const auctionId =
        typeof data?.auctionId === 'string' ? data.auctionId : '';
      auctionIdForLogs = auctionId;

      const normalizedAmount =
        typeof data?.amount === 'number'
          ? data.amount
          : typeof data?.amount === 'string'
            ? Number(data.amount)
            : Number.NaN;

      if (!auctionId) {
        throw new Error('auctionId is required');
      }

      if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
        throw new Error('amount must be a number greater than 0');
      }

      stage = 'service';
      const auction = await this.bidsService.placeBid(
        user.userId,
        auctionId,
        normalizedAmount,
      );

      const successResponse = { ok: true, data: auction };

      if (sendAckOnce(successResponse)) {
        return;
      }

      return successResponse;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to place bid';

      this.logger.warn(
        `Bid rejected for auction ${auctionIdForLogs ?? 'unknown'}: ${message} (user ${userIdForLogs})`,
      );

      const failureResponse = { ok: false, error: message };

      if (sendAckOnce(failureResponse)) {
        return;
      }

      throw new WsException(message);
    } finally {
      this.logger.log(
        JSON.stringify({
          event: 'placeBid',
          socketId: client.id,
          stage,
          userId: userIdForLogs,
          auctionId: auctionIdForLogs,
          ackProvided,
          ackSent,
          lifecycle: 'completed',
        }),
      );
    }
  }
}
