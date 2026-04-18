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
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';
import { BidsGateway } from '../../src/modules/bids/bids.gateway';
import { UploadsService } from '../../src/modules/uploads/uploads.service';

jest.setTimeout(30000);

describe('E2E: payment link authorization matrix', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;

  const creatorEmail = 'e2e.payauth.creator@ubuy.local';
  const creatorPassword = 'E2EPayAuthPass123!';
  const creatorUsername = 'e2e_payauth_creator';

  const winnerEmail = 'e2e.payauth.winner@ubuy.local';
  const winnerPassword = 'E2EPayAuthPass123!';
  const winnerUsername = 'e2e_payauth_winner';

  const outsiderEmail = 'e2e.payauth.outsider@ubuy.local';
  const outsiderPassword = 'E2EPayAuthPass123!';
  const outsiderUsername = 'e2e_payauth_outsider';

  let creatorUserId = '';
  let winnerUserId = '';
  let outsiderUserId = '';

  let creatorToken = '';
  let winnerToken = '';
  let outsiderToken = '';

  const previousClientId = process.env.CASHFREE_CLIENT_ID;
  const previousClientSecret = process.env.CASHFREE_CLIENT_SECRET;
  const previousApiVersion = process.env.CASHFREE_API_VERSION;
  const previousBaseUrl = process.env.CASHFREE_BASE_URL;
  const originalFetch = global.fetch;

  const auctionQueueMock: any = {
    add: jest.fn(),
    getJob: jest.fn(),
    close: jest.fn(),
  };

  const bidsGatewayMock = {
    server: {
      to: jest.fn().mockImplementation(() => ({
        emit: jest.fn(),
      })),
    },
  };

  const uploadsServiceMock = {
    uploadAuctionImages: jest.fn(),
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
    process.env.CASHFREE_CLIENT_ID = 'test-client';
    process.env.CASHFREE_CLIENT_SECRET = 'test-secret';
    process.env.CASHFREE_API_VERSION = '2025-01-01';
    process.env.CASHFREE_BASE_URL = 'https://mock.cashfree.local';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken('auctionQueue'))
      .useValue(auctionQueueMock)
      .overrideProvider(BidsGateway)
      .useValue(bidsGatewayMock)
      .overrideProvider(AuctionProcessor)
      .useValue({})
      .overrideProvider(UploadsService)
      .useValue(uploadsServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    mongoConnection = app.get<Connection>(getConnectionToken());
    userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    auctionModel = app.get<Model<AuctionDocument>>(getModelToken(Auction.name));

    await userModel.deleteMany({
      email: { $in: [creatorEmail, winnerEmail, outsiderEmail] },
    });

    const [creatorHash, winnerHash, outsiderHash] = await Promise.all([
      bcrypt.hash(creatorPassword, 10),
      bcrypt.hash(winnerPassword, 10),
      bcrypt.hash(outsiderPassword, 10),
    ]);

    const [creator, winner, outsider] = await Promise.all([
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

    creatorUserId = String(creator._id);
    winnerUserId = String(winner._id);
    outsiderUserId = String(outsider._id);

    creatorToken = await loginAndGetToken(creatorEmail, creatorPassword);
    winnerToken = await loginAndGetToken(winnerEmail, winnerPassword);
    outsiderToken = await loginAndGetToken(outsiderEmail, outsiderPassword);
  });

  afterAll(async () => {
    process.env.CASHFREE_CLIENT_ID = previousClientId;
    process.env.CASHFREE_CLIENT_SECRET = previousClientSecret;
    process.env.CASHFREE_API_VERSION = previousApiVersion;
    process.env.CASHFREE_BASE_URL = previousBaseUrl;
    global.fetch = originalFetch;

    await auctionModel.deleteMany({
      createdBy: { $in: [creatorUserId, winnerUserId, outsiderUserId] },
    });
    await userModel.deleteMany({
      email: { $in: [creatorEmail, winnerEmail, outsiderEmail] },
    });

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }

    if (app) {
      await app.close();
    }
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await auctionModel.deleteMany({
      createdBy: { $in: [creatorUserId, winnerUserId, outsiderUserId] },
    });
  });

  it('allows creator and winner to create cashfree links but rejects outsider', async () => {
    const auction = await auctionModel.create({
      title: `E2E Pay Auth Auction ${Date.now()}`,
      description: 'payment link auth matrix',
      images: ['https://example.com/e2e-pay-auth-auction.jpg'],
      startingPrice: 1000,
      currentPrice: 1800,
      status: 'ENDED',
      paymentStatus: 'ACTIVE',
      startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
      endTime: new Date(Date.now() - 60 * 1000),
      category: 'collectibles',
      createdBy: creatorUserId,
      winner: winnerUserId,
      highestBidder: winnerUserId,
    });

    const mockedFetch: any = (jest.fn() as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        link_id: `auction_${String(auction._id)}_mock`,
        link_url: 'https://mock.cashfree.local/pay/auction',
        link_status: 'ACTIVE',
      }),
    });

    global.fetch = mockedFetch as any;

    const creatorResponse = await request(app.getHttpServer())
      .post('/v1/payments/cashfree/link')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        auctionId: String(auction._id),
        customerPhone: '9876543210',
      });

    expect(creatorResponse.status).toBe(201);
    expect(creatorResponse.body).toEqual(
      expect.objectContaining({
        message: 'Payment link created successfully',
        auctionId: String(auction._id),
      }),
    );

    const winnerResponse = await request(app.getHttpServer())
      .post('/v1/payments/cashfree/link')
      .set('Authorization', `Bearer ${winnerToken}`)
      .send({
        auctionId: String(auction._id),
        customerPhone: '9876543210',
      });

    expect(winnerResponse.status).toBe(201);
    expect(winnerResponse.body).toEqual(
      expect.objectContaining({
        message: 'Payment link created successfully',
        auctionId: String(auction._id),
      }),
    );

    const outsiderResponse = await request(app.getHttpServer())
      .post('/v1/payments/cashfree/link')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({
        auctionId: String(auction._id),
        customerPhone: '9876543210',
      });

    expect(outsiderResponse.status).toBe(400);
    expect(outsiderResponse.body).toEqual(
      expect.objectContaining({
        message: 'Only auction creator or winner can create payment link',
      }),
    );
  });

  it('rejects notify-payment from outsider and allows creator', async () => {
    const auction = await auctionModel.create({
      title: `E2E Notify Auth Auction ${Date.now()}`,
      description: 'notify-payment auth matrix',
      images: ['https://example.com/e2e-notify-auth-auction.jpg'],
      startingPrice: 1200,
      currentPrice: 1900,
      status: 'ENDED',
      paymentStatus: 'ACTIVE',
      startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
      endTime: new Date(Date.now() - 60 * 1000),
      category: 'collectibles',
      createdBy: creatorUserId,
      winner: winnerUserId,
      highestBidder: winnerUserId,
    });

    global.fetch = (jest.fn() as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        link_id: `auction_${String(auction._id)}_notify`,
        link_url: 'https://mock.cashfree.local/pay/notify',
        link_status: 'ACTIVE',
      }),
    });

    const outsiderResponse = await request(app.getHttpServer())
      .post('/v1/payments/notify-payment')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({
        auctionId: String(auction._id),
        customerPhone: '9876543210',
      });

    expect(outsiderResponse.status).toBe(400);
    expect(outsiderResponse.body).toEqual(
      expect.objectContaining({
        message: 'Only auction creator or winner can create payment link',
      }),
    );

    const creatorResponse = await request(app.getHttpServer())
      .post('/v1/payments/notify-payment')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        auctionId: String(auction._id),
      });

    expect(creatorResponse.status).toBe(201);
    expect(creatorResponse.body).toEqual(
      expect.objectContaining({
        message: 'Payment link created successfully',
        auctionId: String(auction._id),
      }),
    );
  });
});
