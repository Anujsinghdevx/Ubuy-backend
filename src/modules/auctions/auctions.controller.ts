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
  @Get('queue/status')
  async getQueueStatus() {
    return this.auctionsService.getQueueStatus();
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.auctionsService.findById(id);
  }
}
