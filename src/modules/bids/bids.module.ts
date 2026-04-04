import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BidsGateway } from './bids.gateway';
import { BidsService } from './bids.service';
import { Bid, BidSchema } from '@/modules/bids/schemas/bid.schema';
import {
  Auction,
  AuctionSchema,
} from '@/modules/auctions/schemas/auction.schema';
import { RedisService } from '@/common/redis/redis.service';
import { AuthModule } from '@/modules/auth/auth.module';
import { WsJwtGuard } from '@/common/guards/ws-jwt.guard';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { User, UserSchema } from '@/modules/users/schemas/user.schema';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    MongooseModule.forFeature([
      { name: Bid.name, schema: BidSchema },
      { name: Auction.name, schema: AuctionSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [BidsGateway, BidsService, RedisService, WsJwtGuard],
  exports: [BidsService, BidsGateway],
})
export class BidsModule {}
