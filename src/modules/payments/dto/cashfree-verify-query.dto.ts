import { IsString } from 'class-validator';

export class CashfreeVerifyQueryDto {
  @IsString()
  linkId: string;
}
