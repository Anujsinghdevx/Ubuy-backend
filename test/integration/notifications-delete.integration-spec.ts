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

describe('Integration: notifications delete behavior', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let notificationModel: Model<NotificationDocument>;

  const user1Email = 'integration.notif-delete.user1@ubuy.local';
  const user1Password = 'IntegrationNotifPass123!';
  const user1Username = 'integration_notif_delete_user1';

  const user2Email = 'integration.notif-delete.user2@ubuy.local';
  const user2Password = 'IntegrationNotifPass123!';
  const user2Username = 'integration_notif_delete_user2';

  let user1Id = '';
  let user2Id = '';
  let user1Token = '';
  let user2Token = '';

  const auctionQueueMock: any = {
    add: jest.fn() as jest.Mock,
    getJob: jest.fn() as jest.Mock,
    close: jest.fn() as jest.Mock,
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

    // Clean up existing test users
    await userModel.deleteOne({ email: user1Email });
    await userModel.deleteOne({ email: user2Email });

    const [user1HashedPassword, user2HashedPassword] = await Promise.all([
      bcrypt.hash(user1Password, 10),
      bcrypt.hash(user2Password, 10),
    ]);

    const createdUser1 = await userModel.create({
      email: user1Email,
      username: user1Username,
      password: user1HashedPassword,
      provider: 'local',
      isVerified: true,
    });

    const createdUser2 = await userModel.create({
      email: user2Email,
      username: user2Username,
      password: user2HashedPassword,
      provider: 'local',
      isVerified: true,
    });

    user1Id = String(createdUser1._id);
    user2Id = String(createdUser2._id);

    user1Token = await loginAndGetToken(user1Email, user1Password);
    user2Token = await loginAndGetToken(user2Email, user2Password);
  });

  afterAll(async () => {
    await userModel.deleteOne({ email: user1Email });
    await userModel.deleteOne({ email: user2Email });

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  afterEach(async () => {
    await notificationModel.deleteMany({
      userId: { $in: [user1Id, user2Id] },
    });
  });

  describe('DELETE /read - delete read notifications only', () => {
    it('should delete only read notifications, leaving unread intact', async () => {
      // Arrange: Create mix of read and unread notifications for user1
      const unreadNotif = await notificationModel.create({
        userId: user1Id,
        type: 'SYSTEM',
        title: 'Unread notification',
        message: 'This should remain',
        isRead: false,
      });

      const readNotif1 = await notificationModel.create({
        userId: user1Id,
        type: 'SYSTEM',
        title: 'Read notification 1',
        message: 'This should be deleted',
        isRead: true,
        readAt: new Date(),
      });

      const readNotif2 = await notificationModel.create({
        userId: user1Id,
        type: 'SYSTEM',
        title: 'Read notification 2',
        message: 'This should also be deleted',
        isRead: true,
        readAt: new Date(),
      });

      // Act: Delete read notifications
      const response = await request(app.getHttpServer())
        .delete('/v1/notifications/read')
        .set('Authorization', `Bearer ${user1Token}`);

      // Assert: Response indicates 2 deleted
      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          deletedCount: 2,
        }),
      );

      // Assert: Unread notification still exists
      const remainingNotif = await notificationModel.findById(unreadNotif._id);
      expect(remainingNotif).toBeDefined();
      expect(remainingNotif?.isRead).toBe(false);

      // Assert: Read notifications are deleted
      const deletedNotif1 = await notificationModel.findById(readNotif1._id);
      const deletedNotif2 = await notificationModel.findById(readNotif2._id);
      expect(deletedNotif1).toBeNull();
      expect(deletedNotif2).toBeNull();
    });

    it('should return 0 when no read notifications exist', async () => {
      // Arrange: Create only unread notifications
      await notificationModel.create({
        userId: user1Id,
        type: 'SYSTEM',
        title: 'Only unread',
        message: 'No read notifications',
        isRead: false,
      });

      // Act: Delete read notifications
      const response = await request(app.getHttpServer())
        .delete('/v1/notifications/read')
        .set('Authorization', `Bearer ${user1Token}`);

      // Assert: Response indicates 0 deleted
      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          deletedCount: 0,
        }),
      );

      // Assert: Unread notification still exists
      const remaining = await notificationModel.countDocuments({
        userId: user1Id,
      });
      expect(remaining).toBe(1);
    });

    it('should not delete read notifications from other users', async () => {
      // Arrange: Create read notifications for user2
      const user2ReadNotif = await notificationModel.create({
        userId: user2Id,
        type: 'SYSTEM',
        title: 'User2 read notification',
        message: 'Should not be deleted',
        isRead: true,
        readAt: new Date(),
      });

      // Act: User1 deletes read notifications
      const response = await request(app.getHttpServer())
        .delete('/v1/notifications/read')
        .set('Authorization', `Bearer ${user1Token}`);

      // Assert: Response indicates 0 deleted (user1 has no read notifs)
      expect(response.status).toBe(200);
      expect(response.body.deletedCount).toBe(0);

      // Assert: User2's read notification still exists
      const user2Notif = await notificationModel.findById(user2ReadNotif._id);
      expect(user2Notif).toBeDefined();
      expect(user2Notif?.userId.toString()).toBe(user2Id);
    });
  });

  describe('DELETE / - delete all notifications', () => {
    it('should delete all notifications (both read and unread)', async () => {
      // Arrange: Create mix of read and unread notifications
      await notificationModel.create({
        userId: user1Id,
        type: 'SYSTEM',
        title: 'Unread 1',
        message: 'Message 1',
        isRead: false,
      });

      await notificationModel.create({
        userId: user1Id,
        type: 'SYSTEM',
        title: 'Read 1',
        message: 'Message 2',
        isRead: true,
        readAt: new Date(),
      });

      await notificationModel.create({
        userId: user1Id,
        type: 'AUCTION_WON',
        title: 'Unread 2',
        message: 'Message 3',
        isRead: false,
      });

      // Verify setup
      let countBefore = await notificationModel.countDocuments({
        userId: user1Id,
      });
      expect(countBefore).toBe(3);

      // Act: Delete all notifications
      const response = await request(app.getHttpServer())
        .delete('/v1/notifications')
        .set('Authorization', `Bearer ${user1Token}`);

      // Assert: Response indicates 3 deleted
      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          deletedCount: 3,
        }),
      );

      // Assert: All notifications deleted for user1
      const countAfter = await notificationModel.countDocuments({
        userId: user1Id,
      });
      expect(countAfter).toBe(0);
    });

    it('should return 0 when no notifications exist', async () => {
      // Act: Delete all notifications (empty)
      const response = await request(app.getHttpServer())
        .delete('/v1/notifications')
        .set('Authorization', `Bearer ${user1Token}`);

      // Assert: Response indicates 0 deleted
      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          deletedCount: 0,
        }),
      );
    });

    it('should not delete all notifications from other users', async () => {
      // Arrange: Create notifications for both users
      const user2Notif = await notificationModel.create({
        userId: user2Id,
        type: 'SYSTEM',
        title: 'User2 notification',
        message: 'Should not be affected',
        isRead: false,
      });

      // Act: User1 deletes all notifications
      const response = await request(app.getHttpServer())
        .delete('/v1/notifications')
        .set('Authorization', `Bearer ${user1Token}`);

      // Assert: Response indicates 0 deleted (user1 has none)
      expect(response.status).toBe(200);
      expect(response.body.deletedCount).toBe(0);

      // Assert: User2's notification still exists
      const user2NotifAfter = await notificationModel.findById(user2Notif._id);
      expect(user2NotifAfter).toBeDefined();
      expect(user2NotifAfter?.userId.toString()).toBe(user2Id);
    });
  });

  describe('Delete behavior consistency', () => {
    it('should preserve unread count after DELETE /read', async () => {
      // Arrange: Create 3 unread, 2 read
      await notificationModel.create({
        userId: user1Id,
        type: 'SYSTEM',
        title: 'Unread 1',
        message: 'Message 1',
        isRead: false,
      });

      await notificationModel.create({
        userId: user1Id,
        type: 'SYSTEM',
        title: 'Unread 2',
        message: 'Message 2',
        isRead: false,
      });

      await notificationModel.create({
        userId: user1Id,
        type: 'SYSTEM',
        title: 'Unread 3',
        message: 'Message 3',
        isRead: false,
      });

      await notificationModel.create({
        userId: user1Id,
        type: 'SYSTEM',
        title: 'Read 1',
        message: 'Message 4',
        isRead: true,
        readAt: new Date(),
      });

      await notificationModel.create({
        userId: user1Id,
        type: 'SYSTEM',
        title: 'Read 2',
        message: 'Message 5',
        isRead: true,
        readAt: new Date(),
      });

      // Get unread count before
      let unreadBefore = await request(app.getHttpServer())
        .get('/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(unreadBefore.status).toBe(200);
      expect(unreadBefore.body.unreadCount).toBe(3);

      // Act: Delete read notifications
      const deleteResponse = await request(app.getHttpServer())
        .delete('/v1/notifications/read')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(deleteResponse.body.deletedCount).toBe(2);

      // Assert: Unread count unchanged (still 3)
      const unreadAfter = await request(app.getHttpServer())
        .get('/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(unreadAfter.status).toBe(200);
      expect(unreadAfter.body.unreadCount).toBe(3);
    });

    it('should drop unread count to 0 after DELETE /', async () => {
      // Arrange: Create 5 unread notifications
      for (let i = 0; i < 5; i++) {
        await notificationModel.create({
          userId: user1Id,
          type: 'SYSTEM',
          title: `Unread ${i + 1}`,
          message: `Message ${i + 1}`,
          isRead: false,
        });
      }

      // Get unread count before
      const unreadBefore = await request(app.getHttpServer())
        .get('/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(unreadBefore.body.unreadCount).toBe(5);

      // Act: Delete all notifications
      await request(app.getHttpServer())
        .delete('/v1/notifications')
        .set('Authorization', `Bearer ${user1Token}`);

      // Assert: Unread count is 0
      const unreadAfter = await request(app.getHttpServer())
        .get('/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(unreadAfter.status).toBe(200);
      expect(unreadAfter.body.unreadCount).toBe(0);
    });
  });

  describe('Anonymous delete rejection', () => {
    it('should reject DELETE /read without token', async () => {
      // Act: Delete read without token
      const response = await request(app.getHttpServer()).delete(
        '/v1/notifications/read',
      );

      // Assert: 401 or 403 error
      expect([401, 403]).toContain(response.status);
      expect(response.body).toEqual(
        expect.objectContaining({
          message: expect.stringMatching(
            /unauthorized|forbidden|you must be logged|requires authentication/i,
          ),
        }),
      );
    });

    it('should reject DELETE / without token', async () => {
      // Act: Delete all without token
      const response = await request(app.getHttpServer()).delete(
        '/v1/notifications',
      );

      // Assert: 401 or 403 error
      expect([401, 403]).toContain(response.status);
      expect(response.body).toEqual(
        expect.objectContaining({
          message: expect.stringMatching(
            /unauthorized|forbidden|you must be logged|requires authentication/i,
          ),
        }),
      );
    });
  });
});
