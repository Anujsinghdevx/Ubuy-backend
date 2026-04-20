import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { AuctionsService } from './auctions.service';
import { BidsGateway } from '@/modules/bids/bids.gateway';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { ConfigService } from '@nestjs/config';
import { ObservabilityMetricsService } from '@/common/observability/observability-metrics.service';

type EndAuctionJobData = {
  auctionId: string;
};

type PaymentLifecycleJobData = {
  auctionId: string;
  winnerUserId: string;
};

type AuctionQueueJobData = EndAuctionJobData | PaymentLifecycleJobData;

@Processor('auctionQueue')
@Injectable()
export class AuctionProcessor extends WorkerHost {
  private readonly logger = new Logger(AuctionProcessor.name);
  private readonly slowJobThresholdMs = Number(
    process.env.SLOW_QUEUE_JOB_TRACE_MS ?? 250,
  );

  constructor(
    private readonly auctionsService: AuctionsService,
    private readonly bidsGateway: BidsGateway,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    private readonly observabilityMetricsService: ObservabilityMetricsService,
  ) {
    super();
  }

  async process(job: Job<AuctionQueueJobData>) {
    if (job.name === 'endAuction') {
      await this.handleEndAuction(job as Job<EndAuctionJobData>);
      return;
    }

    if (job.name === 'paymentReminder') {
      await this.handlePaymentReminder(job as Job<PaymentLifecycleJobData>);
      return;
    }

    if (job.name === 'paymentExpired') {
      await this.handlePaymentExpired(job as Job<PaymentLifecycleJobData>);
      return;
    }
  }

