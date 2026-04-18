import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
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
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';

describe('E2E: auction payment negative paths', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;
  let bidModel: Model<BidDocument>;

  const creatorEmail = 'e2e.payment.creator@ubuy.local';
  const creatorPassword = 'E2EPaymentCreatorPass123!';
  const creatorUsername = 'e2e_payment_creator';

  const winnerEmail = 'e2e.payment.winner@ubuy.local';
  const winnerPassword = 'E2EPaymentWinnerPass123!';
  const winnerUsername = 'e2e_payment_winner';

  const outsiderEmail = 'e2e.payment.outsider@ubuy.local';
  const outsiderPassword = 'E2EPaymentOutsiderPass123!';
  const outsiderUsername = 'e2e_payment_outsider';

  let creatorUserId = '';
  let winnerUserId = '';
  let outsiderUserId = '';

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
    return loginResponse.body.access_token as string;
  };

  const createAuctionRecord = async (params: {
    status: 'ACTIVE' | 'ENDED' | 'CANCELLED';
    winner?: string;
    paymentStatus?: 'ACTIVE' | 'PAID' | 'PENDING';
  }) => {
    const createdAuction = await auctionModel.create({
      title: `E2E Payment Auction ${Date.now()}`,
      description: 'Payment confirmation negative path coverage',
      images: ['https://example.com/e2e-payment-negative.jpg'],
      startingPrice: 1000,
      currentPrice: 1400,
      createdBy: creatorUserId,
      highestBidder: params.winner,
      winner: params.winner,
      paymentStatus: params.paymentStatus ?? 'ACTIVE',
      status: params.status,
      startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
      endTime: new Date(Date.now() - 60 * 1000),
      category: 'collectibles',
    });

    if (params.winner) {
      await bidModel.create({
        auctionId: String(createdAuction._id),
        userId: params.winner,
        amount: 1400,
      });
    }

    return String(createdAuction._id);
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
      email: { $in: [creatorEmail, winnerEmail, outsiderEmail] },
    });

    const [creatorHash, winnerHash, outsiderHash] = await Promise.all([
      bcrypt.hash(creatorPassword, 10),
      bcrypt.hash(winnerPassword, 10),
      bcrypt.hash(outsiderPassword, 10),
    ]);

    const [creatorUser, winnerUser, outsiderUser] = await Promise.all([
      userModel.create({
        email: creatorEmail,
        username: creatorUsername,
        password: creatorHash,
        provider: 'local',
        isVerified: true,
      }),
      userModel.create({
        email: winnerEmail,
        username: winnerUsername,
        password: winnerHash,
        provider: 'local',
        isVerified: true,
      }),
      userModel.create({
        email: outsiderEmail,
        username: outsiderUsername,
        password: outsiderHash,
        provider: 'local',
        isVerified: true,
      }),
    ]);

    creatorUserId = String(creatorUser._id);
    winnerUserId = String(winnerUser._id);
    outsiderUserId = String(outsiderUser._id);
  });

  afterAll(async () => {
    if (bidModel) {
      await bidModel.deleteMany({
        userId: { $in: [creatorUserId, winnerUserId, outsiderUserId] },
      });
    }

    if (auctionModel) {
      await auctionModel.deleteMany({
        createdBy: { $in: [creatorUserId, winnerUserId, outsiderUserId] },
      });
    }

    if (userModel) {
      await userModel.deleteMany({
        email: { $in: [creatorEmail, winnerEmail, outsiderEmail] },
      });
    }

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  afterEach(async () => {
    await bidModel.deleteMany({});
    await auctionModel.deleteMany({});
  });

  it('rejects payment confirmation by non-winner', async () => {
    const outsiderToken = await loginAndGetToken(outsiderEmail, outsiderPassword);
    const auctionId = await createAuctionRecord({
      status: 'ENDED',
      winner: winnerUserId,
      paymentStatus: 'ACTIVE',
    });

    const response = await request(app.getHttpServer())
      .post(`/v1/auctions/${auctionId}/payment/confirm`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'Only current winner can confirm payment',
      }),
    );
  });

  it('returns already-confirmed response on duplicate payment confirmation', async () => {
    const winnerToken = await loginAndGetToken(winnerEmail, winnerPassword);
    const auctionId = await createAuctionRecord({
      status: 'ENDED',
      winner: winnerUserId,
      paymentStatus: 'ACTIVE',
    });

    const firstConfirm = await request(app.getHttpServer())
      .post(`/v1/auctions/${auctionId}/payment/confirm`)
      .set('Authorization', `Bearer ${winnerToken}`);

    expect([200, 201]).toContain(firstConfirm.status);
    expect(firstConfirm.body).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/payment confirmed/i),
      }),
    );

    const secondConfirm = await request(app.getHttpServer())
      .post(`/v1/auctions/${auctionId}/payment/confirm`)
      .set('Authorization', `Bearer ${winnerToken}`);

    expect([200, 201]).toContain(secondConfirm.status);
    expect(secondConfirm.body).toEqual(
      expect.objectContaining({
        message: 'Payment already confirmed',
        auction: expect.objectContaining({
          _id: auctionId,
          paymentStatus: 'PAID',
        }),
      }),
    );
  });

  it('rejects payment confirmation when auction is not ended', async () => {
    const winnerToken = await loginAndGetToken(winnerEmail, winnerPassword);
    const auctionId = await createAuctionRecord({
      status: 'ACTIVE',
      winner: winnerUserId,
      paymentStatus: 'ACTIVE',
    });

    const response = await request(app.getHttpServer())
      .post(`/v1/auctions/${auctionId}/payment/confirm`)
      .set('Authorization', `Bearer ${winnerToken}`);

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'Auction is not ended',
      }),
    );
  });
});
