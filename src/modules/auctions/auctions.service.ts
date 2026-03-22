import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Auction, AuctionDocument } from './schemas/auction.schema';
import { Model } from 'mongoose';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class AuctionsService {
  private readonly logger = new Logger(AuctionsService.name);

  constructor(
    @InjectModel(Auction.name)
    private auctionModel: Model<AuctionDocument>,
    @InjectQueue('auctionQueue') private auctionQueue: Queue,
  ) {}

  async create(createDto: CreateAuctionDto, userId: string) {
    if (new Date(createDto.endTime) <= new Date(createDto.startTime)) {
      throw new BadRequestException('End time must be after start time');
    }

    const auction = await this.auctionModel.create({
      ...createDto,
      currentPrice: createDto.startingPrice,
      createdBy: userId,
      status: 'ACTIVE',
    });

    const delay = Math.max(0, new Date(auction.endTime).getTime() - Date.now());

    try {
      await this.auctionQueue.add(
        'endAuction',
        { auctionId: String(auction._id) },
        { delay },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue endAuction job for auction ${String(auction._id)}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    return auction;
  }

  async endAuction(auctionId: string) {
    const auction = await this.auctionModel.findById(auctionId);

    if (!auction) throw new Error('Auction not found');

    if (auction.status === 'ENDED') return auction;

    auction.status = 'ENDED';

    await auction.save();

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
