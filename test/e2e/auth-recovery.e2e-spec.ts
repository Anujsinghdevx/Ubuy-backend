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
import { MailService } from '../../src/modules/auth/mail.service';

jest.setTimeout(30000);

describe('E2E: auth recovery lifecycle', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;

  const userEmail = 'e2e.auth.recovery@ubuy.local';
  const userPassword = 'E2ERecoveryPass123!';
  const userUsername = 'e2e_auth_recovery';

  const auctionQueueMock: any = {
    add: jest.fn(),
    getJob: jest.fn(),
    close: jest.fn(),
  };

  const mailServiceMock: any = {
    sendVerificationEmail: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
  };

  auctionQueueMock.add.mockResolvedValue({ id: 'mock-end-auction-job' });
  auctionQueueMock.getJob.mockResolvedValue(null);
  auctionQueueMock.close.mockResolvedValue(undefined);

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

    await userModel.deleteOne({ email: userEmail });

    const hashedPassword = await bcrypt.hash(userPassword, 10);
    await userModel.create({
      email: userEmail,
      username: userUsername,
      password: hashedPassword,
      provider: 'local',
      isVerified: true,
    });
  });

  afterAll(async () => {
    if (userModel) {
      await userModel.deleteOne({ email: userEmail });
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }

    if (app) {
      await app.close();
    }
  });

  it('supports forgot-password -> reset-code -> reset-password -> login flow', async () => {
    const forgotResponse = await request(app.getHttpServer())
      .post('/v1/auth/forgot-password')
      .send({ email: userEmail });

    expect([200, 201]).toContain(forgotResponse.status);
    expect(forgotResponse.body).toEqual(
      expect.objectContaining({
        message: 'If an account exists, a reset code has been sent.',
      }),
    );

    const userWithResetCode = await userModel.findOne({ email: userEmail }).lean();
    expect(userWithResetCode?.passwordResetCode).toEqual(expect.any(String));

    const verifyCodeResponse = await request(app.getHttpServer())
      .post('/v1/auth/reset-code')
      .send({
        email: userEmail,
        code: userWithResetCode?.passwordResetCode,
      });

    expect([200, 201]).toContain(verifyCodeResponse.status);
    expect(verifyCodeResponse.body).toEqual(
      expect.objectContaining({
        isValid: true,
      }),
    );

    const newPassword = 'E2ERecoveryPass456!';

    const resetResponse = await request(app.getHttpServer())
      .post('/v1/auth/reset-password')
      .send({
        email: userEmail,
        code: userWithResetCode?.passwordResetCode,
        newPassword,
      });

    expect([200, 201]).toContain(resetResponse.status);
    expect(resetResponse.body).toEqual(
      expect.objectContaining({
        message: 'Password reset successfully',
      }),
    );

    const loginResponse = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        email: userEmail,
        password: newPassword,
      });

    expect(loginResponse.status).toBe(201);
    expect(loginResponse.body).toEqual(
      expect.objectContaining({
        access_token: expect.any(String),
      }),
    );
  });

  it('rejects invalid reset code', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/reset-code')
      .send({
        email: userEmail,
        code: '000000',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'Invalid reset code',
      }),
    );
  });

  it('rejects expired reset code', async () => {
    await userModel.updateOne(
      { email: userEmail },
      {
        $set: {
          passwordResetCode: '111111',
          passwordResetCodeExpiry: new Date(Date.now() - 60 * 1000),
        },
      },
    );

    const response = await request(app.getHttpServer())
      .post('/v1/auth/reset-password')
      .send({
        email: userEmail,
        code: '111111',
        newPassword: 'E2ERecoveryPass789!',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'Reset code expired',
      }),
    );
  });
});
