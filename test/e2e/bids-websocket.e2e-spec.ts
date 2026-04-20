import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { Connection, Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../src/app.module';
import {
  User,
  UserDocument,
} from '../../src/modules/users/schemas/user.schema';
import {
  Auction,
  AuctionDocument,
} from '../../src/modules/auctions/schemas/auction.schema';
import { Bid, BidDocument } from '../../src/modules/bids/schemas/bid.schema';
import {
  Notification,
  NotificationDocument,
} from '../../src/modules/notifications/schemas/notification.schema';
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';
import { RedisService } from '../../src/common/redis/redis.service';

jest.setTimeout(30000);

describe('E2E: bids websocket live broadcast', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;
  let bidModel: Model<BidDocument>;
  let notificationModel: Model<NotificationDocument>;

  const creatorEmail = 'e2e.websocket.creator@ubuy.local';
  const creatorPassword = 'E2EWebSocketCreatorPass123!';
  const creatorUsername = 'e2e_websocket_creator';

  const bidderEmail = 'e2e.websocket.bidder@ubuy.local';
  const bidderPassword = 'E2EWebSocketBidderPass123!';
  const bidderUsername = 'e2e_websocket_bidder';

  const observerEmail = 'e2e.websocket.observer@ubuy.local';
  const observerPassword = 'E2EWebSocketObserverPass123!';
  const observerUsername = 'e2e_websocket_observer';

  let creatorUserId = '';

  const auctionQueueMock: any = {
    add: jest.fn(),
    getJob: jest.fn(),
    close: jest.fn(),
  };

  auctionQueueMock.add.mockResolvedValue({ id: 'mock-end-auction-job' });
  auctionQueueMock.getJob.mockResolvedValue(null);
  auctionQueueMock.close.mockResolvedValue(undefined);

  const redisStore = new Map<string, string>();

  const redisServiceMock = {
    getClient: () => ({
      set: async (
        key: string,
        value: string,
        _mode: string,
        _ttl: number,
        setMode: string,
      ) => {
        if (setMode === 'NX' && redisStore.has(key)) {
          return null;
        }

        redisStore.set(key, value);
        return 'OK';
      },
      del: async (key: string) => {
        redisStore.delete(key);
        return 1;
      },
    }),
  };

  const loginAndGetToken = async (email: string, password: string) => {
    const loginResponse = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password });

    expect(loginResponse.status).toBe(201);
    return loginResponse.body.access_token as string;
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

  const connectClient = async (baseUrl: string, token: string) => {
    const client = io(baseUrl, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { token },
    });

    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', (error) => reject(error));
      client.connect();
    });

    return client;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken('auctionQueue'))
      .useValue(auctionQueueMock)
      .overrideProvider(AuctionProcessor)
      .useValue({})
      .overrideProvider(RedisService)
      .useValue(redisServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();
    await app.listen(0);

    mongoConnection = app.get<Connection>(getConnectionToken());
    userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    auctionModel = app.get<Model<AuctionDocument>>(getModelToken(Auction.name));
    bidModel = app.get<Model<BidDocument>>(getModelToken(Bid.name));
    notificationModel = app.get<Model<NotificationDocument>>(
      getModelToken(Notification.name),
    );

    await userModel.deleteMany({
      email: { $in: [creatorEmail, bidderEmail, observerEmail] },
    });

    const [creatorHash, bidderHash, observerHash] = await Promise.all([
      bcrypt.hash(creatorPassword, 10),
      bcrypt.hash(bidderPassword, 10),
      bcrypt.hash(observerPassword, 10),
    ]);

    const creatorUser = await userModel.create({
      email: creatorEmail,
      username: creatorUsername,
      password: creatorHash,
      provider: 'local',
      isVerified: true,
    });

    creatorUserId = String(creatorUser._id);

    await userModel.create({
      email: bidderEmail,
      username: bidderUsername,
      password: bidderHash,
      provider: 'local',
      isVerified: true,
    });

    await userModel.create({
      email: observerEmail,
      username: observerUsername,
      password: observerHash,
      provider: 'local',
      isVerified: true,
    });
  });

  afterAll(async () => {
    await bidModel.deleteMany({});
    await notificationModel.deleteMany({});
    await auctionModel.deleteMany({ createdBy: creatorUserId });
    await userModel.deleteMany({
      email: { $in: [creatorEmail, bidderEmail, observerEmail] },
    });

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  afterEach(async () => {
    redisStore.clear();
    await bidModel.deleteMany({});
    await auctionModel.deleteMany({ createdBy: creatorUserId });
    await notificationModel.deleteMany({});
  });

  it('accepts socket bid and broadcasts newBid to other room subscribers', async () => {
    const creatorToken = await loginAndGetToken(creatorEmail, creatorPassword);
    const bidderToken = await loginAndGetToken(bidderEmail, bidderPassword);
    const observerToken = await loginAndGetToken(
      observerEmail,
      observerPassword,
    );

    const createAuctionResponse = await request(app.getHttpServer())
      .post('/v1/auctions')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        title: `E2E WS Auction ${Date.now()}`,
        description: 'Socket placeBid and newBid broadcast journey',
        images: ['https://example.com/e2e-ws-auction.jpg'],
        startingPrice: 500,
        startTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        category: 'electronics',
      });

    expect(createAuctionResponse.status).toBe(201);
    const auctionId = String(createAuctionResponse.body._id);

    const baseUrl = await app.getUrl();
    const bidderClient = await connectClient(baseUrl, bidderToken);
    const observerClient = await connectClient(baseUrl, observerToken);

    try {
      await emitWithAck<{ message: string }>(bidderClient, 'joinAuction', {
        auctionId,
      });
      await emitWithAck<{ message: string }>(observerClient, 'joinAuction', {
        auctionId,
      });

      const observerBroadcast = waitForEvent<{
        auctionId: string;
        userId: string;
        amount: number;
      }>(observerClient, 'newBid');

      const bidderAck = await emitWithAck<{
        ok: boolean;
        data: {
          _id: string;
          currentPrice: number;
          highestBidder: string;
        };
      }>(bidderClient, 'placeBid', {
        auctionId,
        amount: 650,
      });

      const broadcast = await observerBroadcast;

      expect(bidderAck).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            _id: auctionId,
            currentPrice: 650,
          }),
        }),
      );

      expect(broadcast).toEqual(
        expect.objectContaining({
          auctionId,
          amount: 650,
        }),
      );

      const persistedAuction = await auctionModel.findById(auctionId).lean();
      expect(persistedAuction?.currentPrice).toBe(650);

      const persistedBid = await bidModel.findOne({ auctionId }).lean();
      expect(persistedBid).toBeTruthy();
      expect(persistedBid?.amount).toBe(650);
    } finally {
      bidderClient.disconnect();
      observerClient.disconnect();
    }
  });
});
