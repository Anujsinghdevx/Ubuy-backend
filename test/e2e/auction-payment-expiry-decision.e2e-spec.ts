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
import {
  Notification,
  NotificationDocument,
} from '../../src/modules/notifications/schemas/notification.schema';
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';
import { BidsGateway } from '../../src/modules/bids/bids.gateway';

jest.setTimeout(30000);

describe('E2E: payment-expiry decision journey', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;
  let bidModel: Model<BidDocument>;
  let notificationModel: Model<NotificationDocument>;

  const creatorEmail = 'e2e.payment-expiry.creator@ubuy.local';
  const creatorPassword = 'E2EPaymentExpiryCreatorPass123!';
  const creatorUsername = 'e2e_payment_expiry_creator';

  const bidder1Email = 'e2e.payment-expiry.bidder1@ubuy.local';
  const bidder1Password = 'E2EPaymentExpiryBidderPass123!';
  const bidder1Username = 'e2e_payment_expiry_bidder1';

  const bidder2Email = 'e2e.payment-expiry.bidder2@ubuy.local';
  const bidder2Password = 'E2EPaymentExpiryBidderPass123!';
  const bidder2Username = 'e2e_payment_expiry_bidder2';

  let creatorUserId = '';
  let bidder1UserId = '';
  let bidder2UserId = '';

  const auctionQueueMock: any = {
    add: jest.fn(),
    getJob: jest.fn(),
    close: jest.fn(),
  };

  auctionQueueMock.add.mockResolvedValue({ id: 'mock-end-auction-job' });
  auctionQueueMock.getJob.mockResolvedValue(null);
  auctionQueueMock.close.mockResolvedValue(undefined);

  const bidsGatewayMock = {
    server: {
      to: jest.fn().mockImplementation(() => ({
        emit: jest.fn(),
      })),
    },
  };

  const loginAndGetToken = async (email: string, password: string) => {
    const loginResponse = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password });

    expect(loginResponse.status).toBe(201);
    return loginResponse.body.access_token as string;
  };

  const createEndedAuctionWithBids = async (
    bids: Array<{ bidderId: string; amount: number }>,
  ) => {
    const auctionData: any = {
      title: `E2E Payment Expiry Auction ${Date.now()}`,
      description: 'E2E payment expiry decisions',
      images: ['https://example.com/e2e-payment-expiry.jpg'],
      startingPrice: 100,
      currentPrice: bids.length > 0 ? bids[bids.length - 1].amount : 100,
      status: 'ENDED',
      paymentStatus: 'ACTIVE',
      startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
      endTime: new Date(Date.now() - 60 * 1000),
      category: 'collectibles',
      createdBy: creatorUserId,
    };

    if (bids.length > 0) {
      auctionData.winner = bids[bids.length - 1].bidderId;
      auctionData.highestBidder = bids[bids.length - 1].bidderId;
    }

    const auction = await auctionModel.create(auctionData);

    for (const bid of bids) {
      await bidModel.create({
        auctionId: String(auction._id),
        userId: bid.bidderId,
        amount: bid.amount,
      });
    }

    return String(auction._id);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken('auctionQueue'))
      .useValue(auctionQueueMock)
      .overrideProvider(BidsGateway)
      .useValue(bidsGatewayMock)
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
    notificationModel = app.get<Model<NotificationDocument>>(
      getModelToken(Notification.name),
    );

    await userModel.deleteMany({
      email: { $in: [creatorEmail, bidder1Email, bidder2Email] },
    });

    const [creatorHash, bidder1Hash, bidder2Hash] = await Promise.all([
      bcrypt.hash(creatorPassword, 10),
      bcrypt.hash(bidder1Password, 10),
      bcrypt.hash(bidder2Password, 10),
    ]);

    const [creator, bidder1, bidder2] = await Promise.all([
      userModel.create({
        email: creatorEmail,
        username: creatorUsername,
        password: creatorHash,
        provider: 'local',
        isVerified: true,
      }),
      userModel.create({
        email: bidder1Email,
        username: bidder1Username,
        password: bidder1Hash,
        provider: 'local',
        isVerified: true,
      }),
      userModel.create({
        email: bidder2Email,
        username: bidder2Username,
        password: bidder2Hash,
        provider: 'local',
        isVerified: true,
      }),
    ]);

    creatorUserId = String(creator._id);
    bidder1UserId = String(bidder1._id);
    bidder2UserId = String(bidder2._id);
  });

  afterAll(async () => {
    await bidModel.deleteMany({
      userId: { $in: [creatorUserId, bidder1UserId, bidder2UserId] },
    });
    await auctionModel.deleteMany({ createdBy: creatorUserId });
    await notificationModel.deleteMany({
      userId: { $in: [creatorUserId, bidder1UserId, bidder2UserId] },
    });
    await userModel.deleteMany({
      email: { $in: [creatorEmail, bidder1Email, bidder2Email] },
    });

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  afterEach(async () => {
    await bidModel.deleteMany({});
    await auctionModel.deleteMany({ createdBy: creatorUserId });
    await notificationModel.deleteMany({});
  });

  it('handles KEEP_CURRENT decision by extending winner payment window', async () => {
    const creatorToken = await loginAndGetToken(creatorEmail, creatorPassword);

    const auctionId = await createEndedAuctionWithBids([
      { bidderId: bidder1UserId, amount: 150 },
    ]);

    const response = await request(app.getHttpServer())
      .post(`/v1/auctions/${auctionId}/payment-expiry/decision`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ action: 'KEEP_CURRENT' });

    expect([200, 201]).toContain(response.status);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'Payment window extended for current winner',
        paymentDueAt: expect.any(String),
        auction: expect.objectContaining({
          _id: auctionId,
          winner: bidder1UserId,
        }),
      }),
    );
  });

  it('handles PUSH_NEXT decision by moving winner to next highest bidder', async () => {
    const creatorToken = await loginAndGetToken(creatorEmail, creatorPassword);

    const auctionId = await createEndedAuctionWithBids([
      { bidderId: bidder1UserId, amount: 150 },
      { bidderId: bidder2UserId, amount: 200 },
    ]);

    const response = await request(app.getHttpServer())
      .post(`/v1/auctions/${auctionId}/payment-expiry/decision`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ action: 'PUSH_NEXT' });

    expect([200, 201]).toContain(response.status);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'Winner switched to next eligible bidder',
        paymentDueAt: expect.any(String),
      }),
    );

    const updatedAuction = await auctionModel.findById(auctionId).lean();
    expect(updatedAuction?.winner).toBe(bidder1UserId);
    expect(updatedAuction?.highestBidder).toBe(bidder1UserId);
    expect(updatedAuction?.paymentStatus).toBe('ACTIVE');
  });
});
