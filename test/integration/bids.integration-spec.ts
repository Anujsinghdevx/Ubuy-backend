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
import { UploadsService } from '../../src/modules/uploads/uploads.service';
import { BidsGateway } from '../../src/modules/bids/bids.gateway';
import { RedisService } from '../../src/common/redis/redis.service';

describe('Integration: bids flow', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;
  let bidModel: Model<BidDocument>;
  let creatorUserId = '';
  let bidderUserId = '';

  const creatorEmail = 'integration.bids.creator@ubuy.local';
  const creatorPassword = 'IntegrationCreatorPass123!';
  const creatorUsername = 'integration_bids_creator';
  const bidderEmail = 'integration.bids.bidder@ubuy.local';
  const bidderPassword = 'IntegrationBidderPass123!';
  const bidderUsername = 'integration_bids_bidder';

  const auctionQueueMock: any = {
    add: jest.fn() as jest.Mock,
    getJob: jest.fn() as jest.Mock,
    close: jest.fn() as jest.Mock,
  };

  auctionQueueMock.add.mockResolvedValue({ id: 'mock-end-auction-job' });
  auctionQueueMock.getJob.mockResolvedValue(null);
  auctionQueueMock.close.mockResolvedValue(undefined);

  const uploadsServiceMock = {
    uploadAuctionImages: jest.fn(),
  };

  const bidsGatewayMock = {
    server: {
      to: jest.fn().mockImplementation(() => ({
        emit: jest.fn(),
      })),
    },
  };

  const redisClientMock: any = {
    set: jest.fn() as jest.Mock,
    del: jest.fn() as jest.Mock,
  };

  redisClientMock.set.mockResolvedValue('OK');
  redisClientMock.del.mockResolvedValue(1);

  const redisServiceMock = {
    getClient: jest.fn().mockReturnValue(redisClientMock),
  };

  const loginAndGetToken = async (email: string, password: string) => {
    const loginResponse = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password });

    expect(loginResponse.status).toBe(201);
    expect(loginResponse.body).toEqual(
      expect.objectContaining({
        access_token: expect.any(String),
      }),
    );

    return loginResponse.body.access_token as string;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken('auctionQueue'))
      .useValue(auctionQueueMock)
      .overrideProvider(RedisService)
      .useValue(redisServiceMock)
      .overrideProvider(BidsGateway)
      .useValue(bidsGatewayMock)
      .overrideProvider(AuctionProcessor)
      .useValue({})
      .overrideProvider(UploadsService)
      .useValue(uploadsServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();

    mongoConnection = app.get<Connection>(getConnectionToken());
    userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    auctionModel = app.get<Model<AuctionDocument>>(getModelToken(Auction.name));
    bidModel = app.get<Model<BidDocument>>(getModelToken(Bid.name));

    await bidModel.deleteMany({});
    await auctionModel.deleteMany({});
    await userModel.deleteOne({ email: bidderEmail });
    await userModel.deleteOne({ email: creatorEmail });

    const [creatorHashedPassword, bidderHashedPassword] = await Promise.all([
      bcrypt.hash(creatorPassword, 10),
      bcrypt.hash(bidderPassword, 10),
    ]);

    const creatorUser = await userModel.create({
      email: creatorEmail,
      username: creatorUsername,
      password: creatorHashedPassword,
      provider: 'local',
      isVerified: true,
    });

    const bidderUser = await userModel.create({
      email: bidderEmail,
      username: bidderUsername,
      password: bidderHashedPassword,
      provider: 'local',
      isVerified: true,
    });

    creatorUserId = String(creatorUser._id);
    bidderUserId = String(bidderUser._id);
  });

  afterAll(async () => {
    if (bidModel) {
      await bidModel.deleteMany({
        userId: { $in: [creatorUserId, bidderUserId] },
      });
    }

    if (auctionModel) {
      await auctionModel.deleteMany({
        createdBy: { $in: [creatorUserId, bidderUserId] },
      });
    }

    if (userModel) {
      await userModel.deleteOne({ email: bidderEmail });
      await userModel.deleteOne({ email: creatorEmail });
    }

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  it('allows an authenticated non-owner user to place a bid', async () => {
    const creatorToken = await loginAndGetToken(creatorEmail, creatorPassword);
    const bidderToken = await loginAndGetToken(bidderEmail, bidderPassword);

    const createAuctionResponse = await request(app.getHttpServer())
      .post('/v1/auctions')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        title: 'Integration Biddable Auction',
        description: 'Auction used for integration bid placement checks',
        images: ['https://example.com/integration-bid-auction.jpg'],
        startingPrice: 2200,
        startTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        category: 'collectibles',
      });

    expect(createAuctionResponse.status).toBe(201);

    const auctionId = String(createAuctionResponse.body._id);

    const bidResponse = await request(app.getHttpServer())
      .post(`/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${bidderToken}`)
      .send({ amount: 2600 });

    expect(bidResponse.status).toBe(201);
    expect(bidResponse.body).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          _id: auctionId,
          currentPrice: 2600,
          highestBidder: bidderUserId,
        }),
      }),
    );

    expect(redisClientMock.set).toHaveBeenCalledWith(
      `lock:auction:${auctionId}`,
      'locked',
      'PX',
      3000,
      'NX',
    );
    expect(redisClientMock.del).toHaveBeenCalledWith(
      `lock:auction:${auctionId}`,
    );

    const persistedBid = await bidModel.findOne({
      auctionId,
      userId: bidderUserId,
    });
    expect(persistedBid).toBeTruthy();
    expect(persistedBid?.amount).toBe(2600);

    const updatedBidder = await userModel.findById(bidderUserId).lean();
    expect(updatedBidder?.biddedAuctions).toContain(auctionId);
  });

  it('rejects auction creator from bidding on own auction', async () => {
    const creatorToken = await loginAndGetToken(creatorEmail, creatorPassword);

    const createAuctionResponse = await request(app.getHttpServer())
      .post('/v1/auctions')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        title: 'Integration Creator Own Auction',
        description: 'Creator should not be able to bid on own auction',
        images: ['https://example.com/integration-creator-own-auction.jpg'],
        startingPrice: 1800,
        startTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        category: 'fashion',
      });

    expect(createAuctionResponse.status).toBe(201);

    const auctionId = String(createAuctionResponse.body._id);

    const bidResponse = await request(app.getHttpServer())
      .post(`/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ amount: 2000 });

    expect(bidResponse.status).toBe(400);
    expect(bidResponse.body).toEqual(
      expect.objectContaining({
        message: 'You cannot bid on your own auction',
      }),
    );

    const persistedBid = await bidModel.findOne({
      auctionId,
      userId: creatorUserId,
    });
    expect(persistedBid).toBeNull();
  });

  it('rejects bid amount lower than current auction price', async () => {
    const creatorToken = await loginAndGetToken(creatorEmail, creatorPassword);
    const bidderToken = await loginAndGetToken(bidderEmail, bidderPassword);

    const createAuctionResponse = await request(app.getHttpServer())
      .post('/v1/auctions')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        title: 'Integration Low Bid Rejection Auction',
        description: 'Low bid should be rejected by service logic',
        images: ['https://example.com/integration-low-bid-auction.jpg'],
        startingPrice: 3200,
        startTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        category: 'electronics',
      });

    expect(createAuctionResponse.status).toBe(201);

    const auctionId = String(createAuctionResponse.body._id);

    const bidResponse = await request(app.getHttpServer())
      .post(`/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${bidderToken}`)
      .send({ amount: 3000 });

    expect(bidResponse.status).toBe(400);
    expect(bidResponse.body).toEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          'Bid must be greater than current price',
        ),
      }),
    );

    const persistedBid = await bidModel.findOne({
      auctionId,
      userId: bidderUserId,
    });
    expect(persistedBid).toBeNull();
  });

  it('returns top bidders ordered by bid amount and respects the limit', async () => {
    const creatorToken = await loginAndGetToken(creatorEmail, creatorPassword);
    const bidderToken = await loginAndGetToken(bidderEmail, bidderPassword);

    const tempBidderEmail = `integration.bids.temp.${Date.now()}@ubuy.local`;
    const tempBidderPassword = 'IntegrationTempBidderPass123!';
    const tempBidderUsername = `integration_bids_temp_${Date.now()}`;
    const tempBidderHashedPassword = await bcrypt.hash(tempBidderPassword, 10);

    const tempBidderUser = await userModel.create({
      email: tempBidderEmail,
      username: tempBidderUsername,
      password: tempBidderHashedPassword,
      provider: 'local',
      isVerified: true,
    });

    try {
      const tempBidderToken = await loginAndGetToken(
        tempBidderEmail,
        tempBidderPassword,
      );

      const createAuctionResponse = await request(app.getHttpServer())
        .post('/v1/auctions')
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({
          title: 'Integration Top Bidders Auction',
          description: 'Auction used to verify leaderboard ordering',
          images: ['https://example.com/integration-top-bidders-auction.jpg'],
          startingPrice: 1000,
          startTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          category: 'collectibles',
        });

      expect(createAuctionResponse.status).toBe(201);

      const auctionId = String(createAuctionResponse.body._id);

      await request(app.getHttpServer())
        .post(`/v1/auctions/${auctionId}/bids`)
        .set('Authorization', `Bearer ${bidderToken}`)
        .send({ amount: 1500 });

      await request(app.getHttpServer())
        .post(`/v1/auctions/${auctionId}/bids`)
        .set('Authorization', `Bearer ${tempBidderToken}`)
        .send({ amount: 1800 });

      await request(app.getHttpServer())
        .post(`/v1/auctions/${auctionId}/bids`)
        .set('Authorization', `Bearer ${bidderToken}`)
        .send({ amount: 2200 });

      const leaderboardResponse = await request(app.getHttpServer()).get(
        `/v1/auctions/${auctionId}/top-bidders?limit=2`,
      );

      expect(leaderboardResponse.status).toBe(200);
      expect(leaderboardResponse.body).toEqual(
        expect.objectContaining({
          auctionId,
          total: 2,
          topBidders: expect.arrayContaining([
            expect.objectContaining({
              userId: bidderUserId,
              amount: 2200,
              bidderName: expect.any(String),
            }),
            expect.objectContaining({
              userId: tempBidderUser._id.toString(),
              amount: 1800,
              bidderName: expect.any(String),
            }),
          ]),
        }),
      );

      expect(leaderboardResponse.body.topBidders[0]).toEqual(
        expect.objectContaining({
          userId: bidderUserId,
          amount: 2200,
        }),
      );
    } finally {
      await userModel.deleteOne({ _id: tempBidderUser._id });
    }
  });
});
