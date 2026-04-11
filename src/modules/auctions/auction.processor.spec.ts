import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuctionProcessor } from './auction.processor';
import { AuctionsService } from './auctions.service';
import { BidsGateway } from '@/modules/bids/bids.gateway';
import { NotificationsService } from '@/modules/notifications/notifications.service';

describe('AuctionProcessor', () => {
  let processor: AuctionProcessor;

  const auctionsService = {
    endAuction: jest.fn(),
    scheduleWinnerPaymentLifecycle: jest.fn(),
    markAuctionNotified: jest.fn(),
    findById: jest.fn(),
    replaceWinnerWithNextBidder: jest.fn(),
  };

  const notificationsService = {
    createNotification: jest.fn(),
  };

  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  const bidsGateway = {
    server: {
      to,
    },
  };

  const configService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.get.mockReturnValue('ASK_CREATOR');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuctionProcessor,
        { provide: AuctionsService, useValue: auctionsService },
        { provide: BidsGateway, useValue: bidsGateway },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    processor = module.get<AuctionProcessor>(AuctionProcessor);
  });

  it('should process endAuction jobs and emit winner notification', async () => {
    auctionsService.endAuction.mockResolvedValue({
      status: 'ENDED',
      notified: false,
      highestBidder: 'winner-1',
      currentPrice: 100,
    });
    auctionsService.scheduleWinnerPaymentLifecycle.mockResolvedValue({
      paymentDueAt: new Date('2026-04-12T00:00:00.000Z'),
    });
    notificationsService.createNotification.mockResolvedValue({ _id: 'notif-1' });

    await processor.process({
      id: 'job-1',
      name: 'endAuction',
      data: { auctionId: 'auction-1' },
    } as never);

    expect(auctionsService.endAuction).toHaveBeenCalledWith('auction-1');
    expect(notificationsService.createNotification).toHaveBeenCalled();
    expect(auctionsService.markAuctionNotified).toHaveBeenCalledWith('auction-1');
  });

  it('should process payment reminder jobs', async () => {
    auctionsService.findById.mockResolvedValue({
      _id: 'auction-1',
      paymentStatus: 'ACTIVE',
      winner: 'winner-1',
      paymentDueAt: new Date('2026-04-12T00:00:00.000Z'),
    });
    notificationsService.createNotification.mockResolvedValue({ _id: 'notif-2' });

    await processor.process({
      id: 'job-2',
      name: 'paymentReminder',
      data: { auctionId: 'auction-1', winnerUserId: 'winner-1' },
    } as never);

    expect(notificationsService.createNotification).toHaveBeenCalled();
    expect(to).toHaveBeenCalledWith('user:winner-1');
  });

  it('should process payment expired jobs and notify creator for action', async () => {
    auctionsService.findById.mockResolvedValue({
      _id: 'auction-1',
      paymentStatus: 'ACTIVE',
      winner: 'winner-1',
      createdBy: 'creator-1',
    });
    notificationsService.createNotification.mockResolvedValue({ _id: 'notif-3' });

    await processor.process({
      id: 'job-3',
      name: 'paymentExpired',
      data: { auctionId: 'auction-1', winnerUserId: 'winner-1' },
    } as never);

    expect(notificationsService.createNotification).toHaveBeenCalled();
    expect(to).toHaveBeenCalledWith('user:creator-1');
  });
});
