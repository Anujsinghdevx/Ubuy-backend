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
import {
  Notification,
  NotificationDocument,
} from '../../src/modules/notifications/schemas/notification.schema';
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';
import { BidsGateway } from '../../src/modules/bids/bids.gateway';
import { UploadsService } from '../../src/modules/uploads/uploads.service';

jest.setTimeout(30000);

describe('E2E: payments webhook security and idempotency', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;
  let notificationModel: Model<NotificationDocument>;

  const creatorEmail = 'e2e.webhook.creator@ubuy.local';
  const creatorPassword = 'E2EWebhookCreatorPass123!';
  const creatorUsername = 'e2e_webhook_creator';

  const winnerEmail = 'e2e.webhook.winner@ubuy.local';
  const winnerPassword = 'E2EWebhookWinnerPass123!';
  const winnerUsername = 'e2e_webhook_winner';

  let creatorUserId = '';
  let winnerUserId = '';

  const webhookSecret = 'e2e-webhook-secret';
  const previousWebhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;

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
    process.env.PAYMENT_WEBHOOK_SECRET = webhookSecret;

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
    notificationModel = app.get<Model<NotificationDocument>>(
      getModelToken(Notification.name),
    );

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
    process.env.PAYMENT_WEBHOOK_SECRET = previousWebhookSecret;

    await notificationModel.deleteMany({
      userId: { $in: [creatorUserId, winnerUserId] },
    });
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
    await notificationModel.deleteMany({
      userId: { $in: [creatorUserId, winnerUserId] },
    });
    await auctionModel.deleteMany({ createdBy: creatorUserId });
  });

  it('rejects webhook request when secret header is missing', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/payments/webhook')
      .send({
        auctionId: '507f1f77bcf86cd799439011',
        status: 'FAILED',
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'Invalid webhook secret',
      }),
    );
  });

  it('handles duplicate success webhooks idempotently', async () => {
    const auction = await auctionModel.create({
      title: `E2E Webhook Auction ${Date.now()}`,
      description: 'Webhook idempotency e2e',
      images: ['https://example.com/e2e-webhook-auction.jpg'],
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
      notified: true,
    });

    const payload = {
      auctionId: String(auction._id),
      status: 'SUCCESS' as const,
      winnerUserId,
      providerPaymentId: 'e2e-webhook-provider-001',
    };

    const firstResponse = await request(app.getHttpServer())
      .post('/v1/payments/webhook')
      .set('x-webhook-secret', webhookSecret)
      .send(payload);

    expect(firstResponse.status).toBe(201);
    expect(firstResponse.body).toEqual(
      expect.objectContaining({
        accepted: true,
        message: 'Payment webhook processed successfully',
      }),
    );

    const secondResponse = await request(app.getHttpServer())
      .post('/v1/payments/webhook')
      .set('x-webhook-secret', webhookSecret)
      .send(payload);

    expect(secondResponse.status).toBe(201);
    expect(secondResponse.body).toEqual(
      expect.objectContaining({
        accepted: true,
        message: 'Payment webhook processed successfully',
      }),
    );

    const updatedAuction = await auctionModel.findById(auction._id).lean();
    expect(updatedAuction?.paymentStatus).toBe('PAID');

    const notifications = await notificationModel.find({
      userId: { $in: [creatorUserId, winnerUserId] },
      'metadata.auctionId': String(auction._id),
    });

    expect(notifications.length).toBe(2);
  });
});
