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
import {
  Auction,
  AuctionDocument,
} from '../../src/modules/auctions/schemas/auction.schema';
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';
import { BidsGateway } from '../../src/modules/bids/bids.gateway';

describe('E2E: auctions permissions and ownership', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;

  let ownerUserId = '';
  let intruderUserId = '';

  const ownerEmail = 'e2e.auctions.owner@ubuy.local';
  const ownerPassword = 'E2EAuctionsOwnerPass123!';
  const ownerUsername = 'e2e_auctions_owner';

  const intruderEmail = 'e2e.auctions.intruder@ubuy.local';
  const intruderPassword = 'E2EAuctionsIntruderPass123!';
  const intruderUsername = 'e2e_auctions_intruder';

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

  const createOwnerAuction = async (ownerToken: string, title: string) => {
    const createAuctionResponse = await request(app.getHttpServer())
      .post('/v1/auctions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title,
        description: 'E2E ownership and permission checks for auction actions',
        images: ['https://example.com/e2e-auctions-permissions.jpg'],
        startingPrice: 500,
        startTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        category: 'fashion',
      });

    expect(createAuctionResponse.status).toBe(201);
    return String(createAuctionResponse.body._id);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken('auctionQueue'))
      .useValue(auctionQueueMock)
      .overrideProvider(AuctionProcessor)
      .useValue({})
      .overrideProvider(BidsGateway)
      .useValue(bidsGatewayMock)
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

    await auctionModel.deleteMany({
      createdBy: { $in: [ownerUserId, intruderUserId] },
    });
    await userModel.deleteMany({ email: { $in: [ownerEmail, intruderEmail] } });

    const [ownerHash, intruderHash] = await Promise.all([
      bcrypt.hash(ownerPassword, 10),
      bcrypt.hash(intruderPassword, 10),
    ]);

    const [ownerUser, intruderUser] = await Promise.all([
      userModel.create({
        email: ownerEmail,
        username: ownerUsername,
        password: ownerHash,
        provider: 'local',
        isVerified: true,
      }),
      userModel.create({
        email: intruderEmail,
        username: intruderUsername,
        password: intruderHash,
        provider: 'local',
        isVerified: true,
      }),
    ]);

    ownerUserId = String(ownerUser._id);
    intruderUserId = String(intruderUser._id);
  });

  afterAll(async () => {
    if (auctionModel) {
      await auctionModel.deleteMany({
        createdBy: { $in: [ownerUserId, intruderUserId] },
      });
    }

    if (userModel) {
      await userModel.deleteMany({
        email: { $in: [ownerEmail, intruderEmail] },
      });
    }

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  it('rejects non-owner cancel, end-now, and delete operations', async () => {
    const ownerToken = await loginAndGetToken(ownerEmail, ownerPassword);
    const intruderToken = await loginAndGetToken(
      intruderEmail,
      intruderPassword,
    );

    const auctionId = await createOwnerAuction(
      ownerToken,
      `E2E Non Owner Auction ${Date.now()}`,
    );

    const cancelResponse = await request(app.getHttpServer())
      .post(`/v1/auctions/${auctionId}/cancel`)
      .set('Authorization', `Bearer ${intruderToken}`);

    expect(cancelResponse.status).toBe(400);
    expect(cancelResponse.body).toEqual(
      expect.objectContaining({
        message: 'Only auction creator can cancel auction',
      }),
    );

    const endNowResponse = await request(app.getHttpServer())
      .post(`/v1/auctions/${auctionId}/end`)
      .set('Authorization', `Bearer ${intruderToken}`);

    expect(endNowResponse.status).toBe(400);
    expect(endNowResponse.body).toEqual(
      expect.objectContaining({
        message: 'Only auction creator can end auction',
      }),
    );

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/v1/auctions/${auctionId}`)
      .set('Authorization', `Bearer ${intruderToken}`);

    expect(deleteResponse.status).toBe(400);
    expect(deleteResponse.body).toEqual(
      expect.objectContaining({
        message: 'Only auction creator can delete auction',
      }),
    );
  });

  it('allows owner to cancel and delete their own auction', async () => {
    const ownerToken = await loginAndGetToken(ownerEmail, ownerPassword);

    const auctionId = await createOwnerAuction(
      ownerToken,
      `E2E Owner Managed Auction ${Date.now()}`,
    );

    const cancelResponse = await request(app.getHttpServer())
      .post(`/v1/auctions/${auctionId}/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(cancelResponse.status).toBe(201);
    expect(cancelResponse.body).toEqual(
      expect.objectContaining({
        message: 'Auction cancelled successfully',
      }),
    );

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/v1/auctions/${auctionId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toEqual(
      expect.objectContaining({
        message: 'Auction deleted successfully',
        auctionId,
      }),
    );

    const deletedAuction = await auctionModel.findById(auctionId);
    expect(deletedAuction).toBeNull();
  });
});
