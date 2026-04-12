import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { JwtService } from '@nestjs/jwt';
import { BidsGateway } from '../../src/modules/bids/bids.gateway';
import { BidsService } from '../../src/modules/bids/bids.service';

jest.setTimeout(20000);

describe('Integration: bids websocket round trip', () => {
  let app: INestApplication;
  let gateway: BidsGateway;

  const jwtServiceMock = {
    verify: jest.fn(),
  };

  const bidsServiceMock = {
    placeBid: jest.fn(),
  };

  const connectClient = async (token?: string) => {
    const client = io(await app.getUrl(), {
      autoConnect: false,
      transports: ['websocket'],
      auth: token ? { token } : {},
    });

    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', (error) => reject(error));
      client.connect();
    });

    return client;
  };

  const emitWithAck = <TResponse>(
    client: Socket,
    event: string,
    payload: unknown,
  ) =>
    new Promise<TResponse>((resolve, reject) => {
      client
        .timeout(5000)
        .emit(event, payload, (error: Error | null, response: TResponse) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(response);
        });
    });

  const waitForEvent = <TEvent>(client: Socket, event: string) =>
    new Promise<TEvent>((resolve) => {
      client.once(event, (payload: TEvent) => resolve(payload));
    });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        BidsGateway,
        { provide: BidsService, useValue: bidsServiceMock },
        { provide: JwtService, useValue: jwtServiceMock },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    await app.listen(0);

    gateway = app.get(BidsGateway);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('broadcasts a websocket bid to joined auction clients', async () => {
    const auctionId = '507f1f77bcf86cd799439011';
    const bidderToken = 'bidder-token';
    const observerToken = 'observer-token';

    jwtServiceMock.verify.mockImplementation((token: string) => {
      if (token === bidderToken) {
        return { sub: 'user-bidder', email: 'bidder@ubuy.local' };
      }

      if (token === observerToken) {
        return { sub: 'user-observer', email: 'observer@ubuy.local' };
      }

      throw new Error('invalid token');
    });

    bidsServiceMock.placeBid.mockImplementation(
      async (userId: string, id: string, amount: number) => {
        const payload = {
          _id: id,
          auctionId: id,
          userId,
          amount,
        };

        gateway.server.to(id).emit('newBid', {
          auctionId: id,
          userId,
          amount,
        });

        return payload;
      },
    );

    const bidder = await connectClient(bidderToken);
    const observer = await connectClient(observerToken);

    try {
      await emitWithAck<{ message: string }>(bidder, 'joinAuction', {
        auctionId,
      });
      await emitWithAck<{ message: string }>(observer, 'joinAuction', {
        auctionId,
      });

      const bidBroadcast = waitForEvent<{
        auctionId: string;
        userId: string;
        amount: number;
      }>(observer, 'newBid');

      const ack = await emitWithAck<{
        ok: boolean;
        data: { auctionId: string; amount: number; userId: string };
      }>(bidder, 'placeBid', { auctionId, amount: '1250' });

      const broadcast = await bidBroadcast;

      expect(ack).toEqual({
        ok: true,
        data: {
          _id: auctionId,
          auctionId,
          userId: 'user-bidder',
          amount: 1250,
        },
      });
      expect(broadcast).toEqual({
        auctionId,
        userId: 'user-bidder',
        amount: 1250,
      });
      expect(bidsServiceMock.placeBid).toHaveBeenCalledWith(
        'user-bidder',
        auctionId,
        1250,
      );
    } finally {
      bidder.disconnect();
      observer.disconnect();
    }
  });

  it('returns a websocket failure response when token is missing', async () => {
    const client = await connectClient();

    try {
      const response = await emitWithAck<{ ok: boolean; error: string }>(
        client,
        'placeBid',
        {
          auctionId: '507f1f77bcf86cd799439011',
          amount: 1000,
        },
      );

      expect(response).toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.stringMatching(/unauthorized/i),
        }),
      );
    } finally {
      client.disconnect();
    }
  });
});
