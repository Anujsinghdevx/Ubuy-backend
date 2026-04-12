import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { VersioningType } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { getModelToken, getConnectionToken } from '@nestjs/mongoose';
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
  Auction,
  AuctionDocument,
} from '../../src/modules/auctions/schemas/auction.schema';
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';

describe('Smoke Test Suite', () => {
  let app: INestApplication;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;
  let mongoConnection: Connection;
  let auctionQueue: Queue;
  let auctionProcessor: AuctionProcessor;
  const seededUserEmail = 'smoke.auth.user@ubuy.local';
  const seededUserPassword = 'SmokePass123!';
  const seededUsername = 'smoke_auth_user';
  let seededUserId = '';
  let seededAuctionId = '';
  let cancellableAuctionId = '';
  let endableAuctionId = '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();

    userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    auctionModel = app.get<Model<AuctionDocument>>(getModelToken(Auction.name));
    mongoConnection = app.get<Connection>(getConnectionToken());
    auctionQueue = app.get<Queue>(getQueueToken('auctionQueue'));
    auctionProcessor = app.get<AuctionProcessor>(AuctionProcessor);

    await auctionModel.deleteMany({ createdBy: { $exists: true } });
    await userModel.deleteOne({ email: seededUserEmail });

    const hashedPassword = await bcrypt.hash(seededUserPassword, 10);

    const seededUser = await userModel.create({
      email: seededUserEmail,
      username: seededUsername,
      password: hashedPassword,
      provider: 'local',
      isVerified: true,
    });

    seededUserId = String(seededUser._id);

    const now = new Date();
    const endedAuction = await auctionModel.create({
      title: 'Smoke Payment Confirmation Auction',
      description: 'Seeded auction for payment confirmation smoke coverage',
      images: ['https://example.com/smoke-payment-confirmation.jpg'],
      startingPrice: 1000,
      currentPrice: 1250,
      status: 'ENDED',
      startTime: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      endTime: new Date(now.getTime() - 60 * 60 * 1000),
      category: 'smoke',
      createdBy: seededUserId,
      winner: seededUserId,
      highestBidder: seededUserId,
      paymentStatus: 'ACTIVE',
    });

    seededAuctionId = String(endedAuction._id);

    const cancellableAuction = await auctionModel.create({
      title: 'Smoke Cancel Auction',
      description: 'Seeded auction for cancel coverage',
      images: ['https://example.com/smoke-cancel.jpg'],
      startingPrice: 900,
      currentPrice: 900,
      status: 'ACTIVE',
      startTime: new Date(now.getTime() - 60 * 60 * 1000),
      endTime: new Date(now.getTime() + 60 * 60 * 1000),
      category: 'smoke',
      createdBy: seededUserId,
      paymentStatus: 'ACTIVE',
    });

    cancellableAuctionId = String(cancellableAuction._id);

    const endableAuction = await auctionModel.create({
      title: 'Smoke End Auction',
      description: 'Seeded auction for immediate end trigger coverage',
      images: ['https://example.com/smoke-end.jpg'],
      startingPrice: 1100,
      currentPrice: 1100,
      status: 'ACTIVE',
      startTime: new Date(now.getTime() - 60 * 60 * 1000),
      endTime: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      category: 'smoke',
      createdBy: seededUserId,
      paymentStatus: 'ACTIVE',
    });

    endableAuctionId = String(endableAuction._id);
  });

  afterAll(async () => {
    if (auctionModel) {
      await auctionModel.deleteMany({ createdBy: seededUserId });
    }

    await userModel.deleteOne({ email: seededUserEmail });

    if (auctionQueue) {
      await auctionQueue.close();
    }

    const worker = (
      auctionProcessor as unknown as { worker?: { close: () => Promise<void> } }
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

  it('health endpoint responds with service shape', async () => {
    const response = await request(app.getHttpServer()).get('/health');

    expect([200, 503]).toContain(response.status);
    expect(response.body).toEqual(
      expect.objectContaining({
        status: expect.any(String),
      }),
    );
  });

  it('auth username check endpoint is reachable', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/auth/check-username-unique')
      .query({ username: `smoke_user_${Date.now()}` });

    expect([200, 201]).toContain(response.status);
    expect(response.body).toEqual(
      expect.objectContaining({
        isAvailable: expect.any(Boolean),
      }),
    );
  });

  it('auctions list endpoint responds successfully', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/auctions')
      .query({ page: 1, limit: 1 });

    expect([200, 201]).toContain(response.status);
    expect(response.body).toEqual(
      expect.objectContaining({
        data: expect.any(Array),
      }),
    );
  });

  it('authenticated auction queue status endpoint responds successfully', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        email: seededUserEmail,
        password: seededUserPassword,
      });

    expect(loginResponse.status).toBe(201);

    const response = await request(app.getHttpServer())
      .get('/v1/auctions/queue/status')
      .set('Authorization', `Bearer ${loginResponse.body.access_token}`);

    expect([200, 201]).toContain(response.status);
    expect(response.body).toEqual(
      expect.objectContaining({
        queue: 'auctionQueue',
        counts: expect.any(Object),
        sample: expect.objectContaining({
          failed: expect.any(Array),
          delayed: expect.any(Array),
          waiting: expect.any(Array),
          active: expect.any(Array),
        }),
      }),
    );
  });

  it('protected notifications endpoint rejects anonymous requests', async () => {
    const response = await request(app.getHttpServer()).get(
      '/v1/notifications',
    );

    expect(response.status).toBe(401);
  });

  it('protected payment link endpoint rejects anonymous requests', async () => {
    const response = await request(app.getHttpServer()).post(
      '/v1/payments/cashfree/link',
    );

    expect(response.status).toBe(401);
  });

  it('authenticated user can login and fetch /auth/me profile', async () => {
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

    const meResponse = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.access_token}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body).toEqual(
      expect.objectContaining({
        message: expect.any(String),
        user: expect.objectContaining({
          email: seededUserEmail,
          username: seededUsername,
        }),
      }),
    );
  });

  it('winner can confirm payment for an ended auction', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        email: seededUserEmail,
        password: seededUserPassword,
      });

    expect(loginResponse.status).toBe(201);

    const response = await request(app.getHttpServer())
      .post(`/v1/auctions/${seededAuctionId}/payment/confirm`)
      .set('Authorization', `Bearer ${loginResponse.body.access_token}`);

    expect([200, 201]).toContain(response.status);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/payment confirmed/i),
        auction: expect.objectContaining({
          paymentStatus: 'PAID',
          status: 'ENDED',
        }),
      }),
    );
  });

  it('owner can cancel an active auction', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        email: seededUserEmail,
        password: seededUserPassword,
      });

    expect(loginResponse.status).toBe(201);

    const response = await request(app.getHttpServer())
      .post(`/v1/auctions/${cancellableAuctionId}/cancel`)
      .set('Authorization', `Bearer ${loginResponse.body.access_token}`);

    expect([200, 201]).toContain(response.status);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/cancelled/i),
        auction: expect.objectContaining({
          _id: cancellableAuctionId,
          status: 'CANCELLED',
        }),
      }),
    );

    const persistedAuction = await auctionModel.findById(cancellableAuctionId);
    expect(persistedAuction?.status).toBe('CANCELLED');
    expect(persistedAuction?.winner).toBeUndefined();
  });

  it('owner can trigger immediate auction end', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        email: seededUserEmail,
        password: seededUserPassword,
      });

    expect(loginResponse.status).toBe(201);

    const response = await request(app.getHttpServer())
      .post(`/v1/auctions/${endableAuctionId}/end`)
      .set('Authorization', `Bearer ${loginResponse.body.access_token}`);

    expect([200, 201]).toContain(response.status);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/end triggered|already ended/i),
      }),
    );

    const persistedAuction = await auctionModel.findById(endableAuctionId);
    expect(persistedAuction?.status).toMatch(/ACTIVE|ENDED/);
  });
});
