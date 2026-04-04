import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CashfreeCreateLinkDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011', description: 'Auction ID' })
  @IsString()
  auctionId: string;

  @ApiProperty({ example: '9876543210', description: '10-digit customer phone number' })
  @IsString()
  @Matches(/^[0-9]{10}$/, {
    message: 'customerPhone must be a 10-digit number',
  })
  customerPhone: string;

  @ApiProperty({ example: 'Payment for vintage jacket auction', description: 'Payment purpose', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkPurpose?: string;

  @ApiProperty({ example: 'https://ubuy.app/auction/507f1f77bcf86cd799439011', description: 'Return URL after payment', required: false })
  @IsOptional()
  @IsString()
  returnUrl?: string;

  @ApiProperty({ example: 'https://ubuy.app/webhook/payment', description: 'Webhook URL for payment status', required: false })
  @IsOptional()
  @IsString()
  notifyUrl?: string;

  @ApiProperty({ example: true, description: 'Send SMS notification', required: false })
  @IsOptional()
  @IsBoolean()
  sendSms?: boolean;

  @ApiProperty({ example: true, description: 'Send email notification', required: false })
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}
