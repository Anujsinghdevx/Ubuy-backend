import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { AuctionsModule } from '@/modules/auctions/auctions.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { BidsModule } from '@/modules/bids/bids.module';

@Module({
  imports: [ConfigModule, AuctionsModule, NotificationsModule, BidsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
