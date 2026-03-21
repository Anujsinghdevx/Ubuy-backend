import {
  IsString,
  IsNumber,
  IsArray,
  IsDateString,
  Min,
} from 'class-validator';

export class CreateAuctionDto {
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsArray()
  images: string[];

  @IsNumber()
  @Min(1)
  startingPrice: number;

  @IsDateString()
  startTime: string;

  @IsDateString()
  endTime: string;

  @IsString()
  category: string;
}
