import {
  Body,
  Controller,
  Delete,
  Get,
  Query,
  UnauthorizedException,
  UseGuards,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '@/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { WishlistService } from './wishlist.service';
import { WishlistAuctionDto } from './dto/wishlist-auction.dto';

@ApiTags('wishlist')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wishlist')
export class WishlistController {
  constructor(private readonly wishlistService: WishlistService) {}

  @ApiOperation({ summary: 'Add auction to wishlist' })
  @ApiResponse({
    status: 201,
    description: 'Wishlist entry created',
    example: { message: 'Auction added to wishlist successfully' },
  })
  @Post()
  async addToWishlist(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() body: WishlistAuctionDto,
  ) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.wishlistService.addToWishlist(user.userId, body.auctionId);
  }

  @ApiOperation({ summary: 'Get authenticated user wishlist' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Wishlist fetched successfully',
    example: { page: 1, limit: 20, total: 0, totalPages: 0, wishlist: [] },
  })
  @Get()
  async getMyWishlist(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    const pageNumber = page ? Number(page) : undefined;
    const limitNumber = limit ? Number(limit) : undefined;

    return this.wishlistService.getMyWishlist(
      user.userId,
      Number.isFinite(pageNumber) ? pageNumber : undefined,
      Number.isFinite(limitNumber) ? limitNumber : undefined,
    );
  }

  @ApiOperation({ summary: 'Remove auction from wishlist' })
  @ApiResponse({
    status: 200,
    description: 'Wishlist entry removed',
    example: { message: 'Auction removed from wishlist successfully' },
  })
  @Delete()
  async removeFromWishlist(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() body: WishlistAuctionDto,
  ) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.wishlistService.removeFromWishlist(user.userId, body.auctionId);
  }
}
