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
  Notification,
  NotificationDocument,
} from '../../src/modules/notifications/schemas/notification.schema';
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';
import { BidsGateway } from '../../src/modules/bids/bids.gateway';

describe('E2E: notifications delete journey', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let notificationModel: Model<NotificationDocument>;

  const userEmail = 'e2e.notifications.delete@ubuy.local';
  const userPassword = 'E2ENotificationsDeletePass123!';
  const userUsername = 'e2e_notifications_delete';

  let userId = '';
  let userToken = '';

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
    notificationModel = app.get<Model<NotificationDocument>>(
      getModelToken(Notification.name),
    );

    await userModel.deleteOne({ email: userEmail });

    const hashedPassword = await bcrypt.hash(userPassword, 10);
    const createdUser = await userModel.create({
      email: userEmail,
      username: userUsername,
      password: hashedPassword,
      provider: 'local',
      isVerified: true,
    });

    userId = String(createdUser._id);
    userToken = await loginAndGetToken(userEmail, userPassword);
  });

  afterAll(async () => {
    await notificationModel.deleteMany({ userId });
    await userModel.deleteOne({ email: userEmail });

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  afterEach(async () => {
    await notificationModel.deleteMany({ userId });
  });

  it('deletes read notifications and preserves unread ones', async () => {
    const unread = await notificationModel.create({
      userId,
      type: 'SYSTEM',
      title: 'Unread',
      message: 'Keep me',
      isRead: false,
    });

    const readOne = await notificationModel.create({
      userId,
      type: 'SYSTEM',
      title: 'Read one',
      message: 'Delete me',
      isRead: true,
      readAt: new Date(),
    });

    const readTwo = await notificationModel.create({
      userId,
      type: 'SYSTEM',
      title: 'Read two',
      message: 'Delete me too',
      isRead: true,
      readAt: new Date(),
    });

    const response = await request(app.getHttpServer())
      .delete('/v1/notifications/read')
      .set('Authorization', `Bearer ${userToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        deletedCount: 2,
      }),
    );

    expect(await notificationModel.findById(unread._id)).toBeTruthy();
    expect(await notificationModel.findById(readOne._id)).toBeNull();
    expect(await notificationModel.findById(readTwo._id)).toBeNull();
  });

  it('deletes all notifications for the authenticated user', async () => {
    await notificationModel.create({
      userId,
      type: 'SYSTEM',
      title: 'Unread',
      message: 'Delete all',
      isRead: false,
    });

    await notificationModel.create({
      userId,
      type: 'SYSTEM',
      title: 'Read',
      message: 'Delete all',
      isRead: true,
      readAt: new Date(),
    });

    const response = await request(app.getHttpServer())
      .delete('/v1/notifications')
      .set('Authorization', `Bearer ${userToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        deletedCount: 2,
      }),
    );

    const remaining = await notificationModel.countDocuments({ userId });
    expect(remaining).toBe(0);
  });
});
