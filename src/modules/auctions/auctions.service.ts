import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Auction, AuctionDocument } from './schemas/auction.schema';
import { Model } from 'mongoose';
import { CreateAuctionDto } from './dto/create-auction.dto';

@Injectable()
export class AuctionsService {
  constructor(
    @InjectModel(Auction.name)
    private auctionModel: Model<AuctionDocument>,
  ) {}

  async create(createDto: CreateAuctionDto, userId: string) {
    if (new Date(createDto.endTime) <= new Date(createDto.startTime)) {
      throw new BadRequestException('End time must be after start time');
    }

    const auction = await this.auctionModel.create({
      ...createDto,
      currentPrice: createDto.startingPrice,
      createdBy: userId,
    });

    return auction;
  }

  async findAll() {
    return this.auctionModel.find().sort({ createdAt: -1 });
  }

  async findById(id: string) {
    return this.auctionModel.findById(id);
  }

  async findActive() {
    return this.auctionModel.find({ status: 'ACTIVE' });
  }
}
