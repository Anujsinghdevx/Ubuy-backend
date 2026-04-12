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
import { UploadsService } from '../../src/modules/uploads/uploads.service';
import { MailService } from '../../src/modules/auth/mail.service';

describe('Integration: auth lifecycle negative paths', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;

  const existingSignupEmail = 'integration.auth.existing@ubuy.local';
  const verifyUserEmail = 'integration.auth.verify@ubuy.local';
  const resetUserEmail = 'integration.auth.reset@ubuy.local';
  const googleOnlyUserEmail = 'integration.auth.google@ubuy.local';
  const nonExistentEmail = 'integration.auth.missing@ubuy.local';
  const basePassword = 'IntegrationAuthPass123!';

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

  const mailServiceMock: any = {
    sendVerificationEmail: jest.fn() as jest.Mock,
    sendPasswordResetEmail: jest.fn() as jest.Mock,
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
      .overrideProvider(UploadsService)
      .useValue(uploadsServiceMock)
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

    await userModel.deleteMany({
      email: {
        $in: [
          existingSignupEmail,
          verifyUserEmail,
          resetUserEmail,
          googleOnlyUserEmail,
        ],
      },
    });

    const hashedPassword = await bcrypt.hash(basePassword, 10);

    await userModel.create({
      email: existingSignupEmail,
      username: 'integration_auth_existing',
      password: hashedPassword,
      provider: 'local',
      isVerified: true,
    });

    await userModel.create({
      email: verifyUserEmail,
      username: 'integration_auth_verify',
      password: hashedPassword,
      provider: 'local',
      isVerified: false,
      verificationCode: '123456',
      verificationCodeExpiry: new Date(Date.now() + 60 * 60 * 1000),
    });

    await userModel.create({
      email: resetUserEmail,
      username: 'integration_auth_reset',
      password: hashedPassword,
      provider: 'local',
      isVerified: true,
      passwordResetCode: '654321',
      passwordResetCodeExpiry: new Date(Date.now() + 60 * 60 * 1000),
    });

    await userModel.create({
      email: googleOnlyUserEmail,
      username: 'integration_auth_google_only',
      provider: 'google',
      isVerified: true,
      password: undefined,
      googleId: 'integration-google-user-1',
    });
  });

  afterAll(async () => {
    if (userModel) {
      await userModel.deleteMany({
        email: {
          $in: [
            existingSignupEmail,
            verifyUserEmail,
            resetUserEmail,
            googleOnlyUserEmail,
          ],
        },
      });
    }

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  it('rejects duplicate signup for an existing email', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/signup')
      .send({
        email: existingSignupEmail,
        username: 'integration_auth_duplicate',
        password: basePassword,
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'User already exists',
      }),
    );
  });

  it('rejects resend-code for email-verification on an already verified user', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/resend-code')
      .send({
        email: existingSignupEmail,
        purpose: 'email-verification',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'User already verified',
      }),
    );
  });

  it('rejects resend-code when user does not exist', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/resend-code')
      .send({
        email: nonExistentEmail,
        purpose: 'email-verification',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'User not found',
      }),
    );
  });

  it('rejects resend-code password-reset for Google-only account', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/resend-code')
      .send({
        email: googleOnlyUserEmail,
        purpose: 'password-reset',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'This account uses Google sign-in. Use Google to login.',
      }),
    );
  });

  it('rejects verify-email when verification code is invalid', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/verify-email')
      .send({
        email: verifyUserEmail,
        code: '000000',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'Invalid verification code',
      }),
    );
  });

  it('rejects verify-email when verification code is expired', async () => {
    await userModel.updateOne(
      { email: verifyUserEmail },
      {
        $set: {
          verificationCode: '222222',
          verificationCodeExpiry: new Date(Date.now() - 60 * 1000),
          isVerified: false,
        },
      },
    );

    const response = await request(app.getHttpServer())
      .post('/v1/auth/verify-email')
      .send({
        email: verifyUserEmail,
        code: '222222',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'Code expired',
      }),
    );
  });

  it('rejects reset-code verification when reset code is expired', async () => {
    await userModel.updateOne(
      { email: resetUserEmail },
      {
        $set: {
          passwordResetCode: '777777',
          passwordResetCodeExpiry: new Date(Date.now() - 60 * 1000),
        },
      },
    );

    const response = await request(app.getHttpServer())
      .post('/v1/auth/reset-code')
      .send({
        email: resetUserEmail,
        code: '777777',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'Reset code expired',
      }),
    );
  });

  it('rejects reset-password when reset code is invalid', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/reset-password')
      .send({
        email: resetUserEmail,
        code: '000000',
        newPassword: 'NewIntegrationAuthPass123!',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'Invalid reset code',
      }),
    );
  });
});
