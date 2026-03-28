import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { CashfreeVerifyQueryDto } from './dto/cashfree-verify-query.dto';
import { CashfreeCreateLinkDto } from './dto/cashfree-create-link.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '@/common/decorators/current-user.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('cashfree/link')
  async createCashfreeLink(
    @Body() body: CashfreeCreateLinkDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.paymentsService.createCashfreePaymentLink(user.userId, body);
  }

  @Post('webhook')
  async paymentWebhook(
    @Body() body: PaymentWebhookDto,
    @Headers('x-webhook-secret') webhookSecret?: string,
  ) {
    this.paymentsService.validateWebhookSecret(webhookSecret);
    return this.paymentsService.handleWebhook(body);
  }

  @Get('cashfree/verify')
  async verifyCashfreePayment(@Query() query: CashfreeVerifyQueryDto) {
    return this.paymentsService.verifyCashfreePaymentLink(query.linkId);
  }
}
