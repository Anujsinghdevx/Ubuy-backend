import {
  Controller,
  Get,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '@/common/decorators/current-user.decorator';
import { AuctionsService } from '@/modules/auctions/auctions.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly auctionsService: AuctionsService) {}

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get authenticated user bid statistics (alias)' })
  @ApiResponse({
    status: 200,
    description: 'Bid statistics',
    example: {
      totalBids: 12,
      auctionsCreated: 4,
      auctionsWon: 2,
    },
  })
  @UseGuards(JwtAuthGuard)
  @Get('me/bid-stats')
  async getMyBidStats(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.auctionsService.getBidStatsForUser(user.userId);
  }
}
