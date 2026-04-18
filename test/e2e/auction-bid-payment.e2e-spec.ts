import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
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
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';

describe('E2E: auction bidding and payment journey', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;
  let bidModel: Model<BidDocument>;

  const creatorEmail = 'e2e.auction.creator@ubuy.local';
  const creatorPassword = 'E2ECreatorPass123!';
  const creatorUsername = 'e2e_auction_creator';

  const bidderEmail = 'e2e.auction.bidder@ubuy.local';
  const bidderPassword = 'E2EBidderPass123!';
  const bidderUsername = 'e2e_auction_bidder';

  let creatorUserId = '';
  let bidderUserId = '';

  const auctionQueueMock: any = {
    add: jest.fn(),
    getJob: jest.fn(),
    close: jest.fn(),
  };

  auctionQueueMock.add.mockResolvedValue({ id: 'mock-end-auction-job' });
  auctionQueueMock.getJob.mockResolvedValue(null);
  auctionQueueMock.close.mockResolvedValue(undefined);

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
      .overrideProvider(AuctionProcessor)
      .useValue({})
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

    await userModel.deleteMany({
      email: { $in: [creatorEmail, bidderEmail] },
    });

    const [creatorHashedPassword, bidderHashedPassword] = await Promise.all([
      bcrypt.hash(creatorPassword, 10),
      bcrypt.hash(bidderPassword, 10),
    ]);

    const [creatorUser, bidderUser] = await Promise.all([
      userModel.create({
        email: creatorEmail,
        username: creatorUsername,
        password: creatorHashedPassword,
        provider: 'local',
        isVerified: true,
      }),
      userModel.create({
        email: bidderEmail,
        username: bidderUsername,
        password: bidderHashedPassword,
        provider: 'local',
        isVerified: true,
      }),
    ]);

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
      await userModel.deleteMany({
        email: { $in: [creatorEmail, bidderEmail] },
      });
    }

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  it(
    'allows bidder to win an ended auction and confirm payment',
    async () => {
    const creatorToken = await loginAndGetToken(creatorEmail, creatorPassword);
    const bidderToken = await loginAndGetToken(bidderEmail, bidderPassword);

    const createAuctionResponse = await request(app.getHttpServer())
      .post('/v1/auctions')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        title: `E2E Biddable Auction ${Date.now()}`,
        description: 'E2E flow for auction bidding and payment confirmation',
        images: ['https://example.com/e2e-biddable-auction.jpg'],
        startingPrice: 2500,
        startTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        category: 'collectibles',
      });

    expect(createAuctionResponse.status).toBe(201);

    const auctionId = String(createAuctionResponse.body._id);

    const bidResponse = await request(app.getHttpServer())
      .post(`/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${bidderToken}`)
      .send({ amount: 3000 });

    expect(bidResponse.status).toBe(201);
    expect(bidResponse.body).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          _id: auctionId,
          currentPrice: 3000,
          highestBidder: bidderUserId,
        }),
      }),
    );

    const endNowResponse = await request(app.getHttpServer())
      .post(`/v1/auctions/${auctionId}/end`)
      .set('Authorization', `Bearer ${creatorToken}`);

    expect(endNowResponse.status).toBe(201);
    expect(endNowResponse.body).toEqual(
      expect.objectContaining({
        message: 'Auction end triggered successfully',
        auctionId,
      }),
    );

      await auctionModel.updateOne(
        { _id: auctionId },
        {
          $set: {
            status: 'ENDED',
            winner: bidderUserId,
            highestBidder: bidderUserId,
            paymentStatus: 'ACTIVE',
            endTime: new Date(Date.now() - 1000),
          },
        },
      );

      const confirmPaymentResponse = await request(app.getHttpServer())
        .post(`/v1/auctions/${auctionId}/payment/confirm`)
        .set('Authorization', `Bearer ${bidderToken}`);

      expect([200, 201]).toContain(confirmPaymentResponse.status);
      expect(confirmPaymentResponse.body).toEqual(
        expect.objectContaining({
          message: expect.stringMatching(/payment confirmed/i),
          auction: expect.objectContaining({
            _id: auctionId,
            status: 'ENDED',
            paymentStatus: 'PAID',
          }),
        }),
      );
    },
    20000,
  );
});
