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
import { UploadsService } from '../../src/modules/uploads/uploads.service';
import { BidsGateway } from '../../src/modules/bids/bids.gateway';

jest.setTimeout(30000);

describe('Integration: payments flow', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;
  let notificationModel: Model<NotificationDocument>;
  let creatorUserId = '';
  let winnerUserId = '';

  const creatorEmail = 'integration.payments.creator@ubuy.local';
  const creatorPassword = 'IntegrationPaymentsCreator123!';
  const creatorUsername = 'integration_payments_creator';
  const winnerEmail = 'integration.payments.winner@ubuy.local';
  const winnerPassword = 'IntegrationPaymentsWinner123!';
  const winnerUsername = 'integration_payments_winner';

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
    notificationModel = app.get<Model<NotificationDocument>>(
      getModelToken(Notification.name),
    );

    await notificationModel.deleteMany({});
    await auctionModel.deleteMany({});
    await userModel.deleteOne({ email: winnerEmail });
    await userModel.deleteOne({ email: creatorEmail });

    const [creatorHashedPassword, winnerHashedPassword] = await Promise.all([
      bcrypt.hash(creatorPassword, 10),
      bcrypt.hash(winnerPassword, 10),
    ]);

    const creatorUser = await userModel.create({
      email: creatorEmail,
      username: creatorUsername,
      password: creatorHashedPassword,
      provider: 'local',
      isVerified: true,
    });

    const winnerUser = await userModel.create({
      email: winnerEmail,
      username: winnerUsername,
      password: winnerHashedPassword,
      provider: 'local',
      isVerified: true,
    });

    creatorUserId = String(creatorUser._id);
    winnerUserId = String(winnerUser._id);
  });

  afterAll(async () => {
    if (notificationModel) {
      await notificationModel.deleteMany({
        userId: { $in: [creatorUserId, winnerUserId] },
      });
    }

    if (auctionModel) {
      await auctionModel.deleteMany({
        createdBy: { $in: [creatorUserId, winnerUserId] },
      });
    }

    if (userModel) {
      await userModel.deleteOne({ email: winnerEmail });
      await userModel.deleteOne({ email: creatorEmail });
    }

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  it('processes payment webhook and marks ended auction as paid', async () => {
    const endedAuction = await auctionModel.create({
      title: 'Integration Payment Auction',
      description: 'Ended auction used for payment webhook integration',
      images: ['https://example.com/integration-payment-auction.jpg'],
      startingPrice: 3000,
      currentPrice: 3600,
      status: 'ENDED',
      startTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
      endTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
      category: 'electronics',
      createdBy: creatorUserId,
      highestBidder: winnerUserId,
      winner: winnerUserId,
      paymentStatus: 'ACTIVE',
      notified: true,
    });

    let webhookRequest = request(app.getHttpServer())
      .post('/v1/payments/webhook')
      .send({
        auctionId: String(endedAuction._id),
        status: 'SUCCESS',
        winnerUserId,
        providerPaymentId: 'integration-provider-payment-001',
      });

    if (process.env.PAYMENT_WEBHOOK_SECRET) {
      webhookRequest = webhookRequest.set(
        'x-webhook-secret',
        process.env.PAYMENT_WEBHOOK_SECRET,
      );
    }

    const webhookResponse = await webhookRequest;

    expect(webhookResponse.status).toBe(201);
    expect(webhookResponse.body).toEqual(
      expect.objectContaining({
        accepted: true,
        message: 'Payment webhook processed successfully',
      }),
    );

    const updatedAuction = await auctionModel.findById(endedAuction._id).lean();
    expect(updatedAuction?.paymentStatus).toBe('PAID');

    const paymentNotifications = await notificationModel.find({
      userId: { $in: [creatorUserId, winnerUserId] },
      'metadata.auctionId': String(endedAuction._id),
    });

    expect(paymentNotifications.length).toBeGreaterThanOrEqual(2);
  });

  it('does not mark auction as paid when webhook status is FAILED', async () => {
    const endedAuction = await auctionModel.create({
      title: 'Integration Failed Payment Auction',
      description: 'Failed webhook should keep payment status active',
      images: ['https://example.com/integration-failed-payment-auction.jpg'],
      startingPrice: 4500,
      currentPrice: 5100,
      status: 'ENDED',
      startTime: new Date(Date.now() - 4 * 60 * 60 * 1000),
      endTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
      category: 'collectibles',
      createdBy: creatorUserId,
      highestBidder: winnerUserId,
      winner: winnerUserId,
      paymentStatus: 'ACTIVE',
      notified: true,
    });

    let webhookRequest = request(app.getHttpServer())
      .post('/v1/payments/webhook')
      .send({
        auctionId: String(endedAuction._id),
        status: 'FAILED',
        winnerUserId,
        providerPaymentId: 'integration-provider-payment-failed-001',
      });

    if (process.env.PAYMENT_WEBHOOK_SECRET) {
      webhookRequest = webhookRequest.set(
        'x-webhook-secret',
        process.env.PAYMENT_WEBHOOK_SECRET,
      );
    }

    const webhookResponse = await webhookRequest;

    expect(webhookResponse.status).toBe(201);
    expect(webhookResponse.body).toEqual(
      expect.objectContaining({
        accepted: true,
        message: 'Payment failure received. Auction remains unpaid.',
      }),
    );

    const updatedAuction = await auctionModel.findById(endedAuction._id).lean();
    expect(updatedAuction?.paymentStatus).toBe('ACTIVE');

    const paymentSuccessNotifications = await notificationModel.find({
      userId: { $in: [creatorUserId, winnerUserId] },
      'metadata.auctionId': String(endedAuction._id),
      type: 'PAYMENT_SUCCESS',
    });

    expect(paymentSuccessNotifications).toHaveLength(0);
  });
});
