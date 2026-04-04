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
import { ApiBearerAuth, ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Cashfree payment link' })
  @ApiResponse({ status: 200, description: 'Payment link created', example: { linkId: 'link_abc123def456', shortUrl: 'https://cashfree.com/pay/abc123' } })
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

  @ApiOperation({ summary: 'Receive payment webhook callback' })
  @ApiResponse({ status: 200, description: 'Webhook received and processed', example: { success: true, message: 'Webhook processed' } })
  @Post('webhook')
  async paymentWebhook(
    @Body() body: PaymentWebhookDto,
    @Headers('x-webhook-secret') webhookSecret?: string,
  ) {
    this.paymentsService.validateWebhookSecret(webhookSecret);
    return this.paymentsService.handleWebhook(body);
  }

  @ApiOperation({ summary: 'Verify Cashfree payment link status' })
  @ApiResponse({ status: 200, description: 'Payment link status', example: { linkId: 'link_abc123def456', status: 'PAID', amount: 5500 } })
  @Get('cashfree/verify')
  async verifyCashfreePayment(@Query() query: CashfreeVerifyQueryDto) {
    return this.paymentsService.verifyCashfreePaymentLink(query.linkId);
  }
}
