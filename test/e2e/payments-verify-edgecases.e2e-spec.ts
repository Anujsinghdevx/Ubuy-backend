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

describe('E2E: payments verify edge cases', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;

  const creatorEmail = 'e2e.verify.creator@ubuy.local';
  const creatorPassword = 'E2EVerifyCreatorPass123!';
  const creatorUsername = 'e2e_verify_creator';

  const winnerEmail = 'e2e.verify.winner@ubuy.local';
  const winnerPassword = 'E2EVerifyWinnerPass123!';
  const winnerUsername = 'e2e_verify_winner';

  let creatorUserId = '';
  let winnerUserId = '';

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

    await userModel.deleteMany({ email: { $in: [creatorEmail, winnerEmail] } });

    const [creatorHash, winnerHash] = await Promise.all([
      bcrypt.hash(creatorPassword, 10),
      bcrypt.hash(winnerPassword, 10),
    ]);

    const [creator, winner] = await Promise.all([
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
    ]);

    creatorUserId = String(creator._id);
    winnerUserId = String(winner._id);
  });

  afterAll(async () => {
    process.env.CASHFREE_CLIENT_ID = previousClientId;
    process.env.CASHFREE_CLIENT_SECRET = previousClientSecret;
    process.env.CASHFREE_API_VERSION = previousApiVersion;
    process.env.CASHFREE_BASE_URL = previousBaseUrl;
    global.fetch = originalFetch;

    await auctionModel.deleteMany({ createdBy: creatorUserId });
    await userModel.deleteMany({ email: { $in: [creatorEmail, winnerEmail] } });

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }

    if (app) {
      await app.close();
    }
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await auctionModel.deleteMany({ createdBy: creatorUserId });
  });

  it('rejects verify when payment link is not PAID', async () => {
    global.fetch = (jest.fn() as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        link_status: 'ACTIVE',
      }),
    });

    const response = await request(app.getHttpServer())
      .get('/v1/payments/cashfree/verify')
      .query({ linkId: 'auction_507f1f77bcf86cd799439011_123' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'Payment not successful',
      }),
    );
  });

  it('rejects verify when link id format is invalid', async () => {
    global.fetch = (jest.fn() as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        link_status: 'PAID',
        customer_details: {
          customer_email: winnerEmail,
        },
        link_id: 'mock-link-id',
      }),
    });

    const response = await request(app.getHttpServer())
      .get('/v1/payments/cashfree/verify')
      .query({ linkId: 'invalid-link-format' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'Invalid linkId format for auction payment',
      }),
    );
  });

  it('rejects verify when winner email mismatches cashfree response', async () => {
    const auction = await auctionModel.create({
      title: `E2E Verify Auction ${Date.now()}`,
      description: 'verify email mismatch case',
      images: ['https://example.com/e2e-verify-auction.jpg'],
      startingPrice: 1000,
      currentPrice: 1400,
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
        link_status: 'PAID',
        customer_details: {
          customer_email: 'different@ubuy.local',
        },
        link_id: 'mock-link-id',
      }),
    });

    const response = await request(app.getHttpServer())
      .get('/v1/payments/cashfree/verify')
      .query({ linkId: `auction_${String(auction._id)}_123` });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: "Winner's email does not match Cashfree response",
      }),
    );
  });
});
