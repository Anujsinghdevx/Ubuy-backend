import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CashfreeVerifyQueryDto {
  @ApiProperty({ example: 'link_abc123def456', description: 'Cashfree payment link ID' })
  @IsString()
  linkId: string;
}