  private async handleEndAuction(job: Job<EndAuctionJobData>) {
    const { auctionId } = job.data;
    this.logger.log(
      `Processing endAuction job ${String(job.id)} for auction ${auctionId}`,
    );

    try {
      const auction = await this.auctionsService.endAuction(auctionId);

      if (auction.status !== 'ENDED') {
        this.logger.log(
          `Skipping endAuction side effects for auction ${auctionId} because status is ${auction.status}`,
        );
        return;
      }

      if (auction.notified) {
        this.logger.log(
          `Auction ${auctionId} already notified. Skipping emit.`,
        );
        return;
      }

      if (!this.bidsGateway.server) {
        throw new Error('WebSocket server is not initialized');
      }

      this.bidsGateway.server.to(auctionId).emit('auctionEnded', {
        auctionId,
        winner: auction.highestBidder,
        finalPrice: auction.currentPrice,
      });

      if (auction.highestBidder) {
        const paymentPath = `/payments/checkout?auctionId=${auctionId}`;

        const notification = await this.notificationsService.createNotification(
          {
            userId: auction.highestBidder,
            type: 'AUCTION_WON',
            title: 'You won the auction',
            message: `Congratulations! You won auction ${auctionId}. Complete payment to confirm your purchase.`,
            metadata: {
              auctionId,
              finalPrice: auction.currentPrice,
              paymentPath,
            },
            dedupeKey: `winner:${auctionId}:${auction.highestBidder}`,
          },
        );

        this.bidsGateway.server
          .to(`user:${auction.highestBidder}`)
          .emit('notification:new', notification);

        const lifecycle =
          await this.auctionsService.scheduleWinnerPaymentLifecycle(
            auctionId,
            auction.highestBidder,
          );

        this.logger.log(
          `Payment lifecycle scheduled for auction ${auctionId} winner ${auction.highestBidder}. Due at ${lifecycle.paymentDueAt.toISOString()}`,
        );
      }

      await this.auctionsService.markAuctionNotified(auctionId);

      this.logger.log(
        `Auction ${auctionId} marked ENDED and auctionEnded event emitted (winner: ${auction.highestBidder ?? 'none'}, finalPrice: ${auction.currentPrice})`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown processor error';

      this.logger.error(
        `endAuction processor error for job ${String(job.id)} and auction ${auctionId}: ${message}`,
      );

      throw error;
    }
  }

  private async handlePaymentReminder(job: Job<PaymentLifecycleJobData>) {
    const { auctionId, winnerUserId } = job.data;
    const auction = await this.auctionsService.findById(auctionId);

    if (!auction) {
      this.logger.warn(
        `paymentReminder skipped: auction ${auctionId} not found for job ${String(job.id)}`,
      );
      return;
    }

    if (auction.paymentStatus === 'PAID') {
      this.logger.log(
        `paymentReminder skipped: auction ${auctionId} already paid`,
      );
      return;
    }

    if (auction.winner !== winnerUserId) {
      this.logger.log(
        `paymentReminder skipped: winner changed for auction ${auctionId}`,
      );
      return;
    }

    const paymentPath = `/payments/checkout?auctionId=${auctionId}`;
    const notification = await this.notificationsService.createNotification({
      userId: winnerUserId,
      type: 'PAYMENT_REMINDER',
      title: 'Payment reminder',
      message: `Please complete payment for auction ${auctionId} before the deadline.`,
      metadata: {
        auctionId,
        paymentPath,
        paymentDueAt: auction.paymentDueAt,
      },
      dedupeKey: `paymentReminder:${auctionId}:${winnerUserId}`,
    });

    this.bidsGateway.server
      .to(`user:${winnerUserId}`)
      .emit('notification:new', notification);

    this.logger.log(
      `paymentReminder sent for auction ${auctionId} to winner ${winnerUserId}`,
    );
  }

  private async handlePaymentExpired(job: Job<PaymentLifecycleJobData>) {
    const { auctionId, winnerUserId } = job.data;
    const auction = await this.auctionsService.findById(auctionId);

    if (!auction) {
      this.logger.warn(
        `paymentExpired skipped: auction ${auctionId} not found for job ${String(job.id)}`,
      );
      return;
    }

    if (auction.paymentStatus === 'PAID') {
      this.logger.log(
        `paymentExpired skipped: auction ${auctionId} already paid`,
      );
      return;
    }

    if (auction.winner !== winnerUserId) {
      this.logger.log(
        `paymentExpired skipped: winner changed for auction ${auctionId}`,
      );
      return;
    }

    const actionRaw =
      this.configService.get<string>('PAYMENT_EXPIRY_ACTION') ?? 'ASK_CREATOR';
    const actionMode =
      actionRaw.toUpperCase() === 'SWITCH' ? 'SWITCH' : 'ASK_CREATOR';

    const winnerExpiredNotification =
      await this.notificationsService.createNotification({
        userId: winnerUserId,
        type: 'SYSTEM',
        title: 'Payment window expired',
        message: `Your payment window for auction ${auctionId} has expired.`,
        metadata: {
          auctionId,
          reason: 'PAYMENT_TIMEOUT',
        },
        dedupeKey: `paymentExpired:${auctionId}:${winnerUserId}`,
      });

    this.bidsGateway.server
      .to(`user:${winnerUserId}`)
      .emit('notification:new', winnerExpiredNotification);

    if (actionMode === 'ASK_CREATOR') {
      const creatorNotification =
        await this.notificationsService.createNotification({
          userId: auction.createdBy,
          type: 'SYSTEM',
          title: 'Winner payment expired',
          message:
            'Winner payment window expired. Choose whether to push auction to the next bidder or keep current winner.',
          metadata: {
            auctionId,
            previousWinner: winnerUserId,
            actions: ['PUSH_NEXT', 'KEEP_CURRENT'],
          },
          dedupeKey: `creatorActionRequired:${auctionId}:${winnerUserId}`,
        });

      this.bidsGateway.server
        .to(`user:${auction.createdBy}`)
        .emit('notification:new', creatorNotification);

      this.logger.warn(
        `paymentExpired for auction ${auctionId}. Creator ${auction.createdBy} notified for action`,
      );

      return;
    }

    const switched = await this.auctionsService.replaceWinnerWithNextBidder(
      auctionId,
      winnerUserId,
      'PAYMENT_EXPIRED_AUTO_SWITCH',
    );

    if (!switched) {
      const creatorNotification =
        await this.notificationsService.createNotification({
          userId: auction.createdBy,
          type: 'SYSTEM',
          title: 'No backup bidder available',
          message:
            'Winner payment expired and no next bidder is available. Please decide next manual action.',
          metadata: {
            auctionId,
            previousWinner: winnerUserId,
          },
          dedupeKey: `noBackupBidder:${auctionId}:${winnerUserId}`,
        });

      this.bidsGateway.server
        .to(`user:${auction.createdBy}`)
        .emit('notification:new', creatorNotification);

      this.logger.warn(
        `paymentExpired for auction ${auctionId}, but no backup bidder found`,
      );

      return;
    }

    const lifecycle = await this.auctionsService.scheduleWinnerPaymentLifecycle(
      auctionId,
      switched.nextBidder.userId,
    );

    const newWinnerNotification =
      await this.notificationsService.createNotification({
        userId: switched.nextBidder.userId,
        type: 'AUCTION_WON',
        title: 'You are now the winner',
        message: `Previous winner did not pay. You are now selected as winner for auction ${auctionId}.`,
        metadata: {
          auctionId,
          finalPrice: switched.nextBidder.amount,
          paymentPath: `/payments/checkout?auctionId=${auctionId}`,
        },
        dedupeKey: `winnerReassigned:${auctionId}:${switched.nextBidder.userId}`,
      });

    this.bidsGateway.server
      .to(`user:${switched.nextBidder.userId}`)
      .emit('notification:new', newWinnerNotification);

    this.bidsGateway.server.to(auctionId).emit('auctionWinnerChanged', {
      auctionId,
      previousWinner: winnerUserId,
      newWinner: switched.nextBidder.userId,
      amount: switched.nextBidder.amount,
      paymentDueAt: lifecycle.paymentDueAt,
    });

    this.logger.warn(
      `paymentExpired for auction ${auctionId}. Winner switched from ${winnerUserId} to ${switched.nextBidder.userId}`,
    );
  }

  @OnWorkerEvent('active')
  onActive(job: Job<AuctionQueueJobData>) {
    this.observabilityMetricsService.recordQueueJob({
      queue: 'auctionQueue',
      jobName: job.name,
      event: 'active',
    });
    this.logger.log(
      JSON.stringify({
        event: 'queue_job_started',
        queue: 'auctionQueue',
        jobId: String(job.id),
        jobName: job.name,
        attemptsMade: job.attemptsMade,
      }),
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<AuctionQueueJobData>) {
    this.observabilityMetricsService.recordQueueJob({
      queue: 'auctionQueue',
      jobName: job.name,
      event: 'completed',
    });
    const durationMs = this.getJobDurationMs(job);
    const tracePayload = {
      event: 'queue_job_completed',
      queue: 'auctionQueue',
      jobId: String(job.id),
      jobName: job.name,
      attemptsMade: job.attemptsMade,
      durationMs,
      thresholdMs: this.slowJobThresholdMs,
    };

    if (durationMs >= this.slowJobThresholdMs) {
      this.logger.warn(JSON.stringify(tracePayload));
      return;
    }

    this.logger.log(JSON.stringify(tracePayload));
  }

  @OnWorkerEvent('error')
  onError(error: Error) {
    this.observabilityMetricsService.recordQueueJob({
      queue: 'auctionQueue',
      jobName: 'worker',
      event: 'error',
    });
    this.logger.error(`Auction worker error: ${error.message}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<AuctionQueueJobData> | undefined, error: Error) {
    this.observabilityMetricsService.recordQueueJob({
      queue: 'auctionQueue',
      jobName: job?.name ?? 'unknown',
      event: 'failed',
    });
    if (!job) {
      this.logger.error(`Auction job failed: ${error.message}`);
      return;
    }

    const durationMs = this.getJobDurationMs(job);
    const tracePayload = {
      event: 'queue_job_failed',
      queue: 'auctionQueue',
      jobId: String(job.id),
      jobName: job.name,
      attemptsMade: job.attemptsMade,
      durationMs,
      thresholdMs: this.slowJobThresholdMs,
      error: error.message,
    };

    if (durationMs >= this.slowJobThresholdMs) {
      this.logger.warn(JSON.stringify(tracePayload));
    }

    this.logger.warn(
      `Auction job ${job.id} failed on attempt ${job.attemptsMade} of ${job.opts.attempts ?? 1}: ${error.message}`,
    );
  }

  private getJobDurationMs(job: Job<AuctionQueueJobData>) {
    const startedOn = job.processedOn ?? job.timestamp ?? Date.now();
    const finishedOn = job.finishedOn ?? Date.now();

    return Math.max(0, finishedOn - startedOn);
  }
}
