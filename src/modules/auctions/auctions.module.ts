import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { AuctionsService } from './auctions.service';
import { AuctionsController } from './auctions.controller';
import { Auction, AuctionSchema } from './schemas/auction.schema';
import { AuctionProcessor } from './auction.processor';
import { BidsModule } from '@/modules/bids/bids.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { Bid, BidSchema } from '@/modules/bids/schemas/bid.schema';
import { User, UserSchema } from '@/modules/users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Auction.name, schema: AuctionSchema },
      { name: Bid.name, schema: BidSchema },
      { name: User.name, schema: UserSchema },
    ]),
    BullModule.registerQueue({
      name: 'auctionQueue',
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    }),
    BidsModule,
    NotificationsModule,
  ],
  controllers: [AuctionsController],
  providers: [AuctionsService, AuctionProcessor],
  exports: [AuctionsService],
})
export class AuctionsModule {}
