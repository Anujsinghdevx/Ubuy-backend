import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { AuctionsService } from './auctions.service';
import { AuctionsController } from './auctions.controller';
import { Auction, AuctionSchema } from './schemas/auction.schema';
import { AuctionProcessor } from './auction.processor';
import { BidsModule } from '@/modules/bids/bids.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Auction.name, schema: AuctionSchema }]),
    BullModule.registerQueue({
      name: 'auctionQueue',
    }),
    BidsModule,
  ],
  controllers: [AuctionsController],
  providers: [AuctionsService, AuctionProcessor],
  exports: [AuctionsService],
})
export class AuctionsModule {}
