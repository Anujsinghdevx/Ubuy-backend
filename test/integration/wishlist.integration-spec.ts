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
import {
  Wishlist,
  WishlistDocument,
} from '../../src/modules/wishlist/schemas/wishlist.schema';
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';
import { UploadsService } from '../../src/modules/uploads/uploads.service';

describe('Integration: wishlist flow', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;
  let wishlistModel: Model<WishlistDocument>;

  let wishlistUserId = '';
  let auctionSellerId = '';

  const wishlistUserEmail = 'integration.wishlist.user@ubuy.local';
  const wishlistUserPassword = 'IntegrationWishlistPass123!';
  const wishlistUsername = 'integration_wishlist_user';

  const sellerEmail = 'integration.wishlist.seller@ubuy.local';
  const sellerPassword = 'IntegrationWishlistSellerPass123!';
  const sellerUsername = 'integration_wishlist_seller';

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
      .overrideProvider(AuctionProcessor)
      .useValue({})
      .overrideProvider(UploadsService)
      .useValue(uploadsServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    mongoConnection = app.get<Connection>(getConnectionToken());
    userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    auctionModel = app.get<Model<AuctionDocument>>(getModelToken(Auction.name));
    wishlistModel = app.get<Model<WishlistDocument>>(
      getModelToken(Wishlist.name),
    );

    await wishlistModel.deleteMany({});
    await auctionModel.deleteMany({});
    await userModel.deleteOne({ email: sellerEmail });
    await userModel.deleteOne({ email: wishlistUserEmail });

    const [wishlistUserHashedPassword, sellerHashedPassword] =
      await Promise.all([
        bcrypt.hash(wishlistUserPassword, 10),
        bcrypt.hash(sellerPassword, 10),
      ]);

    const wishlistUser = await userModel.create({
      email: wishlistUserEmail,
      username: wishlistUsername,
      password: wishlistUserHashedPassword,
      provider: 'local',
      isVerified: true,
    });

    const sellerUser = await userModel.create({
      email: sellerEmail,
      username: sellerUsername,
      password: sellerHashedPassword,
      provider: 'local',
      isVerified: true,
    });

    wishlistUserId = String(wishlistUser._id);
    auctionSellerId = String(sellerUser._id);
  });

  afterAll(async () => {
    if (wishlistModel) {
      await wishlistModel.deleteMany({ userId: wishlistUserId });
    }

    if (auctionModel) {
      await auctionModel.deleteMany({ createdBy: auctionSellerId });
    }

    if (userModel) {
      await userModel.deleteOne({ email: sellerEmail });
      await userModel.deleteOne({ email: wishlistUserEmail });
    }

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  it('adds, lists, and removes wishlist entries for authenticated user', async () => {
    const token = await loginAndGetToken(
      wishlistUserEmail,
      wishlistUserPassword,
    );

    const auction = await auctionModel.create({
      title: 'Wishlist Integration Auction',
      description: 'Auction for wishlist integration scenario',
      images: ['https://example.com/wishlist-auction.jpg'],
      startingPrice: 4000,
      currentPrice: 4000,
      status: 'ACTIVE',
      startTime: new Date(Date.now() - 60 * 60 * 1000),
      endTime: new Date(Date.now() + 60 * 60 * 1000),
      category: 'fashion',
      createdBy: auctionSellerId,
      paymentStatus: 'ACTIVE',
      notified: false,
      winnerHistory: [],
    });

    const addResponse = await request(app.getHttpServer())
      .post('/v1/wishlist')
      .set('Authorization', `Bearer ${token}`)
      .send({ auctionId: String(auction._id) });

    expect(addResponse.status).toBe(201);
    expect(addResponse.body).toEqual(
      expect.objectContaining({
        message: 'Auction added to wishlist successfully',
      }),
    );

    const listResponse = await request(app.getHttpServer())
      .get('/v1/wishlist')
      .query({ page: 1, limit: 10 })
      .set('Authorization', `Bearer ${token}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toEqual(
      expect.objectContaining({
        wishlist: expect.any(Array),
      }),
    );
    expect(listResponse.body.wishlist.length).toBeGreaterThanOrEqual(1);

    const removeResponse = await request(app.getHttpServer())
      .delete('/v1/wishlist')
      .set('Authorization', `Bearer ${token}`)
      .send({ auctionId: String(auction._id) });

    expect(removeResponse.status).toBe(200);
    expect(removeResponse.body).toEqual(
      expect.objectContaining({
        message: 'Auction removed from wishlist successfully',
      }),
    );
  });

  it('rejects anonymous wishlist access', async () => {
    const response = await request(app.getHttpServer()).get('/v1/wishlist');

    expect(response.status).toBe(401);
  });
});
