import { Logger, forwardRef, Inject, Injectable } from '@nestjs/common';
import { BidsGateway } from './bids.gateway';
import { Model } from 'mongoose';
import { Bid } from './schemas/bid.schema';
import { Auction } from '@/modules/auctions/schemas/auction.schema';
import { InjectModel } from '@nestjs/mongoose';
import { RedisService } from '@/common/redis/redis.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';

@Injectable()
export class BidsService {
  private readonly logger = new Logger(BidsService.name);

  constructor(
    @InjectModel(Auction.name) private auctionModel: Model<Auction>,
    @InjectModel(Bid.name) private bidModel: Model<Bid>,
    @Inject(forwardRef(() => BidsGateway))
    private bidsGateway: BidsGateway,
    private redisService: RedisService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async placeBid(userId: string, auctionId: string, amount: number) {
    const redis = this.redisService.getClient();

    const lockKey = `lock:auction:${auctionId}`;

    const lock = await redis.set(lockKey, 'locked', 'PX', 3000, 'NX');

    if (!lock) {
      throw new Error('Another bid is being processed, try again');
    }

    try {
      const currentAuction = await this.auctionModel.findById(auctionId);

      if (!currentAuction) {
        throw new Error('Auction not found');
      }

      if (currentAuction.status !== 'ACTIVE') {
        throw new Error('Auction is not active');
      }

      if (amount <= currentAuction.currentPrice) {
        throw new Error(
          `Bid must be greater than current price (${currentAuction.currentPrice})`,
        );
      }

      const previousHighestBidder = currentAuction.highestBidder;
      const previousPrice = currentAuction.currentPrice;

      const updatedAuction = await this.auctionModel.findOneAndUpdate(
        {
          _id: auctionId,
          status: 'ACTIVE',
          currentPrice: { $lt: amount },
        },
        {
          $set: {
            currentPrice: amount,
            highestBidder: userId,
          },
        },
        { new: true },
      );

      if (!updatedAuction) {
        throw new Error('Another higher bid was already placed. Try a higher amount');
      }

      await this.bidModel.create({
        auctionId,
        userId,
        amount,
      });

      this.bidsGateway.server.to(auctionId).emit('newBid', {
        auctionId,
        amount,
        userId,
      });

      if (previousHighestBidder && previousHighestBidder !== userId) {
        const outBidPayload = {
          auctionId,
          previousAmount: previousPrice,
          newAmount: amount,
          outbidBy: userId,
        };

        this.bidsGateway.server
          .to(`user:${previousHighestBidder}`)
          .emit('outBid', outBidPayload);

        try {
          const notification = await this.notificationsService.createNotification({
            userId: previousHighestBidder,
            type: 'OUTBID',
            title: 'You were outbid',
            message: `Your bid on auction ${auctionId} was outbid by a higher amount.`,
            metadata: outBidPayload,
            dedupeKey: `outBid:${auctionId}:${previousHighestBidder}:${amount}`,
          });

          this.bidsGateway.server
            .to(`user:${previousHighestBidder}`)
            .emit('notification:new', notification);
        } catch (error) {
          this.logger.warn(
            `Failed to persist outBid notification for user ${previousHighestBidder}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }

      return updatedAuction;
    } finally {
      await redis.del(lockKey);
    }
  }
}
