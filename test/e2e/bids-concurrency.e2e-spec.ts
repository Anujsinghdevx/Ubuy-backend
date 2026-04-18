import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { Connection, Model } from 'mongoose';
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
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';
import { RedisService } from '../../src/common/redis/redis.service';

jest.setTimeout(30000);

describe('E2E: bidding concurrency lock behavior', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;
  let bidModel: Model<BidDocument>;

  const creatorEmail = 'e2e.concurrent.creator@ubuy.local';
  const creatorPassword = 'E2EConcurrentCreatorPass123!';
  const creatorUsername = 'e2e_concurrent_creator';

  const bidder1Email = 'e2e.concurrent.bidder1@ubuy.local';
  const bidder1Password = 'E2EConcurrentBidderPass123!';
  const bidder1Username = 'e2e_concurrent_bidder1';

  const bidder2Email = 'e2e.concurrent.bidder2@ubuy.local';
  const bidder2Password = 'E2EConcurrentBidderPass123!';
  const bidder2Username = 'e2e_concurrent_bidder2';

  let creatorUserId = '';

  const auctionQueueMock: any = {
    add: jest.fn(),
    getJob: jest.fn(),
    close: jest.fn(),
  };

  let firstLockGranted = false;
  const lockState = new Set<string>();

  const redisServiceMock = {
    getClient: () => ({
      set: async (
        key: string,
        value: string,
        _mode: string,
        _ttl: number,
        _setMode: string,
      ) => {
        if (!firstLockGranted) {
          firstLockGranted = true;
          lockState.add(key);
          return 'OK';
        }

        if (lockState.has(key)) {
          return null;
        }

        lockState.add(key);
        return 'OK';
      },
      del: async (key: string) => {
        lockState.delete(key);
        return 1;
      },
    }),
  };

  auctionQueueMock.add.mockResolvedValue({ id: 'mock-end-auction-job' });
  auctionQueueMock.getJob.mockResolvedValue(null);
  auctionQueueMock.close.mockResolvedValue(undefined);

  const loginAndGetToken = async (email: string, password: string) => {
    const loginResponse = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password });

    expect(loginResponse.status).toBe(201);
    return loginResponse.body.access_token as string;
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
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    mongoConnection = app.get<Connection>(getConnectionToken());
    userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    auctionModel = app.get<Model<AuctionDocument>>(getModelToken(Auction.name));
    bidModel = app.get<Model<BidDocument>>(getModelToken(Bid.name));

    await userModel.deleteMany({
      email: { $in: [creatorEmail, bidder1Email, bidder2Email] },
    });

    const [creatorHash, bidder1Hash, bidder2Hash] = await Promise.all([
      bcrypt.hash(creatorPassword, 10),
      bcrypt.hash(bidder1Password, 10),
      bcrypt.hash(bidder2Password, 10),
    ]);

    const creator = await userModel.create({
      email: creatorEmail,
      username: creatorUsername,
      password: creatorHash,
      provider: 'local',
      isVerified: true,
    });

    creatorUserId = String(creator._id);

    await userModel.create({
      email: bidder1Email,
      username: bidder1Username,
      password: bidder1Hash,
      provider: 'local',
      isVerified: true,
    });

    await userModel.create({
      email: bidder2Email,
      username: bidder2Username,
      password: bidder2Hash,
      provider: 'local',
      isVerified: true,
    });
  });

  afterAll(async () => {
    await bidModel.deleteMany({});
    await auctionModel.deleteMany({ createdBy: creatorUserId });
    await userModel.deleteMany({
      email: { $in: [creatorEmail, bidder1Email, bidder2Email] },
    });

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }

    if (app) {
      await app.close();
    }
  });

  afterEach(async () => {
    firstLockGranted = false;
    lockState.clear();
    await bidModel.deleteMany({});
    await auctionModel.deleteMany({ createdBy: creatorUserId });
  });

  it('allows only one concurrent bid when lock is contended', async () => {
    const creatorToken = await loginAndGetToken(creatorEmail, creatorPassword);
    const bidder1Token = await loginAndGetToken(bidder1Email, bidder1Password);
    const bidder2Token = await loginAndGetToken(bidder2Email, bidder2Password);

    const auctionResponse = await request(app.getHttpServer())
      .post('/v1/auctions')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        title: `E2E Concurrency Auction ${Date.now()}`,
        description: 'Concurrent bidding lock coverage',
        images: ['https://example.com/e2e-concurrency-auction.jpg'],
        startingPrice: 500,
        startTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        category: 'electronics',
      });

    expect(auctionResponse.status).toBe(201);
    const auctionId = String(auctionResponse.body._id);

    const [bid1Response, bid2Response] = await Promise.all([
      request(app.getHttpServer())
        .post(`/v1/auctions/${auctionId}/bids`)
        .set('Authorization', `Bearer ${bidder1Token}`)
        .send({ amount: 600 }),
      request(app.getHttpServer())
        .post(`/v1/auctions/${auctionId}/bids`)
        .set('Authorization', `Bearer ${bidder2Token}`)
        .send({ amount: 700 }),
    ]);

    const statuses = [bid1Response.status, bid2Response.status];
    expect(statuses.filter((code) => code === 201)).toHaveLength(1);
    expect(statuses.filter((code) => code === 400)).toHaveLength(1);

    const failureResponse = bid1Response.status === 400 ? bid1Response : bid2Response;
    expect(failureResponse.body).toEqual(
      expect.objectContaining({
        message: 'Another bid is being processed, try again',
      }),
    );

    const totalBids = await bidModel.countDocuments({ auctionId });
    expect(totalBids).toBe(1);
  });
});
