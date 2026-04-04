import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';
import { Wishlist, WishlistSchema } from './schemas/wishlist.schema';
import { Auction, AuctionSchema } from '@/modules/auctions/schemas/auction.schema';
import { User, UserSchema } from '@/modules/users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Wishlist.name, schema: WishlistSchema },
      { name: Auction.name, schema: AuctionSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [WishlistController],
  providers: [WishlistService],
  exports: [WishlistService],
})
export class WishlistModule {}
