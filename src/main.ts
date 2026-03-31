import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { RedisIoAdapter } from '@/common/adapters/redis.adapter';
import { ConfigService } from '@nestjs/config';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import rateLimit from 'express-rate-limit';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const expressApp = app.getHttpAdapter().getInstance();

  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5500',
      'http://127.0.0.1:5500',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  expressApp.set('trust proxy', 1);

  const uploadRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 5,
    message: 'Too many uploads from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/uploads/images', uploadRateLimiter);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const configService = app.get(ConfigService);
  const redisAdapter = new RedisIoAdapter(app, configService);

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  const auctionQueue = app.get<Queue>(getQueueToken('auctionQueue'));

  createBullBoard({
    queues: [new BullMQAdapter(auctionQueue)],
    serverAdapter,
  });

  app.use('/admin/queues', serverAdapter.getRouter());

  try {
    await redisAdapter.connectToRedis();
    app.useWebSocketAdapter(redisAdapter);
  } catch (error) {
    Logger.warn(
      `Redis adapter unavailable. Falling back to default socket adapter. ${error instanceof Error ? error.message : ''}`,
      'Bootstrap',
    );
  }

  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port);

  Logger.log(`Server is running on: ${await app.getUrl()}`, 'Bootstrap');
  Logger.log(`BullMQ dashboard: ${await app.getUrl()}/admin/queues`, 'Bootstrap');
}
void bootstrap();
