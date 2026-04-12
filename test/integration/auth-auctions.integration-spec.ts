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
import {
  Notification,
  NotificationDocument,
} from '../../src/modules/notifications/schemas/notification.schema';
import { UploadsService } from '../../src/modules/uploads/uploads.service';

describe('Integration: auth and auctions wiring', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;
  let notificationModel: Model<NotificationDocument>;
  let seededUserId = '';

  const seededUserEmail = 'integration.auctions.user@ubuy.local';
  const seededUserPassword = 'IntegrationPass123!';
  const seededUsername = 'integration_auctions_user';

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
      .send({
        email,
        password,
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
      .overrideProvider(getQueueToken('auctionQueue'))
      .useValue(auctionQueueMock)
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

    await notificationModel.deleteMany({ userId: seededUserId });
    await auctionModel.deleteMany({ createdBy: seededUserId });
    await userModel.deleteOne({ email: seededUserEmail });

    const creatorHashedPassword = await bcrypt.hash(seededUserPassword, 10);

    const createdUser = await userModel.create({
      email: seededUserEmail,
      username: seededUsername,
      password: creatorHashedPassword,
      provider: 'local',
      isVerified: true,
    });

    seededUserId = String(createdUser._id);
  });

  afterAll(async () => {
    if (notificationModel) {
      await notificationModel.deleteMany({ userId: seededUserId });
    }

    if (auctionModel) {
      await auctionModel.deleteMany({ createdBy: seededUserId });
    }

    if (userModel) {
      await userModel.deleteOne({ email: seededUserEmail });
    }

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  it('creates an auction and exposes it through creator and stats endpoints', async () => {
    const token = await loginAndGetToken(seededUserEmail, seededUserPassword);

    const startTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const endTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const createResponse = await request(app.getHttpServer())
      .post('/v1/auctions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Integration Auction Jacket',
        description: 'Integration test auction for the full stack wiring',
        images: ['https://example.com/integration-auction.jpg'],
        startingPrice: 1500,
        startTime,
        endTime,
        category: 'fashion',
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toEqual(
      expect.objectContaining({
        title: 'Integration Auction Jacket',
        status: 'ACTIVE',
      }),
    );

    expect(auctionQueueMock.add).toHaveBeenCalledWith(
      'endAuction',
      expect.objectContaining({
        auctionId: expect.any(String),
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^endAuction-/),
        delay: expect.any(Number),
      }),
    );

    const createdAuctionsResponse = await request(app.getHttpServer())
      .get('/v1/auctions/me/created')
      .query({ page: 1, limit: 10 })
      .set('Authorization', `Bearer ${token}`);

    expect(createdAuctionsResponse.status).toBe(200);
    expect(createdAuctionsResponse.body).toEqual(
      expect.objectContaining({
        page: 1,
        limit: 10,
        data: expect.any(Array),
      }),
    );
    expect(
      createdAuctionsResponse.body.data.some(
        (item: { title?: string; createdBy?: string }) =>
          item.title === 'Integration Auction Jacket' &&
          item.createdBy === seededUserId,
      ),
    ).toBe(true);

    const latestCreatedAuction = createdAuctionsResponse.body.data.find(
      (item: { title?: string; createdBy?: string }) =>
        item.title === 'Integration Auction Jacket' &&
        item.createdBy === seededUserId,
    );

    expect(latestCreatedAuction).toBeTruthy();

    const bidStatsResponse = await request(app.getHttpServer())
      .get('/v1/users/me/bid-stats')
      .set('Authorization', `Bearer ${token}`);

    expect(bidStatsResponse.status).toBe(200);
    expect(bidStatsResponse.body).toEqual(
      expect.objectContaining({
        totalBids: 0,
        auctionsCreated: expect.any(Number),
        auctionsWon: 0,
      }),
    );
    expect(bidStatsResponse.body.auctionsCreated).toBeGreaterThanOrEqual(1);
  });

  it('rejects anonymous auction creation', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auctions')
      .send({
        title: 'Anonymous Auction',
        description: 'This request should not be allowed',
        images: ['https://example.com/anonymous-auction.jpg'],
        startingPrice: 1000,
        startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        category: 'fashion',
      });

    expect(response.status).toBe(401);
  });
});
