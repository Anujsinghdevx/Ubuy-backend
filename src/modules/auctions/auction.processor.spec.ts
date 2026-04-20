import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AuctionProcessor } from './auction.processor';
import { AuctionsService } from './auctions.service';
import { BidsGateway } from '@/modules/bids/bids.gateway';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { ObservabilityMetricsService } from '@/common/observability/observability-metrics.service';

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

  const observabilityMetricsService = {
    recordQueueJob: jest.fn(),
  } as unknown as ObservabilityMetricsService & {
    recordQueueJob: jest.Mock;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.get.mockReturnValue('ASK_CREATOR');
    delete process.env.SLOW_QUEUE_JOB_TRACE_MS;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuctionProcessor,
        { provide: AuctionsService, useValue: auctionsService },
        { provide: BidsGateway, useValue: bidsGateway },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ConfigService, useValue: configService },
        {
          provide: ObservabilityMetricsService,
          useValue: observabilityMetricsService,
        },
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
    notificationsService.createNotification.mockResolvedValue({
      _id: 'notif-1',
    });

    await processor.process({
      id: 'job-1',
      name: 'endAuction',
      data: { auctionId: 'auction-1' },
    } as never);

    processor.onActive({ id: 'job-1', name: 'endAuction' } as never);
    processor.onCompleted({ id: 'job-1', name: 'endAuction' } as never);

    expect(auctionsService.endAuction).toHaveBeenCalledWith('auction-1');
    expect(notificationsService.createNotification).toHaveBeenCalled();
    expect(auctionsService.markAuctionNotified).toHaveBeenCalledWith(
      'auction-1',
    );
    expect(observabilityMetricsService.recordQueueJob).toHaveBeenCalledWith({
      queue: 'auctionQueue',
      jobName: 'endAuction',
      event: 'active',
    });
    expect(observabilityMetricsService.recordQueueJob).toHaveBeenCalledWith({
      queue: 'auctionQueue',
      jobName: 'endAuction',
      event: 'completed',
    });
  });

  it('should process payment reminder jobs', async () => {
    auctionsService.findById.mockResolvedValue({
      _id: 'auction-1',
      paymentStatus: 'ACTIVE',
      winner: 'winner-1',
      paymentDueAt: new Date('2026-04-12T00:00:00.000Z'),
    });
    notificationsService.createNotification.mockResolvedValue({
      _id: 'notif-2',
    });

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
    notificationsService.createNotification.mockResolvedValue({
      _id: 'notif-3',
    });

    await processor.process({
      id: 'job-3',
      name: 'paymentExpired',
      data: { auctionId: 'auction-1', winnerUserId: 'winner-1' },
    } as never);

    expect(notificationsService.createNotification).toHaveBeenCalled();
    expect(to).toHaveBeenCalledWith('user:creator-1');
  });

  it('should emit a slow queue job trace when a job exceeds the threshold', () => {
    process.env.SLOW_QUEUE_JOB_TRACE_MS = '0';
    const loggerLogSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation();
    const loggerWarnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation();
    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();

    const job = {
      id: 'job-4',
      name: 'endAuction',
      attemptsMade: 0,
      processedOn: 100,
      finishedOn: 400,
      opts: { attempts: 1 },
    } as never;

    processor.onCompleted(job);

    expect(loggerWarnSpy).toHaveBeenCalled();
    const payload = JSON.parse(loggerWarnSpy.mock.calls[0][0] as string);
    expect(payload.event).toBe('queue_job_completed');
    expect(payload.jobId).toBe('job-4');
    expect(payload.durationMs).toBe(300);
    expect(loggerLogSpy).not.toHaveBeenCalled();
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });
});
