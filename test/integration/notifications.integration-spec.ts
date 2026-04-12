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
import { UploadsService } from '../../src/modules/uploads/uploads.service';

describe('Integration: notifications negative paths', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let notificationModel: Model<NotificationDocument>;

  let userOneId = '';
  let userTwoId = '';

  const userOneEmail = 'integration.notifications.one@ubuy.local';
  const userOnePassword = 'IntegrationNotificationsOne123!';
  const userOneUsername = 'integration_notifications_one';

  const userTwoEmail = 'integration.notifications.two@ubuy.local';
  const userTwoPassword = 'IntegrationNotificationsTwo123!';
  const userTwoUsername = 'integration_notifications_two';

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
      .overrideProvider(UploadsService)
      .useValue(uploadsServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    mongoConnection = app.get<Connection>(getConnectionToken());
    userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    notificationModel = app.get<Model<NotificationDocument>>(
      getModelToken(Notification.name),
    );

    await notificationModel.deleteMany({});
    await userModel.deleteOne({ email: userTwoEmail });
    await userModel.deleteOne({ email: userOneEmail });

    const [userOneHash, userTwoHash] = await Promise.all([
      bcrypt.hash(userOnePassword, 10),
      bcrypt.hash(userTwoPassword, 10),
    ]);

    const userOne = await userModel.create({
      email: userOneEmail,
      username: userOneUsername,
      password: userOneHash,
      provider: 'local',
      isVerified: true,
    });

    const userTwo = await userModel.create({
      email: userTwoEmail,
      username: userTwoUsername,
      password: userTwoHash,
      provider: 'local',
      isVerified: true,
    });

    userOneId = String(userOne._id);
    userTwoId = String(userTwo._id);
  });

  afterAll(async () => {
    if (notificationModel) {
      await notificationModel.deleteMany({
        userId: { $in: [userOneId, userTwoId] },
      });
    }

    if (userModel) {
      await userModel.deleteOne({ email: userTwoEmail });
      await userModel.deleteOne({ email: userOneEmail });
    }

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  it('returns updated false when marking a non-existent notification as read', async () => {
    const token = await loginAndGetToken(userOneEmail, userOnePassword);

    const response = await request(app.getHttpServer())
      .patch('/v1/notifications/507f1f77bcf86cd799439011/read')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        updated: false,
      }),
    );
  });

  it('prevents cross-user notification updates and deletes', async () => {
    const userTwoToken = await loginAndGetToken(userTwoEmail, userTwoPassword);

    const userOneNotification = await notificationModel.create({
      userId: userOneId,
      type: 'SYSTEM',
      title: 'Private Notification',
      message: 'Owned by user one',
      isRead: false,
      metadata: { source: 'integration' },
    });

    const markReadResponse = await request(app.getHttpServer())
      .patch(`/v1/notifications/${String(userOneNotification._id)}/read`)
      .set('Authorization', `Bearer ${userTwoToken}`);

    expect(markReadResponse.status).toBe(200);
    expect(markReadResponse.body).toEqual(
      expect.objectContaining({
        updated: false,
      }),
    );

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/v1/notifications/${String(userOneNotification._id)}`)
      .set('Authorization', `Bearer ${userTwoToken}`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toEqual(
      expect.objectContaining({
        deleted: false,
      }),
    );
  });

  it('keeps unread count consistent after mark-all-read', async () => {
    const token = await loginAndGetToken(userOneEmail, userOnePassword);

    await notificationModel.deleteMany({ userId: userOneId });
    await notificationModel.create([
      {
        userId: userOneId,
        type: 'SYSTEM',
        title: 'Unread 1',
        message: 'Unread test message 1',
        isRead: false,
      },
      {
        userId: userOneId,
        type: 'SYSTEM',
        title: 'Unread 2',
        message: 'Unread test message 2',
        isRead: false,
      },
    ]);

    const unreadBefore = await request(app.getHttpServer())
      .get('/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);

    expect(unreadBefore.status).toBe(200);
    expect(unreadBefore.body.unreadCount).toBeGreaterThanOrEqual(2);

    const readAllResponse = await request(app.getHttpServer())
      .patch('/v1/notifications/read-all')
      .set('Authorization', `Bearer ${token}`);

    expect(readAllResponse.status).toBe(200);
    expect(readAllResponse.body.updatedCount).toBeGreaterThanOrEqual(2);

    const unreadAfter = await request(app.getHttpServer())
      .get('/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);

    expect(unreadAfter.status).toBe(200);
    expect(unreadAfter.body.unreadCount).toBe(0);
  });

  it('rejects anonymous notification access', async () => {
    const response = await request(app.getHttpServer()).get(
      '/v1/notifications/unread-count',
    );

    expect(response.status).toBe(401);
  });
});
