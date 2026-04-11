import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { AuctionsService } from '@/modules/auctions/auctions.service';

describe('UsersController', () => {
  let controller: UsersController;
  const auctionsService = {
    getBidStatsForUser: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: AuctionsService, useValue: auctionsService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should reject bid stats request without authenticated user', async () => {
    await expect(controller.getMyBidStats(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('should proxy bid stats lookup to auctions service', async () => {
    auctionsService.getBidStatsForUser.mockResolvedValue({ totalBids: 3 });

    await expect(
      controller.getMyBidStats({ userId: 'user-1', email: 'user@ubuy.dev' }),
    ).resolves.toEqual({ totalBids: 3 });

    expect(auctionsService.getBidStatsForUser).toHaveBeenCalledWith('user-1');
  });
});
