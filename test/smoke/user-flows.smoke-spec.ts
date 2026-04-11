import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AppModule } from '../../src/app.module';
import {
  User,
  UserDocument,
} from '../../src/modules/users/schemas/user.schema';
import {
  Notification,
  NotificationDocument,
} from '../../src/modules/notifications/schemas/notification.schema';
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';
import { PaymentsService } from '../../src/modules/payments/payments.service';

describe('Smoke User Flows Suite', () => {
  let app: INestApplication;
  let userModel: Model<UserDocument>;
  let notificationModel: Model<NotificationDocument>;
  let mongoConnection: Connection;
  let auctionQueue: Queue;
  let auctionProcessor: AuctionProcessor;

  const seededUserEmail = 'smoke.userflows@ubuy.local';
  const seededUserPassword = 'SmokeFlowPass123!';
  const seededUsername = 'smoke_userflows';

  let seededUserId = '';

  const paymentsServiceMock = {
    async notifyPaymentForAuction(actorUserId: string, auctionId: string) {
      return {
        message: 'Payment link created successfully',
        auctionId,
        winner: actorUserId,
        linkId: `mock_link_${auctionId}`,
        linkUrl: `https://mock.cashfree.local/pay/${auctionId}`,
        status: 'ACTIVE',
      };
    },
  };

  const loginAndGetToken = async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        email: seededUserEmail,
        password: seededUserPassword,
      });

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
      .overrideProvider(PaymentsService)
      .useValue(paymentsServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();

    userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    notificationModel = app.get<Model<NotificationDocument>>(
      getModelToken(Notification.name),
    );
    mongoConnection = app.get<Connection>(getConnectionToken());
    auctionQueue = app.get<Queue>(getQueueToken('auctionQueue'));
    auctionProcessor = app.get<AuctionProcessor>(AuctionProcessor);

    await userModel.deleteOne({ email: seededUserEmail });

    const hashedPassword = await bcrypt.hash(seededUserPassword, 10);
    const createdUser = await userModel.create({
      email: seededUserEmail,
      username: seededUsername,
      password: hashedPassword,
      provider: 'local',
      isVerified: true,
    });

    seededUserId = String(createdUser._id);
    await notificationModel.deleteMany({ userId: seededUserId });
  });

  afterAll(async () => {
    if (seededUserId) {
      await notificationModel.deleteMany({ userId: seededUserId });
    }

    await userModel.deleteOne({ email: seededUserEmail });

    if (auctionQueue) {
      await auctionQueue.close();
    }

    const worker = (
      auctionProcessor as unknown as {
        worker?: { close: () => Promise<void> };
      }
    ).worker;

    if (worker) {
      await worker.close();
    }

    if (app) {
      await app.close();
    }

    if (mongoConnection.readyState === 1) {
      await mongoConnection.close();
    }
  });

  it('authenticated user notification read/unread lifecycle works', async () => {
    const token = await loginAndGetToken();

    const first = await notificationModel.create({
      userId: seededUserId,
      type: 'SYSTEM',
      title: 'Smoke Notification 1',
      message: 'Unread message 1',
      isRead: false,
      metadata: { source: 'smoke' },
    });

    await notificationModel.create({
      userId: seededUserId,
      type: 'SYSTEM',
      title: 'Smoke Notification 2',
      message: 'Unread message 2',
      isRead: false,
      metadata: { source: 'smoke' },
    });

    const unreadBefore = await request(app.getHttpServer())
      .get('/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);

    expect(unreadBefore.status).toBe(200);
    expect(unreadBefore.body).toEqual(
      expect.objectContaining({
        unreadCount: expect.any(Number),
      }),
    );
    expect(unreadBefore.body.unreadCount).toBeGreaterThanOrEqual(2);

    const listResponse = await request(app.getHttpServer())
      .get('/v1/notifications')
      .query({ page: 1, limit: 10 })
      .set('Authorization', `Bearer ${token}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toEqual(
      expect.objectContaining({
        items: expect.any(Array),
        total: expect.any(Number),
      }),
    );
    expect(listResponse.body.items.length).toBeGreaterThanOrEqual(2);

    const markReadResponse = await request(app.getHttpServer())
      .patch(`/v1/notifications/${String(first._id)}/read`)
      .set('Authorization', `Bearer ${token}`);

    expect(markReadResponse.status).toBe(200);
    expect(markReadResponse.body).toEqual(
      expect.objectContaining({
        updated: true,
      }),
    );

    const unreadAfterOneRead = await request(app.getHttpServer())
      .get('/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);

    expect(unreadAfterOneRead.status).toBe(200);
    expect(unreadAfterOneRead.body.unreadCount).toBeGreaterThanOrEqual(1);

    const readAllResponse = await request(app.getHttpServer())
      .patch('/v1/notifications/read-all')
      .set('Authorization', `Bearer ${token}`);

    expect(readAllResponse.status).toBe(200);

    const unreadAfterReadAll = await request(app.getHttpServer())
      .get('/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);

    expect(unreadAfterReadAll.status).toBe(200);
    expect(unreadAfterReadAll.body.unreadCount).toBe(0);
  });

  it('authenticated user can create payment link via notify-payment endpoint', async () => {
    const token = await loginAndGetToken();

    const response = await request(app.getHttpServer())
      .post('/v1/payments/notify-payment')
      .set('Authorization', `Bearer ${token}`)
      .send({
        auctionId: '507f1f77bcf86cd799439011',
        customerPhone: '9876543210',
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'Payment link created successfully',
        auctionId: '507f1f77bcf86cd799439011',
        linkUrl: expect.any(String),
      }),
    );
  });
});
