import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { AuctionsService } from './auctions.service';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { PaymentExpiryDecisionDto } from './dto/payment-expiry-decision.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '@/common/decorators/current-user.decorator';

@Controller('auctions')
export class AuctionsController {
  constructor(private auctionsService: AuctionsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async createAuction(
    @Body() body: CreateAuctionDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.auctionsService.create(body, user.userId);
  }

  @Get()
  async getAll() {
    return this.auctionsService.findAll();
  }

  @Get('active')
  async getActive() {
    return this.auctionsService.findActive();
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/bidded')
  async getMyBiddedAuctions(
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.auctionsService.findBiddedByUser(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('queue/status')
  async getQueueStatus() {
    return this.auctionsService.getQueueStatus();
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/end')
  async endAuctionNow(
    @Param('id') auctionId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.auctionsService.requestImmediateEnd(auctionId, user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/cancel')
  async cancelAuction(
    @Param('id') auctionId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.auctionsService.cancelAuction(auctionId, user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/payment/confirm')
  async confirmWinnerPayment(
    @Param('id') auctionId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.auctionsService.confirmWinnerPayment(auctionId, user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/payment-expiry/decision')
  async handlePaymentExpiryDecision(
    @Param('id') auctionId: string,
    @Body() body: PaymentExpiryDecisionDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.auctionsService.handlePaymentExpiryDecision(
      auctionId,
      user.userId,
      body.action,
    );
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.auctionsService.findById(id);
  }
}
