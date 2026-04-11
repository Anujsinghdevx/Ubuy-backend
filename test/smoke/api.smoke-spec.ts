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
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';

describe('Smoke Test Suite', () => {
  let app: INestApplication;
  let userModel: Model<UserDocument>;
  let mongoConnection: Connection;
  let auctionQueue: Queue;
  let auctionProcessor: AuctionProcessor;
  const seededUserEmail = 'smoke.auth.user@ubuy.local';
  const seededUserPassword = 'SmokePass123!';
  const seededUsername = 'smoke_auth_user';

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
    mongoConnection = app.get<Connection>(getConnectionToken());
    auctionQueue = app.get<Queue>(getQueueToken('auctionQueue'));
    auctionProcessor = app.get<AuctionProcessor>(AuctionProcessor);

    await userModel.deleteOne({ email: seededUserEmail });

    const hashedPassword = await bcrypt.hash(seededUserPassword, 10);

    await userModel.create({
      email: seededUserEmail,
      username: seededUsername,
      password: hashedPassword,
      provider: 'local',
      isVerified: true,
    });
  });

  afterAll(async () => {
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

    expect(response.status).toBe(200);
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

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        data: expect.any(Array),
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
});
