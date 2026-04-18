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

describe('E2E: wishlist journey', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;
  let wishlistModel: Model<WishlistDocument>;

  const wishlistUserEmail = 'e2e.wishlist.user@ubuy.local';
  const wishlistUserPassword = 'E2EWishlistPass123!';
  const wishlistUsername = 'e2e_wishlist_user';

  const sellerEmail = 'e2e.wishlist.seller@ubuy.local';
  const sellerPassword = 'E2EWishlistSellerPass123!';
  const sellerUsername = 'e2e_wishlist_seller';

  let wishlistUserId = '';
  let sellerUserId = '';

  const auctionQueueMock: any = {
    add: jest.fn(),
    getJob: jest.fn(),
    close: jest.fn(),
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
    await userModel.deleteMany({
      email: { $in: [wishlistUserEmail, sellerEmail] },
    });

    const [wishlistUserHash, sellerHash] = await Promise.all([
      bcrypt.hash(wishlistUserPassword, 10),
      bcrypt.hash(sellerPassword, 10),
    ]);

    const [wishlistUser, sellerUser] = await Promise.all([
      userModel.create({
        email: wishlistUserEmail,
        username: wishlistUsername,
        password: wishlistUserHash,
        provider: 'local',
        isVerified: true,
      }),
      userModel.create({
        email: sellerEmail,
        username: sellerUsername,
        password: sellerHash,
        provider: 'local',
        isVerified: true,
      }),
    ]);

    wishlistUserId = String(wishlistUser._id);
    sellerUserId = String(sellerUser._id);
  });

  afterAll(async () => {
    if (wishlistModel) {
      await wishlistModel.deleteMany({ userId: wishlistUserId });
    }

    if (auctionModel) {
      await auctionModel.deleteMany({ createdBy: sellerUserId });
    }

    if (userModel) {
      await userModel.deleteMany({
        email: { $in: [wishlistUserEmail, sellerEmail] },
      });
    }

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  it('supports add -> list -> remove wishlist flow for authenticated user', async () => {
    const token = await loginAndGetToken(wishlistUserEmail, wishlistUserPassword);

    const auction = await auctionModel.create({
      title: `E2E Wishlist Auction ${Date.now()}`,
      description: 'E2E wishlist flow auction',
      images: ['https://example.com/e2e-wishlist-auction.jpg'],
      startingPrice: 700,
      currentPrice: 700,
      status: 'ACTIVE',
      paymentStatus: 'ACTIVE',
      startTime: new Date(Date.now() - 10 * 60 * 1000),
      endTime: new Date(Date.now() + 60 * 60 * 1000),
      category: 'fashion',
      createdBy: sellerUserId,
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
      .set('Authorization', `Bearer ${token}`)
      .query({ page: 1, limit: 10 });

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
