import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class NotifyPaymentDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Auction ID',
  })
  @IsString()
  auctionId!: string;

  @ApiProperty({
    example: '9876543210',
    description: 'Optional fallback customer phone number',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{10}$/, {
    message: 'customerPhone must be a 10-digit number',
  })
  customerPhone?: string;
}
