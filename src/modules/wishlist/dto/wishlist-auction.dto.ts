import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class WishlistAuctionDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Auction ID to add/remove from wishlist',
  })
  @IsString()
  auctionId: string;
}
