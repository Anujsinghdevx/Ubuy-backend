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
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';
import { BidsGateway } from '../../src/modules/bids/bids.gateway';

jest.setTimeout(30000);

describe('E2E: auth profile update journey', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;

  const user1Email = 'e2e.profile.user1@ubuy.local';
  const user1Password = 'E2EProfilePass123!';
  const user1Username = 'e2e_profile_user1';

  const user2Email = 'e2e.profile.user2@ubuy.local';
  const user2Password = 'E2EProfilePass123!';
  const user2Username = 'e2e_profile_user2';

  let user1Id = '';
  let user2Id = '';
  let user1Token = '';

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

    await userModel.deleteMany({ email: { $in: [user1Email, user2Email] } });

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
        name: 'User One',
      }),
      userModel.create({
        email: user2Email,
        username: user2Username,
        password: user2Hash,
        provider: 'local',
        isVerified: true,
        name: 'User Two',
      }),
    ]);

    user1Id = String(user1._id);
    user2Id = String(user2._id);
    user1Token = await loginAndGetToken(user1Email, user1Password);
  });

  afterAll(async () => {
    if (userModel) {
      await userModel.deleteMany({ email: { $in: [user1Email, user2Email] } });
    }

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  it('returns own profile, updates profile, and enforces legacy access checks', async () => {
    const meResponse = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${user1Token}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body).toEqual(
      expect.objectContaining({
        message: 'User fetched successfully',
        user: expect.objectContaining({
          userId: user1Id,
          email: user1Email,
          username: user1Username,
        }),
      }),
    );

    const updateResponse = await request(app.getHttpServer())
      .patch('/v1/auth/update-profile')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        username: 'e2e_profile_user1_updated',
        name: 'User One Updated',
        image: 'https://example.com/profile-updated.jpg',
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toEqual(
      expect.objectContaining({
        message: 'Profile updated successfully',
        user: expect.objectContaining({
          userId: user1Id,
          username: 'e2e_profile_user1_updated',
          name: 'User One Updated',
          image: 'https://example.com/profile-updated.jpg',
        }),
      }),
    );

    const publicProfileResponse = await request(app.getHttpServer()).get(
      `/v1/auth/public-profile/${user1Id}`,
    );

    expect(publicProfileResponse.status).toBe(200);
    expect(publicProfileResponse.body).toEqual(
      expect.objectContaining({
        id: user1Id,
        username: expect.stringMatching(/User One Updated|e2e_profile_user1_updated/i),
      }),
    );

    const forbiddenResponse = await request(app.getHttpServer())
      .post('/v1/auth/profile')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ userId: user2Id });

    expect(forbiddenResponse.status).toBe(403);
    expect(forbiddenResponse.body).toEqual(
      expect.objectContaining({
        message: 'Cannot fetch profile for another user',
      }),
    );
  });
});
