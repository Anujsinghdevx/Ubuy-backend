import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Auction, AuctionDocument } from './schemas/auction.schema';
import { Model } from 'mongoose';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Bid, BidDocument } from '@/modules/bids/schemas/bid.schema';
import { PaymentExpiryDecisionAction } from './dto/payment-expiry-decision.dto';
import { BidsGateway } from '@/modules/bids/bids.gateway';
import { NotificationsService } from '@/modules/notifications/notifications.service';

const PAYMENT_REMINDER_DELAY_MS = 12 * 60 * 60 * 1000;
const PAYMENT_EXPIRY_DELAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuctionsService {
  private readonly logger = new Logger(AuctionsService.name);

  constructor(
    @InjectModel(Auction.name)
    private auctionModel: Model<AuctionDocument>,
    @InjectModel(Bid.name)
    private bidModel: Model<BidDocument>,
    @InjectQueue('auctionQueue') private auctionQueue: Queue,
    private readonly bidsGateway: BidsGateway,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(createDto: CreateAuctionDto, userId: string) {
    if (new Date(createDto.endTime) <= new Date(createDto.startTime)) {
      throw new BadRequestException('End time must be after start time');
    }

    const auction = await this.auctionModel.create({
      ...createDto,
      currentPrice: createDto.startingPrice,
      createdBy: userId,
      status: 'ACTIVE',
    });

    const delay = Math.max(0, new Date(auction.endTime).getTime() - Date.now());

    try {
      await this.auctionQueue.add(
        'endAuction',
        { auctionId: String(auction._id) },
        {
          delay,
          jobId: `endAuction-${String(auction._id)}`,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue endAuction job for auction ${String(auction._id)}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    return auction;
  }

  async endAuction(auctionId: string) {
    const auction = await this.auctionModel.findById(auctionId);

    if (!auction) throw new Error('Auction not found');

    if (auction.status === 'ENDED') return auction;
    if (auction.status === 'CANCELLED') return auction;

    auction.status = 'ENDED';
    auction.winner = auction.highestBidder;

    await auction.save();

    return auction;
  }

  private async removeScheduledEndAuctionJob(auctionId: string) {
    const endJobId = `endAuction-${auctionId}`;
    const endJob = await this.auctionQueue.getJob(endJobId);

    if (endJob) {
      await endJob.remove();
    }
  }

  async requestImmediateEnd(auctionId: string, actorUserId: string) {
    const auction = await this.auctionModel.findById(auctionId);

    if (!auction) {
      throw new BadRequestException('Auction not found');
    }

    if (auction.createdBy !== actorUserId) {
      throw new BadRequestException('Only auction creator can end auction');
    }

    if (auction.status === 'CANCELLED') {
      throw new BadRequestException('Cancelled auction cannot be ended');
    }

    if (auction.status === 'ENDED') {
      return {
        message: 'Auction is already ended',
        auction,
      };
    }

    await this.removeScheduledEndAuctionJob(auctionId);

    await this.auctionQueue.add(
      'endAuction',
      { auctionId },
      {
        jobId: `endAuction-${auctionId}`,
      },
    );

    return {
      message: 'Auction end triggered successfully',
      auctionId,
    };
  }

  async cancelAuction(auctionId: string, actorUserId: string) {
    const auction = await this.auctionModel.findById(auctionId);

    if (!auction) {
      throw new BadRequestException('Auction not found');
    }

    if (auction.createdBy !== actorUserId) {
      throw new BadRequestException('Only auction creator can cancel auction');
    }

    if (auction.status === 'CANCELLED') {
      return {
        message: 'Auction is already cancelled',
        auction,
      };
    }

    if (auction.paymentStatus === 'PAID') {
      throw new BadRequestException('Paid auction cannot be cancelled');
    }

    const previousWinner = auction.winner;

    if (auction.status === 'ENDED' && previousWinner) {
      await this.clearWinnerPaymentLifecycleJobs(auctionId, previousWinner);
    }

    await this.removeScheduledEndAuctionJob(auctionId);

    auction.status = 'CANCELLED';
    auction.winner = undefined;
    auction.paymentDueAt = undefined;

    await auction.save();

    this.bidsGateway.server.to(auctionId).emit('auctionCancelled', {
      auctionId,
      cancelledBy: actorUserId,
    });

    const creatorNotification = await this.notificationsService.createNotification({
      userId: actorUserId,
      type: 'SYSTEM',
      title: 'Auction cancelled',
      message: `You cancelled auction ${auctionId}.`,
      metadata: {
        auctionId,
      },
      dedupeKey: `auctionCancelled:${auctionId}:${actorUserId}`,
    });

    this.bidsGateway.server
      .to(`user:${actorUserId}`)
      .emit('notification:new', creatorNotification);

    const bidderUserIds = await this.bidModel.distinct('userId', {
      auctionId,
    });

    const usersToNotify = Array.from(
      new Set(
        bidderUserIds.filter(
          (userId): userId is string =>
            typeof userId === 'string' && userId !== actorUserId,
        ),
      ),
    );

    await Promise.all(
      usersToNotify.map(async (userId) => {
        const bidderNotification = await this.notificationsService.createNotification(
          {
            userId,
            type: 'SYSTEM',
            title: 'Auction cancelled',
            message: `Auction ${auctionId} was cancelled by the creator.`,
            metadata: {
              auctionId,
              cancelledBy: actorUserId,
            },
            dedupeKey: `auctionCancelledBidder:${auctionId}:${userId}`,
          },
        );

        this.bidsGateway.server
          .to(`user:${userId}`)
          .emit('notification:new', bidderNotification);
      }),
    );

    return {
      message: 'Auction cancelled successfully',
      auction,
    };
  }

  async scheduleWinnerPaymentLifecycle(auctionId: string, winnerUserId: string) {
    const now = Date.now();
    const dueAt = new Date(now + PAYMENT_EXPIRY_DELAY_MS);

    await this.auctionModel.findByIdAndUpdate(auctionId, {
      $set: { paymentDueAt: dueAt },
    });

    await this.auctionQueue.add(
      'paymentReminder',
      { auctionId, winnerUserId },
      {
        delay: PAYMENT_REMINDER_DELAY_MS,
        jobId: `paymentReminder-${auctionId}-${winnerUserId}`,
      },
    );

    await this.auctionQueue.add(
      'paymentExpired',
      { auctionId, winnerUserId },
      {
        delay: PAYMENT_EXPIRY_DELAY_MS,
        jobId: `paymentExpired-${auctionId}-${winnerUserId}`,
      },
    );

    return { paymentDueAt: dueAt };
  }

  async clearWinnerPaymentLifecycleJobs(auctionId: string, winnerUserId: string) {
    const reminderJobId = `paymentReminder-${auctionId}-${winnerUserId}`;
    const expiredJobId = `paymentExpired-${auctionId}-${winnerUserId}`;

    const [reminderJob, expiredJob] = await Promise.all([
      this.auctionQueue.getJob(reminderJobId),
      this.auctionQueue.getJob(expiredJobId),
    ]);

    await Promise.all([
      reminderJob?.remove(),
      expiredJob?.remove(),
    ]);
  }

  async confirmWinnerPayment(auctionId: string, userId: string) {
    const auction = await this.auctionModel.findById(auctionId);

    if (!auction) {
      throw new BadRequestException('Auction not found');
    }

    if (auction.status !== 'ENDED') {
      throw new BadRequestException('Auction is not ended');
    }

    if (!auction.winner || auction.winner !== userId) {
      throw new BadRequestException('Only current winner can confirm payment');
    }

    if (auction.paymentStatus === 'PAID') {
      return {
        message: 'Payment already confirmed',
        auction,
      };
    }

    auction.paymentStatus = 'PAID';
    await auction.save();

    await this.clearWinnerPaymentLifecycleJobs(auctionId, userId);

    return {
      message: 'Payment confirmed successfully',
      auction,
    };
  }

  async confirmWinnerPaymentByProvider(
    auctionId: string,
    expectedWinnerUserId?: string,
  ) {
    const auction = await this.auctionModel.findById(auctionId);

    if (!auction) {
      throw new BadRequestException('Auction not found');
    }

    if (auction.status !== 'ENDED') {
      throw new BadRequestException('Auction is not ended');
    }

    if (!auction.winner) {
      throw new BadRequestException('Auction has no winner');
    }

    if (expectedWinnerUserId && auction.winner !== expectedWinnerUserId) {
      throw new BadRequestException('Winner mismatch for payment confirmation');
    }

    if (auction.paymentStatus === 'PAID') {
      return {
        message: 'Payment already confirmed',
        auction,
      };
    }

    auction.paymentStatus = 'PAID';
    await auction.save();

    await this.clearWinnerPaymentLifecycleJobs(auctionId, auction.winner);

    return {
      message: 'Payment confirmed successfully',
      auction,
    };
  }

  async findNextHighestBidder(auctionId: string, currentWinnerUserId: string) {
    const bids = await this.bidModel
      .find({ auctionId })
      .sort({ amount: -1, createdAt: 1 })
      .limit(100);

    for (const bid of bids) {
      if (bid.userId !== currentWinnerUserId) {
        return {
          userId: bid.userId,
          amount: bid.amount,
        };
      }
    }

    return null;
  }

  async replaceWinnerWithNextBidder(
    auctionId: string,
    previousWinnerUserId: string,
    reason = 'PAYMENT_EXPIRED',
  ) {
    const auction = await this.auctionModel.findById(auctionId);

    if (!auction) {
      throw new BadRequestException('Auction not found');
    }

    const nextBidder = await this.findNextHighestBidder(
      auctionId,
      previousWinnerUserId,
    );

    if (!nextBidder) {
      return null;
    }

    auction.winnerHistory = [
      ...(auction.winnerHistory ?? []),
      {
        userId: previousWinnerUserId,
        amount: auction.currentPrice,
        reason,
        changedAt: new Date(),
      },
    ];

    auction.winner = nextBidder.userId;
    auction.highestBidder = nextBidder.userId;
    auction.currentPrice = nextBidder.amount;
    auction.paymentStatus = 'ACTIVE';

    await auction.save();

    return {
      auction,
      nextBidder,
    };
  }

  async handlePaymentExpiryDecision(
    auctionId: string,
    creatorUserId: string,
    action: PaymentExpiryDecisionAction,
  ) {
    const auction = await this.auctionModel.findById(auctionId);

    if (!auction) {
      throw new BadRequestException('Auction not found');
    }

    if (auction.createdBy !== creatorUserId) {
      throw new BadRequestException('Only auction creator can take this action');
    }

    if (auction.paymentStatus === 'PAID') {
      throw new BadRequestException('Payment is already completed');
    }

    const currentWinner = auction.winner;

    if (!currentWinner) {
      throw new BadRequestException('Auction has no winner to process');
    }

    if (action === 'KEEP_CURRENT') {
      await this.clearWinnerPaymentLifecycleJobs(auctionId, currentWinner);
      const lifecycle = await this.scheduleWinnerPaymentLifecycle(
        auctionId,
        currentWinner,
      );

      return {
        message: 'Payment window extended for current winner',
        paymentDueAt: lifecycle.paymentDueAt,
        auction,
      };
    }

    const switched = await this.replaceWinnerWithNextBidder(
      auctionId,
      currentWinner,
      'CREATOR_DECISION_PUSH_NEXT',
    );

    if (!switched) {
      return {
        message: 'No next bidder available to promote',
        auction,
      };
    }

    await this.clearWinnerPaymentLifecycleJobs(auctionId, currentWinner);
    const lifecycle = await this.scheduleWinnerPaymentLifecycle(
      auctionId,
      switched.nextBidder.userId,
    );

    return {
      message: 'Winner switched to next eligible bidder',
      paymentDueAt: lifecycle.paymentDueAt,
      auction: switched.auction,
      nextBidder: switched.nextBidder,
    };
  }

  async markAuctionNotified(auctionId: string) {
    await this.auctionModel.findByIdAndUpdate(auctionId, {
      $set: { notified: true },
    });
  }

  async getQueueStatus() {
    const counts = await this.auctionQueue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'completed',
      'failed',
    );

    const [failed, delayed, waiting, active] = await Promise.all([
      this.auctionQueue.getJobs(['failed'], 0, 9, false),
      this.auctionQueue.getJobs(['delayed'], 0, 9, false),
      this.auctionQueue.getJobs(['waiting'], 0, 9, false),
      this.auctionQueue.getJobs(['active'], 0, 9, false),
    ]);

    const mapJob = (job: Job) => ({
      id: job.id,
      name: job.name,
      data: job.data,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
      failedReason: job.failedReason,
      delay: job.delay,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    });

    return {
      queue: 'auctionQueue',
      counts,
      sample: {
        failed: failed.map(mapJob),
        delayed: delayed.map(mapJob),
        waiting: waiting.map(mapJob),
        active: active.map(mapJob),
      },
    };
  }

  async findAll() {
    return this.auctionModel.find().sort({ createdAt: -1 });
  }

  async findById(id: string) {
    return this.auctionModel.findById(id);
  }

  async findActive() {
    return this.auctionModel.find({ status: 'ACTIVE' });
  }

  async findBiddedByUser(userId: string) {
    const bidSummary = await this.bidModel.aggregate<{
      _id: string;
      lastBidAt: Date;
      highestMyBid: number;
      lastBidAmount: number;
    }>([
      {
        $match: { userId },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: '$auctionId',
          lastBidAt: { $first: '$createdAt' },
          highestMyBid: { $max: '$amount' },
          lastBidAmount: { $first: '$amount' },
        },
      },
      {
        $sort: { lastBidAt: -1 },
      },
    ]);

    if (bidSummary.length === 0) {
      return [];
    }

    const auctionIds = bidSummary.map((item) => item._id);

    const auctions = await this.auctionModel.find({
      _id: { $in: auctionIds },
    });

    const auctionById = new Map(auctions.map((auction) => [String(auction._id), auction]));

    return bidSummary
      .map((item) => {
        const auction = auctionById.get(item._id);

        if (!auction) {
          return null;
        }

        return {
          auction,
          myBid: {
            highest: item.highestMyBid,
            lastAmount: item.lastBidAmount,
            lastBidAt: item.lastBidAt,
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }
}
