import { IsIn, IsOptional, IsString } from 'class-validator';

export class PaymentWebhookDto {
  @IsString()
  auctionId: string;

  @IsIn(['SUCCESS', 'FAILED'])
  status: 'SUCCESS' | 'FAILED';

  @IsOptional()
  @IsString()
  winnerUserId?: string;

  @IsOptional()
  @IsString()
  providerPaymentId?: string;
}
