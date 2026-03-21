import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuctionsModule } from '../auctions/auctions.module';
import { BidsGateway } from './bids.gateway';
import { BidsService } from './bids.service';
import { Bid, BidSchema } from './schemas/bid.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Bid.name, schema: BidSchema }]),
    AuctionsModule,
  ],
  providers: [BidsGateway, BidsService],
  exports: [BidsService],
})
export class BidsModule {}
