import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BidsGateway } from './bids.gateway';
import { BidsService } from './bids.service';
import { Bid, BidSchema } from './schemas/bid.schema.js';
import { Auction, AuctionSchema } from '../auctions/schemas/auction.schema';
import { RedisService } from 'src/common/redis/redis.service';
import { AuthModule } from '../auth/auth.module';
import { WsJwtGuard } from 'src/common/guards/ws-jwt.guard';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Bid.name, schema: BidSchema },
      { name: Auction.name, schema: AuctionSchema },
    ]),
  ],
  providers: [BidsGateway, BidsService, RedisService, WsJwtGuard],
  exports: [BidsService, BidsGateway],
})
export class BidsModule {}
