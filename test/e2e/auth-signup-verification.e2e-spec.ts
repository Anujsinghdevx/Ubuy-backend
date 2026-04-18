import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { Connection, Model } from 'mongoose';
import { AppModule } from '../../src/app.module';
import {
  User,
  UserDocument,
} from '../../src/modules/users/schemas/user.schema';
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';
import { MailService } from '../../src/modules/auth/mail.service';

describe('E2E: signup and email verification journey', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;

  const signupEmail = 'e2e.auth.signup@ubuy.local';
  const signupPassword = 'E2ESignupPass123!';
  const signupUsername = 'e2e_signup_user';

  const auctionQueueMock: any = {
    add: jest.fn(),
    getJob: jest.fn(),
    close: jest.fn(),
  };

  auctionQueueMock.add.mockResolvedValue({ id: 'mock-end-auction-job' });
  auctionQueueMock.getJob.mockResolvedValue(null);
  auctionQueueMock.close.mockResolvedValue(undefined);

  const mailServiceMock: any = {
    sendVerificationEmail: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
  };

  mailServiceMock.sendVerificationEmail.mockResolvedValue(undefined);
  mailServiceMock.sendPasswordResetEmail.mockResolvedValue(undefined);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken('auctionQueue'))
      .useValue(auctionQueueMock)
      .overrideProvider(AuctionProcessor)
      .useValue({})
      .overrideProvider(MailService)
      .useValue(mailServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();

    mongoConnection = app.get<Connection>(getConnectionToken());
    userModel = app.get<Model<UserDocument>>(getModelToken(User.name));

    await userModel.deleteOne({ email: signupEmail });
  });

  afterAll(async () => {
    if (userModel) {
      await userModel.deleteOne({ email: signupEmail });
    }

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  it('requires verification before login and then allows login after verification', async () => {
    const signupResponse = await request(app.getHttpServer())
      .post('/v1/auth/signup')
      .send({
        email: signupEmail,
        password: signupPassword,
        username: signupUsername,
      });

    expect(signupResponse.status).toBe(201);
    expect(signupResponse.body).toEqual(
      expect.objectContaining({
        message: 'User registered. Verify your email.',
      }),
    );

    const loginBeforeVerify = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        email: signupEmail,
        password: signupPassword,
      });

    expect(loginBeforeVerify.status).toBe(400);
    expect(loginBeforeVerify.body).toEqual(
      expect.objectContaining({
        message: 'Please verify your email first',
      }),
    );

    const createdUser = await userModel.findOne({ email: signupEmail }).lean();
    expect(createdUser).toBeTruthy();
    expect(createdUser?.isVerified).toBe(false);
    expect(createdUser?.verificationCode).toEqual(expect.any(String));

    const verifyResponse = await request(app.getHttpServer())
      .post('/v1/auth/verify-email')
      .send({
        email: signupEmail,
        code: createdUser?.verificationCode,
      });

    expect(verifyResponse.status).toBe(201);
    expect(verifyResponse.body).toEqual(
      expect.objectContaining({
        message: 'Email verified successfully',
      }),
    );

    const loginAfterVerify = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        email: signupEmail,
        password: signupPassword,
      });

    expect(loginAfterVerify.status).toBe(201);
    expect(loginAfterVerify.body).toEqual(
      expect.objectContaining({
        access_token: expect.any(String),
      }),
    );

    const profileResponse = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${loginAfterVerify.body.access_token}`);

    expect(profileResponse.status).toBe(200);
    expect(profileResponse.body).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({
          email: signupEmail,
          username: signupUsername,
          isVerified: true,
        }),
      }),
    );
  });
});
