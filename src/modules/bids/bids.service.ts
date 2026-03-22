import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { BidsGateway } from './bids.gateway';
import { Model } from 'mongoose';
import { Bid } from './schemas/bid.schema';
import { Auction } from '../auctions/schemas/auction.schema';
import { InjectModel } from '@nestjs/mongoose';
import { RedisService } from 'src/common/redis/redis.service';

@Injectable()
export class BidsService {
  constructor(
    @InjectModel(Auction.name) private auctionModel: Model<Auction>,
    @InjectModel(Bid.name) private bidModel: Model<Bid>,
    @Inject(forwardRef(() => BidsGateway))
    private bidsGateway: BidsGateway,
    private redisService: RedisService,
  ) {}

  async placeBid(userId: string, auctionId: string, amount: number) {
    const redis = this.redisService.getClient();

    const lockKey = `lock:auction:${auctionId}`;

    const lock = await redis.set(lockKey, 'locked', 'PX', 3000, 'NX');

    if (!lock) {
      throw new Error('Another bid is being processed, try again');
    }

    try {
      const updatedAuction = await this.auctionModel.findOneAndUpdate(
        {
          _id: auctionId,
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
        throw new Error('Bid too low or lost race');
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

      return updatedAuction;
    } finally {
      await redis.del(lockKey);
    }
  }
}
