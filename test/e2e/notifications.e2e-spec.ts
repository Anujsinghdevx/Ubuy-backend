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
  Notification,
  NotificationDocument,
} from '../../src/modules/notifications/schemas/notification.schema';
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';

describe('E2E: notifications journey', () => {
  let app: INestApplication;
  let userModel: Model<UserDocument>;
  let notificationModel: Model<NotificationDocument>;
  let mongoConnection: Connection;

  const seededEmail = 'e2e.notifications.user@ubuy.local';
  const seededPassword = 'E2ENotificationsPass123!';
  const seededUsername = 'e2e_notifications_user';
  let seededUserId = '';

  const auctionQueueMock: any = {
    add: jest.fn(),
    getJob: jest.fn(),
    close: jest.fn(),
  };

  auctionQueueMock.add.mockResolvedValue({ id: 'mock-end-auction-job' });
  auctionQueueMock.getJob.mockResolvedValue(null);
  auctionQueueMock.close.mockResolvedValue(undefined);

  const loginAndGetToken = async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        email: seededEmail,
        password: seededPassword,
      });

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

    await userModel.deleteOne({ email: seededEmail });

    const hashedPassword = await bcrypt.hash(seededPassword, 10);
    const createdUser = await userModel.create({
      email: seededEmail,
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

    if (userModel) {
      await userModel.deleteOne({ email: seededEmail });
    }

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  it('supports unread count and read-all lifecycle for authenticated user', async () => {
    const token = await loginAndGetToken();

    await notificationModel.create({
      userId: seededUserId,
      type: 'SYSTEM',
      title: 'E2E Notification 1',
      message: 'First unread message',
      isRead: false,
      metadata: { source: 'e2e' },
    });

    await notificationModel.create({
      userId: seededUserId,
      type: 'SYSTEM',
      title: 'E2E Notification 2',
      message: 'Second unread message',
      isRead: false,
      metadata: { source: 'e2e' },
    });

    const unreadBefore = await request(app.getHttpServer())
      .get('/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);

    expect(unreadBefore.status).toBe(200);
    expect(unreadBefore.body.unreadCount).toBeGreaterThanOrEqual(2);

    const readAllResponse = await request(app.getHttpServer())
      .patch('/v1/notifications/read-all')
      .set('Authorization', `Bearer ${token}`);

    expect(readAllResponse.status).toBe(200);

    const unreadAfter = await request(app.getHttpServer())
      .get('/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);

    expect(unreadAfter.status).toBe(200);
    expect(unreadAfter.body.unreadCount).toBe(0);
  });
});
