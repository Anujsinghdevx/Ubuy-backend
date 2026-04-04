import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PaymentWebhookDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011', description: 'Auction ID' })
  @IsString()
  auctionId: string;

  @ApiProperty({ example: 'SUCCESS', description: 'Payment status', enum: ['SUCCESS', 'FAILED'] })
  @IsIn(['SUCCESS', 'FAILED'])
  status: 'SUCCESS' | 'FAILED';

  @ApiProperty({ example: '507f1f77bcf86cd799439012', description: 'Winner user ID', required: false })
  @IsOptional()
  @IsString()
  winnerUserId?: string;

  @ApiProperty({ example: 'txn_1234567890', description: 'Provider payment ID', required: false })
  @IsOptional()
  @IsString()
  providerPaymentId?: string;
}
