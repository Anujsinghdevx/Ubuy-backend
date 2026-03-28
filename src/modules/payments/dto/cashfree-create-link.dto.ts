import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CashfreeCreateLinkDto {
  @IsString()
  auctionId: string;

  @IsString()
  @Matches(/^[0-9]{10}$/, {
    message: 'customerPhone must be a 10-digit number',
  })
  customerPhone: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkPurpose?: string;

  @IsOptional()
  @IsString()
  returnUrl?: string;

  @IsOptional()
  @IsString()
  notifyUrl?: string;

  @IsOptional()
  @IsBoolean()
  sendSms?: boolean;

  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}
