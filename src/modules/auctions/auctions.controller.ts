import {
  BadRequestException,
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
import { PlaceAuctionBidDto } from './dto/place-auction-bid.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '@/common/decorators/current-user.decorator';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import { BidsService } from '@/modules/bids/bids.service';

@ApiTags('auctions')
@Controller('auctions')
export class AuctionsController {
  constructor(
    private auctionsService: AuctionsService,
    private bidsService: BidsService,
  ) {}

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new auction' })
  @ApiResponse({ status: 201, description: 'Auction created successfully', example: { id: '507f1f77bcf86cd799439011', title: 'Vintage Leather Jacket', status: 'scheduled' } })
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

  @ApiOperation({ summary: 'List all auctions' })
  @ApiResponse({ status: 200, description: 'All auctions retrieved', example: { data: [{ id: '507f1f77bcf86cd799439011', title: 'Vintage Jacket', currentBid: 5500, status: 'active' }], total: 42 } })
  @Get()
  async getAll() {
    return this.auctionsService.findAll();
  }

  @ApiOperation({ summary: 'List active auctions' })
  @ApiResponse({ status: 200, description: 'Active auctions only', example: { data: [{ id: '507f1f77bcf86cd799439011', title: 'Running Auction', endTime: '2026-04-12T18:00:00Z' }] } })
  @Get('active')
  async getActive() {
    return this.auctionsService.findActive();
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'List auctions where authenticated user has bids' })
  @ApiResponse({ status: 200, description: 'User bidded auctions', example: { biddedAuctions: [{ id: '507f1f77bcf86cd799439011', title: 'Jacket', winnerId: '507f1f77bcf86cd799439012', myBid: { highest: 5500, lastAmount: 5500, lastBidAt: '2026-04-04T12:00:00.000Z' } }], total: 1 } })
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

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get queue state for auction lifecycle jobs' })
  @ApiResponse({ status: 200, description: 'Queue status', example: { pending: 3, active: 1, completed: 15 } })
  @UseGuards(JwtAuthGuard)
  @Get('queue/status')
  async getQueueStatus() {
    return this.auctionsService.getQueueStatus();
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request immediate auction ending' })
  @ApiResponse({ status: 200, description: 'Auction end requested', example: { message: 'Auction end request queued', auctionId: '507f1f77bcf86cd799439011' } })
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

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel auction as owner' })
  @ApiResponse({ status: 200, description: 'Auction cancelled', example: { message: 'Auction cancelled successfully', auctionId: '507f1f77bcf86cd799439011' } })
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

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm winner payment for completed auction' })
  @ApiResponse({ status: 200, description: 'Winner payment confirmed', example: { message: 'Payment confirmed', auctionId: '507f1f77bcf86cd799439011' } })
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

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Place bid for a specific auction' })
  @ApiResponse({ status: 201, description: 'Bid placed successfully', example: { ok: true, data: { id: '507f1f77bcf86cd799439011', currentPrice: 5500, highestBidder: '507f1f77bcf86cd799439099', status: 'ACTIVE' } } })
  @ApiResponse({ status: 400, description: 'Invalid bid or auction state' })
  @UseGuards(JwtAuthGuard)
  @Post(':id/bids')
  async placeAuctionBid(
    @Param('id') auctionId: string,
    @Body() body: PlaceAuctionBidDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    try {
      const updatedAuction = await this.bidsService.placeBid(
        user.userId,
        auctionId,
        body.amount,
      );

      return { ok: true, data: updatedAuction };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to place bid';
      throw new BadRequestException(message);
    }
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Handle payment-expiry decision for an auction' })
  @ApiResponse({ status: 200, description: 'Decision processed', example: { message: 'Payment decision recorded', action: 'PUSH_NEXT' } })
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

  @ApiOperation({ summary: 'Get auction details by id' })
  @ApiResponse({ status: 200, description: 'Auction details', example: { id: '507f1f77bcf86cd799439011', title: 'Vintage Jacket', currentBid: 5500, status: 'active', endTime: '2026-04-12T18:00:00Z' } })
  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.auctionsService.findById(id);
  }
}
