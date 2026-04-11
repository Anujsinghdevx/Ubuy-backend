import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { WishlistService } from './wishlist.service';
import { Wishlist } from './schemas/wishlist.schema';
import { Auction } from '@/modules/auctions/schemas/auction.schema';
import { User } from '@/modules/users/schemas/user.schema';

describe('WishlistService', () => {
  let service: WishlistService;

  const wishlistFindChain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn(),
  };

  const auctionFindChain = {
    lean: jest.fn(),
  };

  const userFindChain = {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn(),
  };

  const wishlistModel = {
    findOne: jest.fn(),
    create: jest.fn(),
    findOneAndDelete: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
  };

  const auctionModel = {
    findById: jest.fn(),
    find: jest.fn(),
  };

  const userModel = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    wishlistFindChain.sort.mockReturnThis();
    wishlistFindChain.skip.mockReturnThis();
    wishlistFindChain.limit.mockReturnThis();
    wishlistFindChain.lean.mockResolvedValue([] as never);

    auctionFindChain.lean.mockResolvedValue([] as never);
    userFindChain.select.mockReturnThis();
    userFindChain.lean.mockResolvedValue([] as never);

    wishlistModel.find.mockReturnValue(wishlistFindChain as never);
    auctionModel.find.mockReturnValue(auctionFindChain as never);
    userModel.find.mockReturnValue(userFindChain as never);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WishlistService,
        { provide: getModelToken(Wishlist.name), useValue: wishlistModel },
        { provide: getModelToken(Auction.name), useValue: auctionModel },
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile();

    service = module.get<WishlistService>(WishlistService);
  });

  it('should reject addToWishlist when auctionId is invalid', async () => {
    await expect(
      service.addToWishlist('user-1', 'bad-id'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should return already in wishlist when entry exists', async () => {
    auctionModel.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' }),
    } as never);
    wishlistModel.findOne.mockResolvedValue({ _id: 'w1' } as never);

    await expect(
      service.addToWishlist('user-1', '507f1f77bcf86cd799439011'),
    ).resolves.toEqual({ message: 'Auction already in wishlist' });
    expect(wishlistModel.create).not.toHaveBeenCalled();
  });

  it('should create wishlist entry when auction exists and not yet wishlisted', async () => {
    auctionModel.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' }),
    } as never);
    wishlistModel.findOne.mockResolvedValue(null as never);
    wishlistModel.create.mockResolvedValue({ _id: 'w2' } as never);

    await expect(
      service.addToWishlist('user-1', '507f1f77bcf86cd799439011'),
    ).resolves.toEqual({ message: 'Auction added to wishlist successfully' });
  });

  it('should throw when removing non-existing wishlist entry', async () => {
    wishlistModel.findOneAndDelete.mockResolvedValue(null as never);

    await expect(
      service.removeFromWishlist('user-1', '507f1f77bcf86cd799439011'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should return paginated wishlist with auction and seller info', async () => {
    wishlistFindChain.lean.mockResolvedValue([
      {
        _id: 'w3',
        userId: 'user-1',
        auctionId: '507f1f77bcf86cd799439011',
        createdAt: new Date('2026-04-10T00:00:00.000Z'),
      },
    ] as never);

    wishlistModel.countDocuments.mockResolvedValue(1 as never);

    auctionFindChain.lean.mockResolvedValue([
      {
        _id: '507f1f77bcf86cd799439011',
        title: 'Vintage Clock',
        createdBy: 'seller-1',
      },
    ] as never);

    userFindChain.lean.mockResolvedValue([
      {
        _id: 'seller-1',
        username: 'seller_user',
        email: 'seller@ubuy.dev',
      },
    ] as never);

    const result = await service.getMyWishlist('user-1', 1, 10);

    expect(result.total).toBe(1);
    expect(result.wishlist).toHaveLength(1);
    expect(result.wishlist[0]).toEqual(
      expect.objectContaining({
        auctionId: '507f1f77bcf86cd799439011',
        auction: expect.objectContaining({
          title: 'Vintage Clock',
          createdBy: {
            _id: 'seller-1',
            username: 'seller_user',
            email: 'seller@ubuy.dev',
          },
        }),
      }),
    );
  });
});
