import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { AuctionsService } from './auctions.service';
import { BidsGateway } from '@/modules/bids/bids.gateway';

type EndAuctionJobData = {
  auctionId: string;
};

@Processor('auctionQueue')
@Injectable()
export class AuctionProcessor extends WorkerHost {
  private readonly logger = new Logger(AuctionProcessor.name);

  constructor(
    private readonly auctionsService: AuctionsService,
    private readonly bidsGateway: BidsGateway,
  ) {
    super();
  }

  async process(job: Job<EndAuctionJobData>) {
    if (job.name !== 'endAuction') {
      return;
    }

    const { auctionId } = job.data;
    const auction = await this.auctionsService.endAuction(auctionId);

    if (auction.notified) {
      this.logger.log(`Auction ${auctionId} already notified. Skipping emit.`);
      return;
    }

    if (!this.bidsGateway.server) {
      throw new Error('WebSocket server is not initialized');
    }

    this.bidsGateway.server.to(auctionId).emit('auctionEnded', {
      auctionId,
      winner: auction.highestBidder,
      finalPrice: auction.currentPrice,
    });

    await this.auctionsService.markAuctionNotified(auctionId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EndAuctionJobData> | undefined, error: Error) {
    if (!job) {
      this.logger.error(`Auction job failed: ${error.message}`);
      return;
    }

    this.logger.warn(
      `Auction job ${job.id} failed on attempt ${job.attemptsMade} of ${job.opts.attempts ?? 1}: ${error.message}`,
    );
  }
}
