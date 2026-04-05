import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Auction, AuctionDocument } from './schemas/auction.schema';
import { Model, PipelineStage, Types } from 'mongoose';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Bid, BidDocument } from '@/modules/bids/schemas/bid.schema';
import { PaymentExpiryDecisionAction } from './dto/payment-expiry-decision.dto';
import { BidsGateway } from '@/modules/bids/bids.gateway';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { User, UserDocument } from '@/modules/users/schemas/user.schema';
import { Wishlist, WishlistDocument } from '@/modules/wishlist/schemas/wishlist.schema';

const PAYMENT_REMINDER_DELAY_MS = 12 * 60 * 60 * 1000;
const PAYMENT_EXPIRY_DELAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuctionsService {
  private readonly logger = new Logger(AuctionsService.name);

  private normalizePagination(page?: number, limit?: number) {
    const normalizedPage = Math.max(1, page ?? 1);
    const normalizedLimit = Math.min(100, Math.max(1, limit ?? 20));

    return {
      page: normalizedPage,
      limit: normalizedLimit,
      skip: (normalizedPage - 1) * normalizedLimit,
    };
  }

  constructor(
    @InjectModel(Auction.name)
    private auctionModel: Model<AuctionDocument>,
    @InjectModel(Bid.name)
    private bidModel: Model<BidDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(Wishlist.name)
    private wishlistModel: Model<WishlistDocument>,
    @InjectQueue('auctionQueue') private auctionQueue: Queue,
    private readonly bidsGateway: BidsGateway,
    private readonly notificationsService: NotificationsService,
  ) {}

  async deleteAuction(auctionId: string, actorUserId: string) {
    const auction = await this.auctionModel.findById(auctionId);

    if (!auction) {
      throw new BadRequestException('Auction not found');
    }

    if (auction.createdBy !== actorUserId) {
      throw new BadRequestException('Only auction creator can delete auction');
    }

    if (auction.paymentStatus === 'PAID') {
      throw new BadRequestException('Paid auction cannot be deleted');
    }

    await this.removeScheduledEndAuctionJob(auctionId);

    if (auction.winner) {
      await this.clearWinnerPaymentLifecycleJobs(auctionId, auction.winner);
    }

    await Promise.all([
      this.bidModel.deleteMany({ auctionId }),
      this.wishlistModel.deleteMany({ auctionId }),
      this.auctionModel.deleteOne({ _id: auctionId }),
    ]);

    this.bidsGateway.server.to(auctionId).emit('auctionDeleted', {
      auctionId,
      deletedBy: actorUserId,
    });

    return {
      message: 'Auction deleted successfully',
      auctionId,
    };
  }

  async getBidStatsForUser(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select({ _id: 1, biddedAuctions: 1 });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const auctionIds = (user.biddedAuctions ?? []).filter((id) =>
      Types.ObjectId.isValid(id),
    );

    if (auctionIds.length > 0) {
      await this.auctionModel.updateMany(
        {
          _id: { $in: auctionIds },
          endTime: { $lte: new Date() },
          status: 'ACTIVE',
        },
        {
          $set: {
            status: 'ENDED',
          },
        },
      );
    }

    const totalBids = await this.bidModel.countDocuments(
      auctionIds.length > 0
        ? { userId, auctionId: { $in: auctionIds } }
        : { userId },
    );

    const auctionsCreated = await this.auctionModel.countDocuments({
      createdBy: userId,
    });

    const auctionsWon =
      auctionIds.length > 0
        ? await this.auctionModel.countDocuments({
            _id: { $in: auctionIds },
            winner: userId,
          })
        : 0;

    return {
      totalBids,
      auctionsCreated,
      auctionsWon,
    };
  }

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

    try {
      await this.notificationsService.createNotification({
        userId,
        type: 'SYSTEM',
        title: 'Auction created',
        message: `Your auction \"${auction.title}\" has been created successfully.`,
        metadata: {
          auctionId: String(auction._id),
          title: auction.title,
          status: auction.status,
          startTime: auction.startTime,
          endTime: auction.endTime,
        },
        dedupeKey: `auctionCreated:${String(auction._id)}:${userId}`,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to create auction-created notification for auction ${String(auction._id)}: ${error instanceof Error ? error.message : 'Unknown error'}`,
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

    try {
      const winnerNotification = await this.notificationsService.createNotification({
        userId,
        type: 'PAYMENT_SUCCESS',
        title: 'Payment successful',
        message: `Payment confirmed for auction ${auctionId}.`,
        metadata: {
          auctionId,
          paymentConfirmedBy: userId,
        },
        dedupeKey: `manualPaymentSuccess:${auctionId}:${userId}`,
      });

      this.bidsGateway.server
        .to(`user:${userId}`)
        .emit('notification:new', winnerNotification);

      if (auction.createdBy !== userId) {
        const creatorNotification = await this.notificationsService.createNotification({
          userId: auction.createdBy,
          type: 'SYSTEM',
          title: 'Winner payment received',
          message: `Winner payment is confirmed for auction ${auctionId}.`,
          metadata: {
            auctionId,
            winner: userId,
          },
          dedupeKey: `manualCreatorPaymentReceived:${auctionId}:${auction.createdBy}`,
        });

        this.bidsGateway.server
          .to(`user:${auction.createdBy}`)
          .emit('notification:new', creatorNotification);
      }

      this.bidsGateway.server.to(auctionId).emit('paymentConfirmed', {
        auctionId,
        winner: userId,
        paymentStatus: auction.paymentStatus,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to emit payment confirmation notifications for auction ${auctionId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

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

      try {
        const winnerNotification = await this.notificationsService.createNotification({
          userId: currentWinner,
          type: 'SYSTEM',
          title: 'Payment window extended',
          message: `Payment deadline for auction ${auctionId} has been extended by the creator.`,
          metadata: {
            auctionId,
            paymentDueAt: lifecycle.paymentDueAt,
          },
          dedupeKey: `paymentExtended:${auctionId}:${currentWinner}`,
        });

        this.bidsGateway.server
          .to(`user:${currentWinner}`)
          .emit('notification:new', winnerNotification);

        const creatorNotification = await this.notificationsService.createNotification({
          userId: creatorUserId,
          type: 'SYSTEM',
          title: 'Payment window extended',
          message: `You extended payment deadline for winner on auction ${auctionId}.`,
          metadata: {
            auctionId,
            winnerUserId: currentWinner,
            paymentDueAt: lifecycle.paymentDueAt,
          },
          dedupeKey: `creatorPaymentExtended:${auctionId}:${creatorUserId}`,
        });

        this.bidsGateway.server
          .to(`user:${creatorUserId}`)
          .emit('notification:new', creatorNotification);
      } catch (error) {
        this.logger.warn(
          `Failed to create payment extension notifications for auction ${auctionId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }

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

    try {
      const previousWinnerNotification = await this.notificationsService.createNotification({
        userId: currentWinner,
        type: 'SYSTEM',
        title: 'Winner changed',
        message: `You are no longer the winner for auction ${auctionId}.`,
        metadata: {
          auctionId,
          reason: 'CREATOR_DECISION_PUSH_NEXT',
          newWinner: switched.nextBidder.userId,
        },
        dedupeKey: `winnerChangedOut:${auctionId}:${currentWinner}`,
      });

      this.bidsGateway.server
        .to(`user:${currentWinner}`)
        .emit('notification:new', previousWinnerNotification);

      const newWinnerNotification = await this.notificationsService.createNotification({
        userId: switched.nextBidder.userId,
        type: 'AUCTION_WON',
        title: 'You are now the winner',
        message: `You are now selected as winner for auction ${auctionId}.`,
        metadata: {
          auctionId,
          finalPrice: switched.nextBidder.amount,
          paymentPath: `/payments/checkout?auctionId=${auctionId}`,
          paymentDueAt: lifecycle.paymentDueAt,
        },
        dedupeKey: `winnerReassignedManual:${auctionId}:${switched.nextBidder.userId}`,
      });

      this.bidsGateway.server
        .to(`user:${switched.nextBidder.userId}`)
        .emit('notification:new', newWinnerNotification);

      const creatorNotification = await this.notificationsService.createNotification({
        userId: creatorUserId,
        type: 'SYSTEM',
        title: 'Winner switched',
        message: `Winner has been switched to next eligible bidder for auction ${auctionId}.`,
        metadata: {
          auctionId,
          previousWinner: currentWinner,
          newWinner: switched.nextBidder.userId,
          amount: switched.nextBidder.amount,
          paymentDueAt: lifecycle.paymentDueAt,
        },
        dedupeKey: `creatorWinnerSwitched:${auctionId}:${creatorUserId}`,
      });

      this.bidsGateway.server
        .to(`user:${creatorUserId}`)
        .emit('notification:new', creatorNotification);

      this.bidsGateway.server.to(auctionId).emit('auctionWinnerChanged', {
        auctionId,
        previousWinner: currentWinner,
        newWinner: switched.nextBidder.userId,
        amount: switched.nextBidder.amount,
        paymentDueAt: lifecycle.paymentDueAt,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to create winner-switch notifications for auction ${auctionId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

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

  async findAll(page?: number, limit?: number) {
    const pagination = this.normalizePagination(page, limit);

    const [data, total] = await Promise.all([
      this.auctionModel
        .find()
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.auctionModel.countDocuments(),
    ]);

    return {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
      data,
    };
  }

  async findById(id: string) {
    return this.auctionModel.findById(id);
  }

  async findActive(page?: number, limit?: number) {
    const pagination = this.normalizePagination(page, limit);

    const [data, total] = await Promise.all([
      this.auctionModel
        .find({ status: 'ACTIVE' })
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.auctionModel.countDocuments({ status: 'ACTIVE' }),
    ]);

    return {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
      data,
    };
  }

  async findByCategory(category: string, page?: number, limit?: number) {
    const normalizedCategory = category?.trim();

    if (!normalizedCategory) {
      throw new BadRequestException('Missing category parameter');
    }

    const pagination = this.normalizePagination(page, limit);

    const [data, total] = await Promise.all([
      this.auctionModel
        .find({ category: normalizedCategory })
        .sort({ endTime: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.auctionModel.countDocuments({ category: normalizedCategory }),
    ]);

    return {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
      data,
    };
  }

  async findCreatedByUser(userId: string, page?: number, limit?: number) {
    await this.auctionModel.updateMany(
      {
        createdBy: userId,
        endTime: { $lte: new Date() },
        status: 'ACTIVE',
      },
      {
        $set: {
          status: 'ENDED',
        },
      },
    );

    const pagination = this.normalizePagination(page, limit);

    const [data, total] = await Promise.all([
      this.auctionModel
        .find({ createdBy: userId })
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.auctionModel.countDocuments({ createdBy: userId }),
    ]);

    return {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
      data,
    };
  }

  async findBiddedByUser(userId: string, page?: number, limit?: number) {
    const pagination = this.normalizePagination(page, limit);

    const baseBidPipeline: PipelineStage[] = [
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
    ];

    const [countSummary, bidSummary] = await Promise.all([
      this.bidModel.aggregate<{ total: number }>([
        ...baseBidPipeline,
        {
          $count: 'total',
        },
      ]),
      this.bidModel.aggregate<{
      _id: string;
      lastBidAt: Date;
      highestMyBid: number;
      lastBidAmount: number;
    }>([
      ...baseBidPipeline,
      {
        $sort: { lastBidAt: -1 },
      },
      {
        $skip: pagination.skip,
      },
      {
        $limit: pagination.limit,
      },
    ]),
    ]);

    const total = countSummary[0]?.total ?? 0;

    if (bidSummary.length === 0) {
      return {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
        biddedAuctions: [],
      };
    }

    const auctionIds = bidSummary.map((item) => item._id);

    await this.auctionModel.updateMany(
      {
        _id: { $in: auctionIds },
        endTime: { $lte: new Date() },
        status: 'ACTIVE',
      },
      {
        $set: {
          status: 'ENDED',
        },
      },
    );

    const auctions = await this.auctionModel.find({
      _id: { $in: auctionIds },
    });

    const winnerSummary = await this.bidModel.aggregate<{
      _id: string;
      winnerId: string;
    }>([
      {
        $match: {
          auctionId: { $in: auctionIds },
        },
      },
      {
        $sort: { amount: -1, createdAt: 1 },
      },
      {
        $group: {
          _id: '$auctionId',
          winnerId: { $first: '$userId' },
        },
      },
    ]);

    const auctionById = new Map(auctions.map((auction) => [String(auction._id), auction]));
    const winnerByAuctionId = new Map(
      winnerSummary.map((item) => [item._id, item.winnerId]),
    );

    const biddedAuctions = bidSummary
      .map((item) => {
        const auction = auctionById.get(item._id);

        if (!auction) {
          return null;
        }

        return {
          ...auction.toObject(),
          winnerId:
            winnerByAuctionId.get(item._id) ??
            auction.winner ??
            auction.highestBidder ??
            null,
          myBid: {
            highest: item.highestMyBid,
            lastAmount: item.lastBidAmount,
            lastBidAt: item.lastBidAt,
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
      biddedAuctions,
    };
  }
}
