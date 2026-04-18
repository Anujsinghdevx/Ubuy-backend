import {
  BadRequestException,
  INestApplication,
  VersioningType,
} from '@nestjs/common';
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
import { UploadsService } from '../../src/modules/uploads/uploads.service';
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';
import { BidsGateway } from '../../src/modules/bids/bids.gateway';

jest.setTimeout(30000);

describe('E2E: uploads journey', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;

  const userEmail = 'e2e.uploads.user@ubuy.local';
  const userPassword = 'E2EUploadsPass123!';
  const userUsername = 'e2e_uploads_user';

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

  const uploadsServiceMock: any = {
    uploadAuctionImages: jest.fn(),
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

    await userModel.deleteOne({ email: userEmail });

    const userHash = await bcrypt.hash(userPassword, 10);
    await userModel.create({
      email: userEmail,
      username: userUsername,
      password: userHash,
      provider: 'local',
      isVerified: true,
    });
  });

  afterAll(async () => {
    if (userModel) {
      await userModel.deleteOne({ email: userEmail });
    }

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects upload request without auth', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/uploads/images')
      .attach('files', Buffer.from('fake image data'), 'image.jpg');

    expect([401, 403]).toContain(response.status);
  });

  it('uploads image for authenticated user', async () => {
    const token = await loginAndGetToken(userEmail, userPassword);

    uploadsServiceMock.uploadAuctionImages.mockResolvedValueOnce({
      urls: ['https://cloudinary.com/mock/e2e-upload.jpg'],
    });

    const response = await request(app.getHttpServer())
      .post('/v1/uploads/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('fake image data'), 'image.jpg');

    expect(response.status).toBe(201);
    expect(response.body).toEqual(
      expect.objectContaining({
        urls: expect.arrayContaining([expect.stringMatching(/^https?:\/\//)]),
      }),
    );

    expect(uploadsServiceMock.uploadAuctionImages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          buffer: expect.any(Buffer),
          mimetype: 'image/jpeg',
        }),
      ]),
    );
  });

  it('propagates service validation errors', async () => {
    const token = await loginAndGetToken(userEmail, userPassword);

    uploadsServiceMock.uploadAuctionImages.mockRejectedValueOnce(
      new BadRequestException('Only image uploads are allowed'),
    );

    const response = await request(app.getHttpServer())
      .post('/v1/uploads/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('not-an-image'), 'document.pdf');

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/image uploads/i),
      }),
    );
  });
});
