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

jest.setTimeout(30000);

describe('E2E: notification ownership hardening', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let notificationModel: Model<NotificationDocument>;

  const user1Email = 'e2e.notifications.owner1@ubuy.local';
  const user1Password = 'E2ENotificationOwnerPass123!';
  const user1Username = 'e2e_notifications_owner1';

  const user2Email = 'e2e.notifications.owner2@ubuy.local';
  const user2Password = 'E2ENotificationOwnerPass123!';
  const user2Username = 'e2e_notifications_owner2';

  let user1Id = '';
  let user2Id = '';
  let user1Token = '';

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
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    mongoConnection = app.get<Connection>(getConnectionToken());
    userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    notificationModel = app.get<Model<NotificationDocument>>(
      getModelToken(Notification.name),
    );

    await userModel.deleteMany({
      email: { $in: [user1Email, user2Email] },
    });

    const [user1Hash, user2Hash] = await Promise.all([
      bcrypt.hash(user1Password, 10),
      bcrypt.hash(user2Password, 10),
    ]);

    const [user1, user2] = await Promise.all([
      userModel.create({
        email: user1Email,
        username: user1Username,
        password: user1Hash,
        provider: 'local',
        isVerified: true,
      }),
      userModel.create({
        email: user2Email,
        username: user2Username,
        password: user2Hash,
        provider: 'local',
        isVerified: true,
      }),
    ]);

    user1Id = String(user1._id);
    user2Id = String(user2._id);
    user1Token = await loginAndGetToken(user1Email, user1Password);
  });

  afterAll(async () => {
    await notificationModel.deleteMany({ userId: { $in: [user1Id, user2Id] } });
    await userModel.deleteMany({ email: { $in: [user1Email, user2Email] } });

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }

    if (app) {
      await app.close();
    }
  });

  afterEach(async () => {
    await notificationModel.deleteMany({ userId: { $in: [user1Id, user2Id] } });
  });

  it('does not allow deleting another user notification', async () => {
    const user2Notification = await notificationModel.create({
      userId: user2Id,
      type: 'SYSTEM',
      title: 'Owned by user2',
      message: 'Should not be deletable by user1',
      isRead: false,
    });

    const response = await request(app.getHttpServer())
      .delete(`/v1/notifications/${String(user2Notification._id)}`)
      .set('Authorization', `Bearer ${user1Token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        deleted: false,
        notificationId: String(user2Notification._id),
      }),
    );

    const persisted = await notificationModel.findById(user2Notification._id);
    expect(persisted).toBeTruthy();
    expect(persisted?.userId).toBe(user2Id);
  });

  it('does not allow marking another user notification as read', async () => {
    const user2Notification = await notificationModel.create({
      userId: user2Id,
      type: 'SYSTEM',
      title: 'Owned by user2',
      message: 'Should not be updatable by user1',
      isRead: false,
    });

    const response = await request(app.getHttpServer())
      .patch(`/v1/notifications/${String(user2Notification._id)}/read`)
      .set('Authorization', `Bearer ${user1Token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        updated: false,
      }),
    );

    const persisted = await notificationModel.findById(user2Notification._id);
    expect(persisted?.isRead).toBe(false);
  });
});
