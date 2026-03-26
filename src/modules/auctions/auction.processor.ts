import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { AuctionsService } from './auctions.service';
import { BidsGateway } from '@/modules/bids/bids.gateway';

type EndAuctionJobData = {
  auctionId: string;
};

@Processor('auctionQueue')
@Injectable()
export class AuctionProcessor extends WorkerHost {
  constructor(
    private readonly auctionsService: AuctionsService,
    private readonly bidsGateway: BidsGateway,
  ) {
    super();
  }

  async process(job: Job<EndAuctionJobData>) {
    if (job.name === 'endAuction') {
      const { auctionId } = job.data;

      const auction = await this.auctionsService.endAuction(auctionId);

      this.bidsGateway.server.to(auctionId).emit('auctionEnded', {
        auctionId,
        winner: auction.highestBidder,
        finalPrice: auction.currentPrice,
      });
    }
  }
}
