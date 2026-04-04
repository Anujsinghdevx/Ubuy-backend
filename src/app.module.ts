import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '@/modules/auth/auth.module';
import { UsersModule } from '@/modules/users/users.module';
import { AuctionsModule } from '@/modules/auctions/auctions.module';
import { BidsModule } from '@/modules/bids/bids.module';
import { RedisService } from '@/common/redis/redis.service';
import { QueueModule } from '@/modules/queue/queue.module';
import { HealthModule } from '@/modules/health/health.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { UploadsModule } from '@/modules/uploads/uploads.module';
import { WishlistModule } from '@/modules/wishlist/wishlist.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
    }),
    AuthModule,
    UsersModule,
    QueueModule,
    AuctionsModule,
    BidsModule,
    NotificationsModule,
    PaymentsModule,
    UploadsModule,
    WishlistModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService, RedisService],
  exports: [RedisService],
})
export class AppModule {}
