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
import { UploadsService } from '../../src/modules/uploads/uploads.service';
import { BidsGateway } from '../../src/modules/bids/bids.gateway';

describe('Integration: auctions ownership and permissions', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;

  let ownerUserId = '';
  let intruderUserId = '';

  const ownerEmail = 'integration.auctions.owner@ubuy.local';
  const ownerPassword = 'IntegrationAuctionOwnerPass123!';
  const ownerUsername = 'integration_auctions_owner';
  const intruderEmail = 'integration.auctions.intruder@ubuy.local';
  const intruderPassword = 'IntegrationAuctionIntruderPass123!';
  const intruderUsername = 'integration_auctions_intruder';

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
        description: 'Auction for ownership and permission integration checks',
        images: ['https://example.com/integration-auctions-permissions.jpg'],
        startingPrice: 2500,
        startTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
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
      .overrideProvider(UploadsService)
      .useValue(uploadsServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    mongoConnection = app.get<Connection>(getConnectionToken());
    userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    auctionModel = app.get<Model<AuctionDocument>>(getModelToken(Auction.name));

    await auctionModel.deleteMany({});
    await userModel.deleteOne({ email: intruderEmail });
    await userModel.deleteOne({ email: ownerEmail });

    const [ownerPasswordHash, intruderPasswordHash] = await Promise.all([
      bcrypt.hash(ownerPassword, 10),
      bcrypt.hash(intruderPassword, 10),
    ]);

    const ownerUser = await userModel.create({
      email: ownerEmail,
      username: ownerUsername,
      password: ownerPasswordHash,
      provider: 'local',
      isVerified: true,
    });

    const intruderUser = await userModel.create({
      email: intruderEmail,
      username: intruderUsername,
      password: intruderPasswordHash,
      provider: 'local',
      isVerified: true,
    });

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
      await userModel.deleteOne({ email: intruderEmail });
      await userModel.deleteOne({ email: ownerEmail });
    }

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  it('rejects non-owner cancel/delete/end-now operations', async () => {
    const ownerToken = await loginAndGetToken(ownerEmail, ownerPassword);
    const intruderToken = await loginAndGetToken(
      intruderEmail,
      intruderPassword,
    );

    const auctionId = await createOwnerAuction(
      ownerToken,
      'Integration Non Owner Permission Auction',
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

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/v1/auctions/${auctionId}`)
      .set('Authorization', `Bearer ${intruderToken}`);

    expect(deleteResponse.status).toBe(400);
    expect(deleteResponse.body).toEqual(
      expect.objectContaining({
        message: 'Only auction creator can delete auction',
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
  });

  it('allows owner to trigger end-now and delete own auction', async () => {
    const ownerToken = await loginAndGetToken(ownerEmail, ownerPassword);

    const auctionId = await createOwnerAuction(
      ownerToken,
      'Integration Owner End And Delete Auction',
    );

    const endNowResponse = await request(app.getHttpServer())
      .post(`/v1/auctions/${auctionId}/end`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(endNowResponse.status).toBe(201);
    expect(endNowResponse.body).toEqual(
      expect.objectContaining({
        message: 'Auction end triggered successfully',
        auctionId,
      }),
    );

    expect(auctionQueueMock.add).toHaveBeenCalledWith(
      'endAuction',
      { auctionId },
      expect.objectContaining({
        jobId: `endAuction-${auctionId}`,
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

  it('allows owner to cancel own auction', async () => {
    const ownerToken = await loginAndGetToken(ownerEmail, ownerPassword);

    const auctionId = await createOwnerAuction(
      ownerToken,
      'Integration Owner Cancel Auction',
    );

    const cancelResponse = await request(app.getHttpServer())
      .post(`/v1/auctions/${auctionId}/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(cancelResponse.status).toBe(201);

    const cancelledAuction = await auctionModel.findById(auctionId).lean();
    expect(cancelledAuction?.status).toBe('CANCELLED');
    expect(cancelledAuction?.winner).toBeFalsy();
  });
});
