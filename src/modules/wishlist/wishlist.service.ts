import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Wishlist, WishlistDocument } from './schemas/wishlist.schema';
import { Auction, AuctionDocument } from '@/modules/auctions/schemas/auction.schema';
import { User, UserDocument } from '@/modules/users/schemas/user.schema';

@Injectable()
export class WishlistService {
  private normalizePagination(page?: number, limit?: number) {
    const normalizedPage = Math.max(1, page ?? 1);
    const normalizedLimit = Math.min(100, Math.max(1, limit ?? 20));

    return {
      page: normalizedPage,
      limit: normalizedLimit,
      skip: (normalizedPage - 1) * normalizedLimit,
    };
  }

  constructor(
    @InjectModel(Wishlist.name)
    private readonly wishlistModel: Model<WishlistDocument>,
    @InjectModel(Auction.name)
    private readonly auctionModel: Model<AuctionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  private ensureValidAuctionId(auctionId: string) {
    if (!auctionId || !Types.ObjectId.isValid(auctionId)) {
      throw new BadRequestException('Invalid auctionId');
    }
  }

  async addToWishlist(userId: string, auctionId: string) {
    this.ensureValidAuctionId(auctionId);

    const auction = await this.auctionModel.findById(auctionId).select({ _id: 1 });

    if (!auction) {
      throw new NotFoundException('Auction not found');
    }

    const existingEntry = await this.wishlistModel.findOne({ userId, auctionId });

    if (existingEntry) {
      return {
        message: 'Auction already in wishlist',
      };
    }

    await this.wishlistModel.create({ userId, auctionId });

    return {
      message: 'Auction added to wishlist successfully',
    };
  }

  async removeFromWishlist(userId: string, auctionId: string) {
    this.ensureValidAuctionId(auctionId);

    const deleted = await this.wishlistModel.findOneAndDelete({ userId, auctionId });

    if (!deleted) {
      throw new NotFoundException('Wishlist entry not found');
    }

    return {
      message: 'Auction removed from wishlist successfully',
    };
  }

  async getMyWishlist(userId: string, page?: number, limit?: number) {
    const pagination = this.normalizePagination(page, limit);

    const [wishlistItems, total] = await Promise.all([
      this.wishlistModel
        .find({ userId })
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      this.wishlistModel.countDocuments({ userId }),
    ]);

    if (wishlistItems.length === 0) {
      return {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
        wishlist: [],
      };
    }

    const auctionIds = wishlistItems.map((item) => item.auctionId);

    const auctions = await this.auctionModel
      .find({ _id: { $in: auctionIds } })
      .lean();

    const auctionById = new Map(auctions.map((auction) => [String(auction._id), auction]));

    const sellerIds = Array.from(
      new Set(
        auctions
          .map((auction) => auction.createdBy)
          .filter((sellerId): sellerId is string => typeof sellerId === 'string' && sellerId.length > 0),
      ),
    );

    const sellers = await this.userModel
      .find({ _id: { $in: sellerIds } })
      .select({ _id: 1, username: 1, email: 1 })
      .lean();

    const sellerById = new Map(sellers.map((seller) => [String(seller._id), seller]));

    const wishlist = wishlistItems
      .map((item) => {
        const auction = auctionById.get(item.auctionId);

        if (!auction) {
          return null;
        }

        const seller = sellerById.get(auction.createdBy);

        return {
          _id: item._id,
          userId: item.userId,
          auctionId: item.auctionId,
          addedAt: item.createdAt,
          auction: {
            ...auction,
            createdBy: seller
              ? {
                  _id: String(seller._id),
                  username: seller.username,
                  email: seller.email,
                }
              : {
                  _id: auction.createdBy,
                  username: null,
                  email: null,
                },
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
      wishlist,
    };
  }
}
