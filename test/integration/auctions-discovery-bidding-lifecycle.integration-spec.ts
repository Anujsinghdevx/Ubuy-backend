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
import { Bid, BidDocument } from '../../src/modules/bids/schemas/bid.schema';
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';
import { UploadsService } from '../../src/modules/uploads/uploads.service';
import { BidsGateway } from '../../src/modules/bids/bids.gateway';

jest.setTimeout(30000);

describe('Integration: auctions discovery, bidding lifecycle, and payment flow', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;
  let bidModel: Model<BidDocument>;

  // Users
  const seller1Email = 'discovery.seller1@ubuy.local';
  const seller2Email = 'discovery.seller2@ubuy.local';
  const bidder1Email = 'discovery.bidder1@ubuy.local';
  const bidder2Email = 'discovery.bidder2@ubuy.local';
  const bidder3Email = 'discovery.bidder3@ubuy.local';
  const testPassword = 'DiscoveryPass123!';

  let seller1Id = '';
  let seller2Id = '';
  let bidder1Id = '';
  let bidder2Id = '';
  let bidder3Id = '';

  let seller1Token = '';
  let seller2Token = '';
  let bidder1Token = '';
  let bidder2Token = '';
  let bidder3Token = '';

  // Auctions to be created
  let auctionTechId = ''; // High-value tech item
  let auctionFashionId = ''; // Fashion item
  let auctionArtId = ''; // Art item
  let auctionExpiredId = ''; // Already ended auction

  const auctionQueueMock: any = {
    add: jest.fn() as jest.Mock,
    getJob: jest.fn() as jest.Mock,
    close: jest.fn() as jest.Mock,
  };

  auctionQueueMock.add.mockResolvedValue({ id: 'mock-job' });
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
    const response = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password });
    expect(response.status).toBe(201);
    return response.body.access_token as string;
  };

  const createUser = async (email: string, username: string) => {
    const hashedPassword = await bcrypt.hash(testPassword, 10);
    const user = await userModel.create({
      email,
      username,
      password: hashedPassword,
      provider: 'local',
      isVerified: true,
    });
    return String(user._id);
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
    bidModel = app.get<Model<BidDocument>>(getModelToken(Bid.name));

    // Cleanup
    await userModel.deleteMany({
      email: {
        $in: [
          seller1Email,
          seller2Email,
          bidder1Email,
          bidder2Email,
          bidder3Email,
        ],
      },
    });
    await auctionModel.deleteMany({});
    await bidModel.deleteMany({});

    // Create users
    seller1Id = await createUser(seller1Email, 'discovery_seller1');
    seller2Id = await createUser(seller2Email, 'discovery_seller2');
    bidder1Id = await createUser(bidder1Email, 'discovery_bidder1');
    bidder2Id = await createUser(bidder2Email, 'discovery_bidder2');
    bidder3Id = await createUser(bidder3Email, 'discovery_bidder3');

    // Get tokens
    seller1Token = await loginAndGetToken(seller1Email, testPassword);
    seller2Token = await loginAndGetToken(seller2Email, testPassword);
    bidder1Token = await loginAndGetToken(bidder1Email, testPassword);
    bidder2Token = await loginAndGetToken(bidder2Email, testPassword);
    bidder3Token = await loginAndGetToken(bidder3Email, testPassword);

    // Create multiple auctions with different categories and prices
    const nowPlus1Hour = new Date(Date.now() + 60 * 60 * 1000);
    const nowPlus2Hours = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const nowMinus1Hour = new Date(Date.now() - 60 * 60 * 1000);

    // Tech auction (ACTIVE)
    const techAuction = await auctionModel.create({
      title: 'MacBook Pro 16" M3',
      description: 'High-end laptop for testing',
      images: ['https://example.com/tech.jpg'],
      startingPrice: 5000,
      currentPrice: 5000,
      status: 'ACTIVE',
      startTime: new Date(),
      endTime: nowPlus2Hours,
      category: 'electronics',
      createdBy: seller1Id,
    });
    auctionTechId = String(techAuction._id);

    // Fashion auction (ACTIVE)
    const fashionAuction = await auctionModel.create({
      title: 'Designer Leather Jacket',
      description: 'Premium leather jacket',
      images: ['https://example.com/fashion.jpg'],
      startingPrice: 800,
      currentPrice: 800,
      status: 'ACTIVE',
      startTime: new Date(),
      endTime: nowPlus1Hour,
      category: 'fashion',
      createdBy: seller1Id,
    });
    auctionFashionId = String(fashionAuction._id);

    // Art auction (ACTIVE)
    const artAuction = await auctionModel.create({
      title: 'Abstract Oil Painting',
      description: 'Contemporary art piece',
      images: ['https://example.com/art.jpg'],
      startingPrice: 3000,
      currentPrice: 3000,
      status: 'ACTIVE',
      startTime: new Date(),
      endTime: nowPlus2Hours,
      category: 'art',
      createdBy: seller2Id,
    });
    auctionArtId = String(artAuction._id);

    // Already ended auction
    const expiredAuction = await auctionModel.create({
      title: 'Vintage Watch',
      description: 'Already expired',
      images: ['https://example.com/watch.jpg'],
      startingPrice: 500,
      currentPrice: 600,
      status: 'ENDED',
      startTime: nowMinus1Hour,
      endTime: nowMinus1Hour,
      category: 'accessories',
      createdBy: seller2Id,
      winner: bidder1Id,
      highestBidder: bidder1Id,
    });
    auctionExpiredId = String(expiredAuction._id);
  });

  afterAll(async () => {
    await auctionModel.deleteMany({});
    await bidModel.deleteMany({});
    await userModel.deleteMany({
      email: {
        $in: [
          seller1Email,
          seller2Email,
          bidder1Email,
          bidder2Email,
          bidder3Email,
        ],
      },
    });

    if (app) {
      await app.close();
    }
    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  describe('Auction Discovery & Listing', () => {
    it('should get auction by ID', async () => {
      const response = await request(app.getHttpServer()).get(
        `/v1/auctions/${auctionTechId}`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          title: 'MacBook Pro 16" M3',
          currentPrice: 5000,
          status: 'ACTIVE',
          createdBy: seller1Id,
        }),
      );
    });

    it('should get auctions created by authenticated user', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/auctions/me/created')
        .set('Authorization', `Bearer ${seller1Token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          page: expect.any(Number),
          limit: expect.any(Number),
          data: expect.arrayContaining([
            expect.objectContaining({
              createdBy: seller1Id,
            }),
          ]),
        }),
      );
    });
  });

  describe('Sequential Bidding & Winner Selection', () => {
    it('should allow bidder1 to place first bid on tech auction', async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/auctions/${auctionTechId}/bids`)
        .set('Authorization', `Bearer ${bidder1Token}`)
        .send({ amount: 5500 });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.any(Object),
        }),
      );

      // Verify auction price updated
      const auction = await auctionModel.findById(auctionTechId);
      expect(auction?.currentPrice).toBe(5500);
      expect(auction?.highestBidder).toBe(bidder1Id);
    });

    it('should allow bidder2 to outbid bidder1', async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/auctions/${auctionTechId}/bids`)
        .set('Authorization', `Bearer ${bidder2Token}`)
        .send({ amount: 6000 });

      expect(response.status).toBe(201);
      expect(response.body.ok).toBe(true);

      // Verify highest bidder changed
      const auction = await auctionModel.findById(auctionTechId);
      expect(auction?.currentPrice).toBe(6000);
      expect(auction?.highestBidder).toBe(bidder2Id);
    });

    it('should allow bidder1 to place higher bid in response', async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/auctions/${auctionTechId}/bids`)
        .set('Authorization', `Bearer ${bidder1Token}`)
        .send({ amount: 7000 });

      expect(response.status).toBe(201);

      const auction = await auctionModel.findById(auctionTechId);
      expect(auction?.currentPrice).toBe(7000);
      expect(auction?.highestBidder).toBe(bidder1Id);
    });

    it('should allow bidder3 to enter bidding war with higher bid', async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/auctions/${auctionTechId}/bids`)
        .set('Authorization', `Bearer ${bidder3Token}`)
        .send({ amount: 8500 });

      expect(response.status).toBe(201);

      const auction = await auctionModel.findById(auctionTechId);
      expect(auction?.currentPrice).toBe(8500);
      expect(auction?.highestBidder).toBe(bidder3Id);
    });

    it('should reject bid lower than current price', async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/auctions/${auctionTechId}/bids`)
        .set('Authorization', `Bearer ${bidder1Token}`)
        .send({ amount: 7500 }); // Current price is 8500

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/lower|below|must be|greater/i);
    });

    it('should reject auction creator from bidding on own auction', async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/auctions/${auctionTechId}/bids`)
        .set('Authorization', `Bearer ${seller1Token}`)
        .send({ amount: 9000 });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/creator|own|cannot/i);
    });

    it('should track bid history correctly', async () => {
      // Get all bids for the auction
      const bids = await bidModel
        .find({ auctionId: auctionTechId })
        .sort({ createdAt: 1 });

      expect(bids.length).toBeGreaterThanOrEqual(4);
      expect(bids[0].amount).toBe(5500);
      expect(bids[bids.length - 1].amount).toBe(8500);
    });
  });

  describe('Multiple Auction Bidding (Different Items)', () => {
    it('should allow bidders to bid on different auctions simultaneously', async () => {
      // Bidder1 bids on fashion
      const response1 = await request(app.getHttpServer())
        .post(`/v1/auctions/${auctionFashionId}/bids`)
        .set('Authorization', `Bearer ${bidder1Token}`)
        .send({ amount: 1000 });

      expect(response1.status).toBe(201);

      // Bidder2 bids on art
      const response2 = await request(app.getHttpServer())
        .post(`/v1/auctions/${auctionArtId}/bids`)
        .set('Authorization', `Bearer ${bidder2Token}`)
        .send({ amount: 3500 });

      expect(response2.status).toBe(201);

      // Bidder3 also bids on fashion
      const response3 = await request(app.getHttpServer())
        .post(`/v1/auctions/${auctionFashionId}/bids`)
        .set('Authorization', `Bearer ${bidder3Token}`)
        .send({ amount: 1200 });

      expect(response3.status).toBe(201);

      // Verify each auction updated independently
      const fashion = await auctionModel.findById(auctionFashionId);
      const art = await auctionModel.findById(auctionArtId);

      expect(fashion?.currentPrice).toBe(1200);
      expect(fashion?.highestBidder).toBe(bidder3Id);
      expect(art?.currentPrice).toBe(3500);
      expect(art?.highestBidder).toBe(bidder2Id);
    });
  });

  describe('User Bid Statistics', () => {
    it('should retrieve bid statistics for bidder', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/users/me/bid-stats')
        .set('Authorization', `Bearer ${bidder1Token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          totalBids: expect.any(Number),
          auctionsCreated: expect.any(Number),
          auctionsWon: expect.any(Number),
        }),
      );
      expect(response.body.totalBids).toBeGreaterThanOrEqual(2);
    });
  });

  describe('User Auction History', () => {
    it('should show auctions user has bidded on via me/bidded endpoint', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/auctions/me/bidded?page=1&limit=10')
        .set('Authorization', `Bearer ${bidder1Token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          biddedAuctions: expect.any(Array),
          page: expect.any(Number),
          limit: expect.any(Number),
          total: expect.any(Number),
          totalPages: expect.any(Number),
        }),
      );
      // bidder1 should have bidded on tech and fashion auctions
      expect(response.body.biddedAuctions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Payment & Winner Management', () => {
    it('should have current highest bidder when auction is active', async () => {
      const auction = await auctionModel.findById(auctionTechId);

      expect(auction?.status).toBe('ACTIVE');
      expect(auction?.highestBidder).toBe(bidder3Id); // bidder3 has highest bid of 8500
      expect(auction?.currentPrice).toBe(8500);
    });

    it('should return correct winner when auction ends', async () => {
      // Simulate auction ending (in real scenario this is done by scheduler)
      const updatedAuction = await auctionModel.findByIdAndUpdate(
        auctionTechId,
        {
          status: 'ENDED',
          winner: bidder3Id,
        },
        { returnDocument: 'after' },
      );

      expect(updatedAuction?.winner).toBe(bidder3Id);
      expect(updatedAuction?.status).toBe('ENDED');
      expect(updatedAuction?.currentPrice).toBe(8500);
    });

    it('should track winner history changes', async () => {
      // Add to winner history when payment expires and winner changes
      const historyEntry = {
        userId: bidder1Id,
        amount: 7000,
        reason: 'payment_expired_moved_to_next_bidder',
        changedAt: new Date(),
      };

      const updated = await auctionModel.findByIdAndUpdate(
        auctionTechId,
        {
          $push: { winnerHistory: historyEntry },
          $set: { winner: bidder1Id, currentPrice: 7000 },
        },
        { returnDocument: 'after', new: true },
      );

      expect(updated?.winnerHistory?.length).toBeGreaterThan(0);
      expect(updated?.winner).toBe(bidder1Id);
    });
  });

  describe('Auction Expiry Scenarios', () => {
    it('should show expired auction as ended', async () => {
      const response = await request(app.getHttpServer()).get(
        `/v1/auctions/${auctionExpiredId}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ENDED');
      expect(response.body.winner).toBe(bidder1Id);
    });

    it('should not allow bids on ended auctions', async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/auctions/${auctionExpiredId}/bids`)
        .set('Authorization', `Bearer ${bidder2Token}`)
        .send({ amount: 800 });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/ended|closed|cannot/i);
    });
  });
});
