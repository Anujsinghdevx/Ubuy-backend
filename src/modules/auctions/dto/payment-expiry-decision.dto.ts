import { IsIn } from 'class-validator';

export const PAYMENT_EXPIRY_DECISION_ACTIONS = [
  'PUSH_NEXT',
  'KEEP_CURRENT',
] as const;

export type PaymentExpiryDecisionAction =
  (typeof PAYMENT_EXPIRY_DECISION_ACTIONS)[number];

export class PaymentExpiryDecisionDto {
  @IsIn(PAYMENT_EXPIRY_DECISION_ACTIONS)
  action: PaymentExpiryDecisionAction;
}
