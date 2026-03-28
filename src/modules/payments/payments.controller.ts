import { Body, Controller, Headers, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('webhook')
  async paymentWebhook(
    @Body() body: PaymentWebhookDto,
    @Headers('x-webhook-secret') webhookSecret?: string,
  ) {
    this.paymentsService.validateWebhookSecret(webhookSecret);
    return this.paymentsService.handleWebhook(body);
  }
}
