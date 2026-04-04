import { IsString, IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlaceBidDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011', description: 'Auction ID' })
  @IsString()
  auctionId: string;

  @ApiProperty({ example: 5500, description: 'Bid amount in currency units' })
  @IsNumber()
  @Min(1)
  amount: number;
}
