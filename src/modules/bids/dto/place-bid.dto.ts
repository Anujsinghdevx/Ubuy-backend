import { IsString, IsNumber, Min } from 'class-validator';

export class PlaceBidDto {
  @IsString()
  auctionId: string;

  @IsNumber()
  @Min(1)
  amount: number;
}
