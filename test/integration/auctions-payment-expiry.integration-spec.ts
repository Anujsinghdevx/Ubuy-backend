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
import {
  Notification,
  NotificationDocument,
} from '../../src/modules/notifications/schemas/notification.schema';
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';
import { BidsGateway } from '../../src/modules/bids/bids.gateway';
import { UploadsService } from '../../src/modules/uploads/uploads.service';

jest.setTimeout(30000);

describe('Integration: auctions payment-expiry decision flow', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;
  let bidModel: Model<BidDocument>;
  let notificationModel: Model<NotificationDocument>;

  const creatorEmail = 'integration.payment-expiry.creator@ubuy.local';
  const creatorPassword = 'IntegrationCreatorPass123!';
  const creatorUsername = 'integration_payment_expiry_creator';
  const bidderEmail = 'integration.payment-expiry.bidder@ubuy.local';
  const bidderPassword = 'IntegrationBidderPass123!';
  const bidderUsername = 'integration_payment_expiry_bidder';
  const bidder2Email = 'integration.payment-expiry.bidder2@ubuy.local';
  const bidder2Password = 'IntegrationBidderPass123!';
  const bidder2Username = 'integration_payment_expiry_bidder2';

  let creatorUserId = '';
  let bidderUserId = '';
  let bidder2UserId = '';
  let creatorToken = '';
  let bidderToken = '';
  let bidder2Token = '';

  const auctionQueueMock: any = {
    add: jest.fn() as jest.Mock,
    getJob: jest.fn() as jest.Mock,
    close: jest.fn() as jest.Mock,
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

  const createEndedAuctionWithBids = async (
    creatorId: string,
    bids: Array<{ bidderId: string; amount: number }>,
  ): Promise<AuctionDocument> => {
    const startTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const endTime = new Date(Date.now() - 1000);

    const auctionData: any = {
      title: 'Test Auction for Payment Expiry',
      description: 'Test Description',
      images: ['https://example.com/test.jpg'],
      startingPrice: 100,
      currentPrice: bids.length > 0 ? bids[bids.length - 1].amount : 100,
      status: 'ENDED',
      paymentStatus: 'ACTIVE',
      startTime,
      endTime,
      category: 'test-category',
      createdBy: creatorId,
    };

    if (bids.length > 0) {
      auctionData.winner = bids[bids.length - 1].bidderId;
    }

    const auction = await auctionModel.create(auctionData);

    // Create bids (highest bid last = current winner)
    for (let i = 0; i < bids.length; i++) {
      await bidModel.create({
        auctionId: String(auction._id),
        userId: bids[i].bidderId,
        amount: bids[i].amount,
      });
    }

    return auction as AuctionDocument;
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
    auctionModel = app.get<Model<AuctionDocument>>(getModelToken(Auction.name));
    bidModel = app.get<Model<BidDocument>>(getModelToken(Bid.name));
    notificationModel = app.get<Model<NotificationDocument>>(
      getModelToken(Notification.name),
    );

    // Clean up any existing test users
    await userModel.deleteOne({ email: creatorEmail });
    await userModel.deleteOne({ email: bidderEmail });
    await userModel.deleteOne({ email: bidder2Email });

    const [creatorHashedPassword, bidderHashedPassword, bidder2HashedPassword] =
      await Promise.all([
        bcrypt.hash(creatorPassword, 10),
        bcrypt.hash(bidderPassword, 10),
        bcrypt.hash(bidder2Password, 10),
      ]);

    const creatorUser = await userModel.create({
      email: creatorEmail,
      username: creatorUsername,
      password: creatorHashedPassword,
      provider: 'local',
      isVerified: true,
    });

    const bidderUser = await userModel.create({
      email: bidderEmail,
      username: bidderUsername,
      password: bidderHashedPassword,
      provider: 'local',
      isVerified: true,
    });

    const bidder2User = await userModel.create({
      email: bidder2Email,
      username: bidder2Username,
      password: bidder2HashedPassword,
      provider: 'local',
      isVerified: true,
    });

    creatorUserId = String(creatorUser._id);
    bidderUserId = String(bidderUser._id);
    bidder2UserId = String(bidder2User._id);

    creatorToken = await loginAndGetToken(creatorEmail, creatorPassword);
    bidderToken = await loginAndGetToken(bidderEmail, bidderPassword);
    bidder2Token = await loginAndGetToken(bidder2Email, bidder2Password);
  });

  afterAll(async () => {
    await bidModel.deleteMany({
      userId: { $in: [creatorUserId, bidderUserId, bidder2UserId] },
    });
    await auctionModel.deleteMany({
      createdBy: { $in: [creatorUserId, bidderUserId, bidder2UserId] },
    });
    await notificationModel.deleteMany({
      userId: { $in: [creatorUserId, bidderUserId, bidder2UserId] },
    });

    await userModel.deleteOne({ email: creatorEmail });
    await userModel.deleteOne({ email: bidderEmail });
    await userModel.deleteOne({ email: bidder2Email });

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  afterEach(async () => {
    await auctionModel.deleteMany({});
    await bidModel.deleteMany({});
    await notificationModel.deleteMany({});
  });

  describe('KEEP_CURRENT decision', () => {
    it('should reschedule payment window for current winner and return paymentDueAt', async () => {
      // Arrange: Create ended auction with single bidder
      const auction = await createEndedAuctionWithBids(creatorUserId, [
        { bidderId: bidderUserId, amount: 150 },
      ]);

      // Act: Creator decides to keep current winner (extend payment window)
      const response = await request(app.getHttpServer())
        .post(`/v1/auctions/${auction._id}/payment-expiry/decision`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({ action: 'KEEP_CURRENT' });

      // Assert: Response indicates success with paymentDueAt
      expect(response.status).toBe(201);
      expect(response.body).toEqual(
        expect.objectContaining({
          message: 'Payment window extended for current winner',
          paymentDueAt: expect.any(String), // ISO date string
          auction: expect.objectContaining({
            _id: auction._id.toString(),
            winner: bidderUserId,
          }),
        }),
      );

      // Assert: Notifications created for winner and creator
      const notifications = await notificationModel.find({});
      expect(notifications.length).toBeGreaterThanOrEqual(2);

      const winnerNotif = notifications.find(
        (n) =>
          n.userId.toString() === bidderUserId &&
          n.title === 'Payment window extended',
      );
      expect(winnerNotif).toBeDefined();
      expect(winnerNotif?.dedupeKey).toContain(
        `paymentExtended:${auction._id}`,
      );

      const creatorNotif = notifications.find(
        (n) =>
          n.userId.toString() === creatorUserId &&
          n.title === 'Payment window extended',
      );
      expect(creatorNotif).toBeDefined();
      expect(creatorNotif?.dedupeKey).toContain(
        `creatorPaymentExtended:${auction._id}`,
      );
    });
  });

  describe('PUSH_NEXT decision', () => {
    it('should switch to next bidder when available', async () => {
      // Arrange: Create ended auction with two bidders
      const auction = await createEndedAuctionWithBids(creatorUserId, [
        { bidderId: bidderUserId, amount: 150 },
        { bidderId: bidder2UserId, amount: 200 }, // Current winner
      ]);

      // Act: Creator decides to push to next bidder
      const response = await request(app.getHttpServer())
        .post(`/v1/auctions/${auction._id}/payment-expiry/decision`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({ action: 'PUSH_NEXT' });

      // Assert: Response indicates successful action
      expect(response.status).toBe(201);
      expect(response.body).toEqual(
        expect.objectContaining({
          message: expect.any(String),
          auction: expect.any(Object),
        }),
      );

      // Assert: Verify new winner is the next-highest bidder
      const updatedAuction = await auctionModel.findById(auction._id);
      expect(String(updatedAuction?.winner)).toBe(bidderUserId);

      // Assert: Notifications created for all parties
      const notifications = await notificationModel.find({});
      expect(notifications.length).toBeGreaterThanOrEqual(3);

      // Previous winner notification
      const previousWinnerNotif = notifications.find(
        (n) =>
          n.userId.toString() === bidder2UserId && n.title === 'Winner changed',
      );
      expect(previousWinnerNotif).toBeDefined();

      // New winner notification
      const newWinnerNotif = notifications.find(
        (n) =>
          n.userId.toString() === bidderUserId &&
          n.title === 'You are now the winner',
      );
      expect(newWinnerNotif).toBeDefined();
      expect(newWinnerNotif?.type).toBe('AUCTION_WON');

      // Creator notification
      const creatorNotif = notifications.find(
        (n) =>
          n.userId.toString() === creatorUserId &&
          n.title === 'Winner switched',
      );
      expect(creatorNotif).toBeDefined();
    });

    it('should return "no next bidder" message when only one bid exists', async () => {
      // Arrange: Create ended auction with single bidder (no one to promote to)
      const auction = await createEndedAuctionWithBids(creatorUserId, [
        { bidderId: bidderUserId, amount: 150 },
      ]);

      // Act: Creator decides to push to next bidder, but none exist
      const response = await request(app.getHttpServer())
        .post(`/v1/auctions/${auction._id}/payment-expiry/decision`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({ action: 'PUSH_NEXT' });

      // Assert: Response indicates no next bidder available
      expect(response.status).toBe(201);
      expect(response.body).toEqual(
        expect.objectContaining({
          message: 'No next bidder available to promote',
          auction: expect.objectContaining({
            winner: bidderUserId,
          }),
        }),
      );

      // Assert: Winner remains the same (not changed)
      const unchangedAuction = await auctionModel.findById(auction._id);
      expect(String(unchangedAuction?.winner)).toBe(bidderUserId);
    });
  });

  describe('Error cases', () => {
    it('should reject non-creator', async () => {
      // Arrange
      const auction = await createEndedAuctionWithBids(creatorUserId, [
        { bidderId: bidderUserId, amount: 150 },
      ]);

      // Act: Non-creator tries to make decision
      const response = await request(app.getHttpServer())
        .post(`/v1/auctions/${auction._id}/payment-expiry/decision`)
        .set('Authorization', `Bearer ${bidderToken}`)
        .send({ action: 'KEEP_CURRENT' });

      // Assert: 400 error with permission message
      expect(response.status).toBe(400);
      expect(response.body).toEqual(
        expect.objectContaining({
          message: 'Only auction creator can take this action',
        }),
      );

      // Winner should remain unchanged
      const unchangedAuction = await auctionModel.findById(auction._id);
      expect(String(unchangedAuction?.winner)).toBe(bidderUserId);
    });

    it('should reject decision on already-paid auction', async () => {
      // Arrange
      const auction = await createEndedAuctionWithBids(creatorUserId, [
        { bidderId: bidderUserId, amount: 150 },
      ]);

      // Mark as PAID
      await auctionModel.updateOne(
        { _id: auction._id },
        { paymentStatus: 'PAID' },
      );

      // Act: Creator tries to make decision on paid auction
      const response = await request(app.getHttpServer())
        .post(`/v1/auctions/${auction._id}/payment-expiry/decision`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({ action: 'KEEP_CURRENT' });

      // Assert: 400 error indicating payment already completed
      expect(response.status).toBe(400);
      expect(response.body).toEqual(
        expect.objectContaining({
          message: 'Payment is already completed',
        }),
      );
    });

    it('should reject decision on auction with no winner', async () => {
      // Arrange: Create ended auction with no bids (no winner)
      const startTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const endTime = new Date(Date.now() - 1000);

      const auctionData: any = {
        title: 'No Bids Auction',
        description: 'Test Description',
        images: ['https://example.com/test.jpg'],
        category: 'test-category',
        createdBy: creatorUserId,
        startingPrice: 100,
        currentPrice: 100,
        status: 'ENDED',
        paymentStatus: 'ACTIVE',
        startTime,
        endTime,
      };

      const auction = await auctionModel.create(auctionData);

      // Act: Creator tries to make payment decision on no-winner auction
      const response = await request(app.getHttpServer())
        .post(`/v1/auctions/${auction._id}/payment-expiry/decision`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({ action: 'KEEP_CURRENT' });

      // Assert: 400 error indicating no winner
      expect(response.status).toBe(400);
      expect(response.body).toEqual(
        expect.objectContaining({
          message: 'Auction has no winner to process',
        }),
      );
    });

    it('should reject non-existent auction', async () => {
      // Act: Try to make decision on non-existent auction
      const fakeAuctionId = '507f1f77bcf86cd799439011'; // Valid MongoDB ObjectId but nonexistent
      const response = await request(app.getHttpServer())
        .post(`/v1/auctions/${fakeAuctionId}/payment-expiry/decision`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({ action: 'KEEP_CURRENT' });

      // Assert: 400 error indicating auction not found
      expect(response.status).toBe(400);
      expect(response.body).toEqual(
        expect.objectContaining({
          message: 'Auction not found',
        }),
      );
    });
  });
});
