import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { AuctionsService } from './auctions.service';
import { Auction } from './schemas/auction.schema';
import { Bid } from '@/modules/bids/schemas/bid.schema';
import { User } from '@/modules/users/schemas/user.schema';
import { Wishlist } from '@/modules/wishlist/schemas/wishlist.schema';
import { BidsGateway } from '@/modules/bids/bids.gateway';
import { NotificationsService } from '@/modules/notifications/notifications.service';

type MockFn = jest.Mock<any, any>;

describe('AuctionsService', () => {
  let service: AuctionsService;

  const auctionModel = {
    findById: jest.fn(),
    create: jest.fn(),
    deleteOne: jest.fn(),
    updateMany: jest.fn(),
    exists: jest.fn(),
  };

  const bidModel = {
    deleteMany: jest.fn(),
    aggregate: jest.fn(),
    countDocuments: jest.fn(),
    distinct: jest.fn(),
  };

  const userModel = {
    findById: jest.fn(),
  };

  const wishlistModel = {
    deleteMany: jest.fn(),
  };

  const auctionQueue = {
    add: jest.fn(),
    getJob: jest.fn(),
  };

  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  const bidsGateway = {
    server: {
      to,
    },
  };

  const notificationsService = {
    createNotification: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuctionsService,
        { provide: getModelToken(Auction.name), useValue: auctionModel },
        { provide: getModelToken(Bid.name), useValue: bidModel },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Wishlist.name), useValue: wishlistModel },
        { provide: getQueueToken('auctionQueue'), useValue: auctionQueue },
        { provide: BidsGateway, useValue: bidsGateway },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<AuctionsService>(AuctionsService);
  });

  it('should reject create when endTime is before or equal to startTime', async () => {
    await expect(
      service.create(
        {
          title: 'Vintage Camera',
          description: 'Good condition',
          images: ['img'],
          startingPrice: 1000,
          category: 'electronics',
          startTime: '2026-04-11T10:00:00.000Z',
          endTime: '2026-04-11T10:00:00.000Z',
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(auctionModel.create).not.toHaveBeenCalled();
    expect(auctionQueue.add).not.toHaveBeenCalled();
  });

  it('should create auction and enqueue endAuction job', async () => {
    const now = Date.now();
    const start = new Date(now - 5 * 60_000).toISOString();
    const end = new Date(now + 60 * 60_000).toISOString();

    auctionModel.create.mockResolvedValue({
      _id: 'auction-1',
      title: 'Gaming Laptop',
      startTime: new Date(start),
      endTime: new Date(end),
      status: 'ACTIVE',
    } as never);

    notificationsService.createNotification.mockResolvedValue({
      _id: 'n1',
    } as never);

    const result = await service.create(
      {
        title: 'Gaming Laptop',
        description: 'RTX included',
        images: ['a.jpg'],
        startingPrice: 50000,
        category: 'electronics',
        startTime: start,
        endTime: end,
      },
      'creator-1',
    );

    expect(auctionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Gaming Laptop',
        currentPrice: 50000,
        createdBy: 'creator-1',
        status: 'ACTIVE',
      }),
    );

    expect(auctionQueue.add).toHaveBeenCalledWith(
      'endAuction',
      { auctionId: 'auction-1' },
      expect.objectContaining({
        jobId: 'endAuction-auction-1',
      }),
    );

    expect(notificationsService.createNotification).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ _id: 'auction-1' }));
  });

  it('should reject deleteAuction when actor is not creator', async () => {
    auctionModel.findById.mockResolvedValue({
      _id: 'auction-2',
      createdBy: 'owner-1',
      paymentStatus: 'ACTIVE',
    } as never);

    await expect(
      service.deleteAuction('auction-2', 'other-user'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should reject deleteAuction when payment is already PAID', async () => {
    auctionModel.findById.mockResolvedValue({
      _id: 'auction-3',
      createdBy: 'owner-1',
      paymentStatus: 'PAID',
    } as never);

    await expect(
      service.deleteAuction('auction-3', 'owner-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(bidModel.deleteMany).not.toHaveBeenCalled();
    expect(auctionModel.deleteOne).not.toHaveBeenCalled();
  });

  it('should mark auction ended and assign winner in endAuction', async () => {
    const save = jest.fn().mockResolvedValue(undefined as never);
    const auction = {
      _id: 'auction-4',
      status: 'ACTIVE',
      highestBidder: 'winner-1',
      winner: undefined,
      save,
    };

    auctionModel.findById.mockResolvedValue(auction as never);

    const result = await service.endAuction('auction-4');

    expect(result.status).toBe('ENDED');
    expect(result.winner).toBe('winner-1');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('should throw error when endAuction is called for missing auction', async () => {
    auctionModel.findById.mockResolvedValue(null as never);

    await expect(service.endAuction('missing-auction')).rejects.toThrow(
      'Auction not found',
    );
  });

  it('should return existing auction when endAuction is already ended', async () => {
    const endedAuction = {
      _id: 'auction-5',
      status: 'ENDED',
      highestBidder: 'winner-2',
      winner: 'winner-2',
      save: jest.fn(),
    };

    auctionModel.findById.mockResolvedValue(endedAuction as never);

    const result = await service.endAuction('auction-5');

    expect(result).toBe(endedAuction);
    expect(endedAuction.save as MockFn).not.toHaveBeenCalled();
  });

  it('should reject findByCategory when category is missing', async () => {
    await expect(service.findByCategory('   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('should return empty bidded auctions when user has no bids', async () => {
    bidModel.aggregate
      .mockResolvedValueOnce([{ total: 0 }] as never)
      .mockResolvedValueOnce([] as never);

    const result = await service.findBiddedByUser('user-10', 1, 10);

    expect(result).toEqual({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
      biddedAuctions: [],
    });
  });

  it('should trigger immediate auction end when creator requests it', async () => {
    auctionModel.findById.mockResolvedValue({
      _id: 'auction-6',
      createdBy: 'owner-1',
      status: 'ACTIVE',
    } as never);
    auctionQueue.getJob.mockResolvedValue({ remove: jest.fn() } as never);

    const result = await service.requestImmediateEnd('auction-6', 'owner-1');

    expect(auctionQueue.add).toHaveBeenCalledWith(
      'endAuction',
      { auctionId: 'auction-6' },
      expect.objectContaining({ jobId: 'endAuction-auction-6' }),
    );
    expect(result).toEqual({
      message: 'Auction end triggered successfully',
      auctionId: 'auction-6',
    });
  });

  it('should return already ended response for immediate end on ended auction', async () => {
    const endedAuction = {
      _id: 'auction-7',
      createdBy: 'owner-1',
      status: 'ENDED',
    };
    auctionModel.findById.mockResolvedValue(endedAuction as never);

    await expect(
      service.requestImmediateEnd('auction-7', 'owner-1'),
    ).resolves.toEqual({
      message: 'Auction is already ended',
      auction: endedAuction,
    });
  });

  it('should reject cancelAuction for non creator', async () => {
    auctionModel.findById.mockResolvedValue({
      _id: 'auction-8',
      createdBy: 'owner-1',
      status: 'ACTIVE',
      paymentStatus: 'ACTIVE',
    } as never);

    await expect(service.cancelAuction('auction-8', 'other-user')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('should return already cancelled response for cancelAuction', async () => {
    const cancelledAuction = {
      _id: 'auction-9',
      createdBy: 'owner-1',
      status: 'CANCELLED',
      paymentStatus: 'ACTIVE',
    };
    auctionModel.findById.mockResolvedValue(cancelledAuction as never);

    await expect(
      service.cancelAuction('auction-9', 'owner-1'),
    ).resolves.toEqual({
      message: 'Auction is already cancelled',
      auction: cancelledAuction,
    });
  });
});
