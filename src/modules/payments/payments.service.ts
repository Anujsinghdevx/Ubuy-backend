import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuctionsService } from '@/modules/auctions/auctions.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { BidsGateway } from '@/modules/bids/bids.gateway';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { UsersService } from '@/modules/users/users.service';
import { CashfreeCreateLinkDto } from './dto/cashfree-create-link.dto';

type CashfreeLinkResponse = {
  link_status?: string;
  customer_details?: {
    customer_email?: string;
  };
  link_id?: string;
  link_url?: string;
};

type CashfreeCreateLinkPayload = {
  link_id: string;
  link_amount: number;
  link_currency: string;
  link_purpose: string;
  customer_details: {
    customer_name: string;
    customer_phone: string;
    customer_email: string;
  };
  link_notify: {
    send_sms: boolean;
    send_email: boolean;
  };
  link_auto_reminders: boolean;
  link_meta?: {
    notify_url?: string;
    return_url?: string;
  };
  link_notes: {
    auctionId: string;
    winnerUserId: string;
  };
};

const OBJECT_ID_REGEX = /^[a-fA-F0-9]{24}$/;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly auctionsService: AuctionsService,
    private readonly notificationsService: NotificationsService,
    private readonly bidsGateway: BidsGateway,
    private readonly usersService: UsersService,
  ) {}

  private extractAuctionIdFromLinkId(linkId: string) {
    const parts = linkId.split('_');
    const candidate = parts[1];

    if (candidate && OBJECT_ID_REGEX.test(candidate)) {
      return candidate;
    }

    throw new BadRequestException('Invalid linkId format for auction payment');
  }

  private async emitPaymentSuccessNotifications(
    auctionId: string,
    providerPaymentId?: string,
  ) {
    const auction = await this.auctionsService.findById(auctionId);

    if (!auction) {
      throw new BadRequestException('Auction not found');
    }

    if (auction.winner) {
      const winnerNotification = await this.notificationsService.createNotification({
        userId: auction.winner,
        type: 'PAYMENT_SUCCESS',
        title: 'Payment successful',
        message: `Payment confirmed for auction ${String(auction._id)}.`,
        metadata: {
          auctionId: String(auction._id),
          providerPaymentId,
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
        providerPaymentId,
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
      providerPaymentId,
    });

    return auction;
  }

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

    await this.emitPaymentSuccessNotifications(
      payload.auctionId,
      payload.providerPaymentId,
    );

    return {
      message: 'Payment webhook processed successfully',
      accepted: true,
      auction,
    };
  }

  async verifyCashfreePaymentLink(linkId: string) {
    if (!linkId) {
      throw new BadRequestException('Link ID is required');
    }

    const clientId = this.configService.get<string>('CASHFREE_CLIENT_ID');
    const clientSecret = this.configService.get<string>('CASHFREE_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'Cashfree credentials are not configured',
      );
    }

    const apiVersion =
      this.configService.get<string>('CASHFREE_API_VERSION') ?? '2025-01-01';
    const baseUrl =
      this.configService.get<string>('CASHFREE_BASE_URL') ??
      'https://sandbox.cashfree.com';

    const response = await fetch(`${baseUrl}/pg/links/${linkId}`, {
      method: 'GET',
      headers: {
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
        'x-api-version': apiVersion,
        'x-request-id': crypto.randomUUID(),
        'x-idempotency-key': crypto.randomUUID(),
      },
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new BadRequestException(
        `Failed to fetch payment link status from Cashfree: ${response.status} ${responseText}`,
      );
    }

    const paymentData = (await response.json()) as CashfreeLinkResponse;

    if (paymentData.link_status !== 'PAID') {
      throw new BadRequestException('Payment not successful');
    }

    const auctionId = this.extractAuctionIdFromLinkId(linkId);
    const auction = await this.auctionsService.findById(auctionId);

    if (!auction || auction.status !== 'ENDED' || !auction.winner) {
      throw new BadRequestException('Auction not found for this payment');
    }

    const winnerUser = await this.usersService.findById(auction.winner);

    if (!winnerUser) {
      throw new BadRequestException('Winner not found');
    }

    const cashfreeEmail = paymentData.customer_details?.customer_email;

    if (
      !cashfreeEmail ||
      winnerUser.email.toLowerCase() !== cashfreeEmail.toLowerCase()
    ) {
      throw new BadRequestException(
        "Winner's email does not match Cashfree response",
      );
    }

    const { auction: paidAuction } =
      await this.auctionsService.confirmWinnerPaymentByProvider(
        auctionId,
        auction.winner,
      );

    await this.emitPaymentSuccessNotifications(auctionId, paymentData.link_id);

    return {
      message: 'Payment link status fetched successfully',
      status: paymentData.link_status,
      auction: paidAuction,
      data: paymentData,
    };
  }

  async createCashfreePaymentLink(
    actorUserId: string,
    payload: CashfreeCreateLinkDto,
  ) {
    const clientId = this.configService.get<string>('CASHFREE_CLIENT_ID');
    const clientSecret = this.configService.get<string>('CASHFREE_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'Cashfree credentials are not configured',
      );
    }

    const auction = await this.auctionsService.findById(payload.auctionId);

    if (!auction) {
      throw new BadRequestException('Auction not found');
    }

    if (auction.status !== 'ENDED') {
      throw new BadRequestException('Auction must be ended before payment link creation');
    }

    if (!auction.winner) {
      throw new BadRequestException('Auction winner not found');
    }

    const canCreateLink =
      auction.createdBy === actorUserId || auction.winner === actorUserId;

    if (!canCreateLink) {
      throw new BadRequestException(
        'Only auction creator or winner can create payment link',
      );
    }

    if (auction.paymentStatus === 'PAID') {
      throw new BadRequestException('Payment already completed for this auction');
    }

    const winnerUser = await this.usersService.findById(auction.winner);

    if (!winnerUser) {
      throw new BadRequestException('Winner user not found');
    }

    const apiVersion =
      this.configService.get<string>('CASHFREE_API_VERSION') ?? '2025-01-01';
    const baseUrl =
      this.configService.get<string>('CASHFREE_BASE_URL') ??
      'https://sandbox.cashfree.com';
    const frontendBaseUrlRaw = this.configService.get<string>('FRONTEND_BASE_URL');
    const frontendBaseUrl = frontendBaseUrlRaw?.replace(/\/+$/, '');
    const configuredReturnUrl = this.configService.get<string>('PAYMENT_RETURN_URL');
    const configuredNotifyUrl = this.configService.get<string>('PAYMENT_NOTIFY_URL');

    const linkId = `auction_${String(auction._id)}_${Date.now()}`;

    if (linkId.length > 50) {
      throw new BadRequestException('Generated link_id exceeds Cashfree length limit');
    }

    const requestBody: CashfreeCreateLinkPayload = {
      link_id: linkId,
      link_amount: Number(auction.currentPrice),
      link_currency: 'INR',
      link_purpose:
        payload.linkPurpose ??
        `Payment for auction ${String(auction._id)} (${auction.title})`,
      customer_details: {
        customer_name: winnerUser.name ?? winnerUser.username ?? winnerUser.email,
        customer_phone: payload.customerPhone,
        customer_email: winnerUser.email,
      },
      link_notify: {
        send_sms: payload.sendSms ?? true,
        send_email: payload.sendEmail ?? true,
      },
      link_auto_reminders: true,
      link_notes: {
        auctionId: String(auction._id),
        winnerUserId: auction.winner,
      },
    };

    const effectiveReturnUrl =
      payload.returnUrl ||
      configuredReturnUrl ||
      (frontendBaseUrl
        ? `${frontendBaseUrl}/payments/status?auctionId=${String(auction._id)}`
        : undefined);

    const effectiveNotifyUrl = payload.notifyUrl || configuredNotifyUrl;

    if (effectiveNotifyUrl || effectiveReturnUrl) {
      requestBody.link_meta = {
        notify_url: effectiveNotifyUrl,
        return_url: effectiveReturnUrl,
      };
    }

    const response = await fetch(`${baseUrl}/pg/links`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
        'x-api-version': apiVersion,
        'x-request-id': crypto.randomUUID(),
        'x-idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new BadRequestException(
        `Failed to create payment link on Cashfree: ${response.status} ${responseText}`,
      );
    }

    const data = (await response.json()) as CashfreeLinkResponse;

    return {
      message: 'Payment link created successfully',
      auctionId: String(auction._id),
      winner: auction.winner,
      linkId: data.link_id,
      linkUrl: data.link_url,
      status: data.link_status,
      returnUrl: effectiveReturnUrl,
      notifyUrl: effectiveNotifyUrl,
      data,
    };
  }

  async notifyPaymentForAuction(
    actorUserId: string,
    auctionId: string,
    customerPhone?: string,
  ) {
    const normalizedPhone = customerPhone?.trim() || '9999999999';

    return this.createCashfreePaymentLink(actorUserId, {
      auctionId,
      customerPhone: normalizedPhone,
    });
  }
}
