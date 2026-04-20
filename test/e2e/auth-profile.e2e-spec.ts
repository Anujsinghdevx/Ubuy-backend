import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { Connection, Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../src/app.module';
import {
  User,
  UserDocument,
} from '../../src/modules/users/schemas/user.schema';
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';

jest.setTimeout(30000);

describe('E2E: auth and profile journey', () => {
  let app: INestApplication;
  let userModel: Model<UserDocument>;
  let mongoConnection: Connection;

  const seededEmail = 'e2e.auth.user@ubuy.local';
  const seededPassword = 'E2EAuthPass123!';
  const seededUsername = 'e2e_auth_user';

  const auctionQueueMock: any = {
    add: jest.fn(),
    getJob: jest.fn(),
    close: jest.fn(),
  };

  auctionQueueMock.add.mockResolvedValue({ id: 'mock-end-auction-job' });
  auctionQueueMock.getJob.mockResolvedValue(null);
  auctionQueueMock.close.mockResolvedValue(undefined);

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
    mongoConnection = app.get<Connection>(getConnectionToken());

    await userModel.deleteOne({ email: seededEmail });

    const hashedPassword = await bcrypt.hash(seededPassword, 10);
    await userModel.create({
      email: seededEmail,
      username: seededUsername,
      password: hashedPassword,
      provider: 'local',
      isVerified: true,
    });
  });

  afterAll(async () => {
    if (userModel) {
      await userModel.deleteOne({ email: seededEmail });
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }

    if (app) {
      await app.close();
    }
  });

  it('rejects anonymous access to profile endpoint', async () => {
    const response = await request(app.getHttpServer()).get('/v1/auth/me');

    expect(response.status).toBe(401);
  });

  it('logs in and returns user profile for authenticated user', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        email: seededEmail,
        password: seededPassword,
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
        user: expect.objectContaining({
          email: seededEmail,
          username: seededUsername,
        }),
      }),
    );
  });
});
