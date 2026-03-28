import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuctionsService } from '@/modules/auctions/auctions.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { BidsGateway } from '@/modules/bids/bids.gateway';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly auctionsService: AuctionsService,
    private readonly notificationsService: NotificationsService,
    private readonly bidsGateway: BidsGateway,
  ) {}

  validateWebhookSecret(secretFromHeader?: string) {
    const configuredSecret = this.configService.get<string>('PAYMENT_WEBHOOK_SECRET');

    if (!configuredSecret) {
      return;
    }

    if (!secretFromHeader || secretFromHeader !== configuredSecret) {
      throw new UnauthorizedException('Invalid webhook secret');
    }
  }

  async handleWebhook(payload: PaymentWebhookDto) {
    if (payload.status === 'FAILED') {
      return {
        message: 'Payment failure received. Auction remains unpaid.',
        accepted: true,
      };
    }

    const { auction } = await this.auctionsService.confirmWinnerPaymentByProvider(
      payload.auctionId,
      payload.winnerUserId,
    );

    if (auction.winner) {
      const winnerNotification = await this.notificationsService.createNotification({
        userId: auction.winner,
        type: 'PAYMENT_SUCCESS',
        title: 'Payment successful',
        message: `Payment confirmed for auction ${String(auction._id)}.`,
        metadata: {
          auctionId: String(auction._id),
          providerPaymentId: payload.providerPaymentId,
        },
        dedupeKey: `paymentSuccess:${String(auction._id)}:${auction.winner}`,
      });

      this.bidsGateway.server
        .to(`user:${auction.winner}`)
        .emit('notification:new', winnerNotification);
    }

    const creatorNotification = await this.notificationsService.createNotification({
      userId: auction.createdBy,
      type: 'SYSTEM',
      title: 'Winner payment received',
      message: `Winner payment is confirmed for auction ${String(auction._id)}.`,
      metadata: {
        auctionId: String(auction._id),
        winner: auction.winner,
        providerPaymentId: payload.providerPaymentId,
      },
      dedupeKey: `creatorPaymentReceived:${String(auction._id)}:${auction.createdBy}`,
    });

    this.bidsGateway.server
      .to(`user:${auction.createdBy}`)
      .emit('notification:new', creatorNotification);

    this.bidsGateway.server.to(String(auction._id)).emit('paymentConfirmed', {
      auctionId: String(auction._id),
      winner: auction.winner,
      paymentStatus: auction.paymentStatus,
      providerPaymentId: payload.providerPaymentId,
    });

    return {
      message: 'Payment webhook processed successfully',
      accepted: true,
      auction,
    };
  }
}
