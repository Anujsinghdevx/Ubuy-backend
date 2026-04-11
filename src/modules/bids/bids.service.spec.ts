import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BidsService } from './bids.service';
import { Bid } from './schemas/bid.schema';
import { Auction } from '@/modules/auctions/schemas/auction.schema';
import { User } from '@/modules/users/schemas/user.schema';
import { BidsGateway } from './bids.gateway';
import { RedisService } from '@/common/redis/redis.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';

describe('BidsService', () => {
  let service: BidsService;

  const redisClient = {
    set: jest.fn(),
    del: jest.fn(),
  };

  const auctionModel = {
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };

  const bidModel = {
    findOne: jest.fn(),
    create: jest.fn(),
  };

  const userModel = {
    updateOne: jest.fn(),
  };

  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  const bidsGateway = {
    server: {
      to,
    },
  };

  const redisService = {
    getClient: jest.fn().mockReturnValue(redisClient),
  };

  const notificationsService = {
    createNotification: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    redisClient.set.mockResolvedValue('OK');
    redisClient.del.mockResolvedValue(1);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidsService,
        { provide: getModelToken(Auction.name), useValue: auctionModel },
        { provide: getModelToken(Bid.name), useValue: bidModel },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: BidsGateway, useValue: bidsGateway },
        { provide: RedisService, useValue: redisService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<BidsService>(BidsService);
  });

  it('should reject invalid auction id', async () => {
    await expect(service.placeBid('user-1', 'bad-id', 100)).rejects.toThrow(
      'Invalid auction id',
    );
  });

  it('should reject when another bid lock is active', async () => {
    redisClient.set.mockResolvedValue(null);

    await expect(
      service.placeBid('user-1', '507f1f77bcf86cd799439011', 100),
    ).rejects.toThrow('Another bid is being processed, try again');
  });

  it('should reject self bidding on own auction', async () => {
    auctionModel.findById.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      createdBy: 'user-1',
      endTime: new Date(Date.now() + 60_000),
      status: 'ACTIVE',
      currentPrice: 50,
    } as never);

    await expect(
      service.placeBid('user-1', '507f1f77bcf86cd799439011', 100),
    ).rejects.toThrow('You cannot bid on your own auction');
    expect(redisClient.del).toHaveBeenCalled();
  });

  it('should place a bid and emit new bid event', async () => {
    auctionModel.findById.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      createdBy: 'owner-1',
      endTime: new Date(Date.now() + 60_000),
      status: 'ACTIVE',
      currentPrice: 50,
      highestBidder: 'user-2',
    } as never);
    bidModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      }),
    });
    auctionModel.findOneAndUpdate.mockResolvedValue({ _id: '507f1f77bcf86cd799439011' } as never);
    bidModel.create.mockResolvedValue({ _id: 'bid-1' } as never);
    userModel.updateOne.mockResolvedValue({ modifiedCount: 1 } as never);

    const result = await service.placeBid(
      'user-3',
      '507f1f77bcf86cd799439011',
      100,
    );

    expect(auctionModel.findOneAndUpdate).toHaveBeenCalled();
    expect(bidModel.create).toHaveBeenCalledWith({
      auctionId: '507f1f77bcf86cd799439011',
      userId: 'user-3',
      amount: 100,
    });
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: 'user-3' },
      { $addToSet: { biddedAuctions: '507f1f77bcf86cd799439011' } },
    );
    expect(to).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
    expect(result).toEqual({ _id: '507f1f77bcf86cd799439011' });
  });

  it('should emit outbid notification when previous bidder exists', async () => {
    auctionModel.findById.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      createdBy: 'owner-1',
      endTime: new Date(Date.now() + 60_000),
      status: 'ACTIVE',
      currentPrice: 50,
      highestBidder: 'user-2',
    } as never);
    bidModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ userId: 'user-2' }),
        }),
      }),
    });
    auctionModel.findOneAndUpdate.mockResolvedValue({ _id: '507f1f77bcf86cd799439011' } as never);
    bidModel.create.mockResolvedValue({ _id: 'bid-1' } as never);
    userModel.updateOne.mockResolvedValue({ modifiedCount: 1 } as never);
    notificationsService.createNotification.mockResolvedValue({ _id: 'notif-1' } as never);

    await service.placeBid('user-3', '507f1f77bcf86cd799439011', 100);

    expect(notificationsService.createNotification).toHaveBeenCalled();
    expect(to).toHaveBeenCalledWith('user:user-2');
  });
});
