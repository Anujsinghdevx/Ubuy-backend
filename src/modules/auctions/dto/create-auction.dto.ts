import {
  IsString,
  IsNumber,
  IsArray,
  IsDateString,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAuctionDto {
  @ApiProperty({ example: 'Vintage Leather Jacket', description: 'Auction title' })
  @IsString()
  title: string;

  @ApiProperty({ example: 'Authentic 1970s brown leather jacket in excellent condition', description: 'Detailed auction description' })
  @IsString()
  description: string;

  @ApiProperty({ example: ['https://cloudinary.com/.../img1.jpg', 'https://cloudinary.com/.../img2.jpg'], description: 'Array of image URLs' })
  @IsArray()
  images: string[];

  @ApiProperty({ example: 5000, description: 'Starting bid price in currency units' })
  @IsNumber()
  @Min(1)
  startingPrice: number;

  @ApiProperty({ example: '2026-04-05T10:00:00Z', description: 'ISO 8601 auction start time' })
  @IsDateString()
  startTime: string;

  @ApiProperty({ example: '2026-04-12T18:00:00Z', description: 'ISO 8601 auction end time' })
  @IsDateString()
  endTime: string;

  @ApiProperty({ example: 'fashion', description: 'Auction category' })
  @IsString()
  category: string;
}
