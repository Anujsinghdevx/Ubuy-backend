import { IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlaceAuctionBidDto {
  @ApiProperty({
    example: 5500,
    description:
      'Bid amount in currency units (must be greater than current price)',
  })
  @IsNumber()
  @Min(1)
  amount!: number;
}
