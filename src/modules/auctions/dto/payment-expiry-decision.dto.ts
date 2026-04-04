import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const PAYMENT_EXPIRY_DECISION_ACTIONS = [
  'PUSH_NEXT',
  'KEEP_CURRENT',
] as const;

export type PaymentExpiryDecisionAction =
  (typeof PAYMENT_EXPIRY_DECISION_ACTIONS)[number];

export class PaymentExpiryDecisionDto {
  @ApiProperty({ example: 'PUSH_NEXT', description: 'Action when payment expires', enum: ['PUSH_NEXT', 'KEEP_CURRENT'] })
  @IsIn(PAYMENT_EXPIRY_DECISION_ACTIONS)
  action: PaymentExpiryDecisionAction;
}
