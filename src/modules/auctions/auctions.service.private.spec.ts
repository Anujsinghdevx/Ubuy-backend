import { Test, TestingModule } from '@nestjs/testing';
import { AuctionsService } from './auctions.service';
import { getModelToken } from '@nestjs/mongoose';
import { Auction } from './schemas/auction.schema';
import { Bid } from '@/modules/bids/schemas/bid.schema';
import { User } from '@/modules/users/schemas/user.schema';
import { Wishlist } from '@/modules/wishlist/schemas/wishlist.schema';
import { getQueueToken } from '@nestjs/bullmq';
import { BidsGateway } from '@/modules/bids/bids.gateway';
import { NotificationsService } from '@/modules/notifications/notifications.service';

describe('AuctionsService (private helpers)', () => {
  let service: AuctionsService;

  const auctionModel = {};
  const bidModel = {};
  const userModel = {};
  const wishlistModel = {};
  const auctionQueue = {};
  const bidsGateway = { server: { to: jest.fn().mockReturnThis(), emit: jest.fn() } };
  const notificationsService = { createNotification: jest.fn() };

  beforeEach(async () => {
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

  it('getListResponseCacheKey returns expected key formats', () => {
    const key1 = (service as any).getListResponseCacheKey('all', 1, 20);
    expect(key1).toBe('auctions:list:all:1:20');

    const key2 = (service as any).getListResponseCacheKey('category', 2, 10, 'Fashion');
    expect(key2).toBe('auctions:list:category:2:10:fashion');
  });

  it('shouldUseListResponseCache true only for page=1 includeMeta=false compact=true', () => {
    const fn = (service as any).shouldUseListResponseCache.bind(service);

    expect(fn(1, false, true)).toBe(true);
    expect(fn(1, true, true)).toBe(false);
    expect(fn(2, false, true)).toBe(false);
    expect(fn(1, false, false)).toBe(false);
  });

  it('normalizePagination bounds values', () => {
    const norm1 = (service as any).normalizePagination(0, 0);
    expect(norm1.page).toBe(1);
    expect(norm1.limit).toBe(1);

    const norm2 = (service as any).normalizePagination(5, 200);
    expect(norm2.page).toBe(5);
    expect(norm2.limit).toBe(100);
  });
});
