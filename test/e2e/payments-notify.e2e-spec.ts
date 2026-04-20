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
import { PaymentsService } from '../../src/modules/payments/payments.service';

describe('E2E: payment notify journey', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;

  const creatorEmail = 'e2e.payments.creator@ubuy.local';
  const creatorPassword = 'E2EPaymentsCreatorPass123!';
  const creatorUsername = 'e2e_payments_creator';

  const winnerEmail = 'e2e.payments.winner@ubuy.local';
  const winnerPassword = 'E2EPaymentsWinnerPass123!';
  const winnerUsername = 'e2e_payments_winner';

  let creatorUserId = '';
  let winnerUserId = '';
  let creatorToken = '';

  const auctionQueueMock: any = {
    add: jest.fn(),
    getJob: jest.fn(),
    close: jest.fn(),
  };

  auctionQueueMock.add.mockResolvedValue({ id: 'mock-end-auction-job' });
  auctionQueueMock.getJob.mockResolvedValue(null);
  auctionQueueMock.close.mockResolvedValue(undefined);

  const paymentsServiceMock: any = {
    notifyPaymentForAuction: jest.fn(),
  };

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
      .overrideProvider(PaymentsService)
      .useValue(paymentsServiceMock)
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

    await userModel.deleteMany({ email: { $in: [creatorEmail, winnerEmail] } });

    const [creatorHash, winnerHash] = await Promise.all([
      bcrypt.hash(creatorPassword, 10),
      bcrypt.hash(winnerPassword, 10),
    ]);

    const [creatorUser, winnerUser] = await Promise.all([
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

    creatorUserId = String(creatorUser._id);
    winnerUserId = String(winnerUser._id);
    creatorToken = await loginAndGetToken(creatorEmail, creatorPassword);
  });

  afterAll(async () => {
    await auctionModel.deleteMany({ createdBy: creatorUserId });
    await userModel.deleteMany({ email: { $in: [creatorEmail, winnerEmail] } });

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  it('creates a payment notification link for an ended auction', async () => {
    const auction = await auctionModel.create({
      title: `E2E Payments Auction ${Date.now()}`,
      description: 'E2E payment notify auction',
      images: ['https://example.com/e2e-payments-auction.jpg'],
      startingPrice: 1000,
      currentPrice: 1500,
      status: 'ENDED',
      paymentStatus: 'ACTIVE',
      startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
      endTime: new Date(Date.now() - 60 * 1000),
      category: 'collectibles',
      createdBy: creatorUserId,
      winner: winnerUserId,
      highestBidder: winnerUserId,
    });

    paymentsServiceMock.notifyPaymentForAuction.mockResolvedValueOnce({
      message: 'Payment link created successfully',
      auctionId: String(auction._id),
      winner: winnerUserId,
      linkId: `auction_${auction._id}_mock`,
      linkUrl: 'https://mock.cashfree.local/pay/link',
      status: 'ACTIVE',
    });

    const response = await request(app.getHttpServer())
      .post('/v1/payments/notify-payment')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        auctionId: String(auction._id),
        customerPhone: '9876543210',
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'Payment link created successfully',
        auctionId: String(auction._id),
        linkUrl: expect.stringMatching(/^https?:\/\//),
      }),
    );
  });

  it('rejects notify-payment without authentication', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/payments/notify-payment')
      .send({
        auctionId: '507f1f77bcf86cd799439011',
        customerPhone: '9876543210',
      });

    expect([401, 403]).toContain(response.status);
  });
});
