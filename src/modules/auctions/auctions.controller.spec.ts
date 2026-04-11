import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuctionsController } from './auctions.controller';
import { AuctionsService } from './auctions.service';
import { BidsService } from '@/modules/bids/bids.service';

describe('AuctionsController', () => {
  let controller: AuctionsController;
  const auctionsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findActive: jest.fn(),
    findByCategory: jest.fn(),
    findCreatedByUser: jest.fn(),
    findBiddedByUser: jest.fn(),
    getQueueStatus: jest.fn(),
    requestImmediateEnd: jest.fn(),
    cancelAuction: jest.fn(),
    deleteAuction: jest.fn(),
    confirmWinnerPayment: jest.fn(),
    handlePaymentExpiryDecision: jest.fn(),
    getTopBiddersForAuction: jest.fn(),
    findById: jest.fn(),
  };
  const bidsService = {
    placeBid: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuctionsController],
      providers: [
        { provide: AuctionsService, useValue: auctionsService },
        { provide: BidsService, useValue: bidsService },
      ],
    }).compile();

    controller = module.get<AuctionsController>(AuctionsController);
  });

  it('should reject createAuction without authenticated user', async () => {
    await expect(
      controller.createAuction({} as never, undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should pass parsed query params to findAll', async () => {
    auctionsService.findAll.mockResolvedValue({ data: [] });

    await expect(controller.getAll('2', '10')).resolves.toEqual({ data: [] });
    expect(auctionsService.findAll).toHaveBeenCalledWith(2, 10);
  });

  it('should reject invalid bid errors as bad request', async () => {
    bidsService.placeBid.mockRejectedValue(new Error('Bid too low'));

    await expect(
      controller.placeAuctionBid(
        'auction-1',
        { amount: 100 } as never,
        { userId: 'user-1', email: 'user@ubuy.dev' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should proxy queue status lookup', async () => {
    auctionsService.getQueueStatus.mockResolvedValue({ queue: 'auctionQueue' });

    await expect(controller.getQueueStatus()).resolves.toEqual({
      queue: 'auctionQueue',
    });
  });

  it('should proxy top bidders lookup with parsed limit', async () => {
    auctionsService.getTopBiddersForAuction.mockResolvedValue({ total: 1 });

    await expect(controller.getTopBiddersByAuction('auction-1', '5')).resolves.toEqual({
      total: 1,
    });
    expect(auctionsService.getTopBiddersForAuction).toHaveBeenCalledWith(
      'auction-1',
      5,
    );
  });

  it('should proxy payment expiry decision with authenticated user', async () => {
    auctionsService.handlePaymentExpiryDecision.mockResolvedValue({
      message: 'ok',
    });

    await expect(
      controller.handlePaymentExpiryDecision(
        'auction-1',
        { action: 'KEEP_CURRENT' } as never,
        { userId: 'user-1', email: 'user@ubuy.dev' },
      ),
    ).resolves.toEqual({ message: 'ok' });
  });
});
