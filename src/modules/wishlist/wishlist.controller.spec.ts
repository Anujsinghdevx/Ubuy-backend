import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';

describe('WishlistController', () => {
  let controller: WishlistController;
  const wishlistService = {
    addToWishlist: jest.fn(),
    getMyWishlist: jest.fn(),
    removeFromWishlist: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WishlistController],
      providers: [{ provide: WishlistService, useValue: wishlistService }],
    }).compile();

    controller = module.get<WishlistController>(WishlistController);
  });

  it('should reject addToWishlist when user is missing', async () => {
    await expect(
      controller.addToWishlist(undefined, { auctionId: '507f1f77bcf86cd799439011' } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should parse pagination and proxy wishlist lookup', async () => {
    wishlistService.getMyWishlist.mockResolvedValue({ wishlist: [] });

    await expect(
      controller.getMyWishlist(
        { userId: 'user-1', email: 'user@ubuy.dev' },
        '2',
        '10',
      ),
    ).resolves.toEqual({ wishlist: [] });

    expect(wishlistService.getMyWishlist).toHaveBeenCalledWith('user-1', 2, 10);
  });

  it('should proxy removeFromWishlist to service', async () => {
    wishlistService.removeFromWishlist.mockResolvedValue({ message: 'ok' });

    await expect(
      controller.removeFromWishlist(
        { userId: 'user-1', email: 'user@ubuy.dev' },
        { auctionId: '507f1f77bcf86cd799439011' } as never,
      ),
    ).resolves.toEqual({ message: 'ok' });
  });
});
