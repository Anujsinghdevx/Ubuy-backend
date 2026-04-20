import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { RedisIoAdapter } from '@/common/adapters/redis.adapter';
import { ConfigService } from '@nestjs/config';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import rateLimit from 'express-rate-limit';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpObservabilityMiddleware } from '@/common/middleware/http-observability.middleware';
import { ObservabilityMetricsService } from '@/common/observability/observability-metrics.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const expressApp = app.getHttpAdapter().getInstance();
  const isProduction = process.env.NODE_ENV === 'production';
  const enableAdminTools = process.env.ENABLE_ADMIN_TOOLS === 'true';

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

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

  const observabilityMetricsService = app.get(ObservabilityMetricsService);
  const httpObservabilityMiddleware = new HttpObservabilityMiddleware(
    observabilityMetricsService,
  );
  app.use(httpObservabilityMiddleware.use.bind(httpObservabilityMiddleware));

  const uploadRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 5,
    message: 'Too many uploads from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  });

  const authLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many login attempts. Please try again later.',
  });

  const authSignupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many signup attempts. Please try again later.',
  });

  const authRecoveryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many recovery attempts. Please try again later.',
  });

  const authLookupLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many account lookup requests. Please try again later.',
  });

  app.use('/uploads/images', uploadRateLimiter);

  app.use('/v1/auth/login', authLoginLimiter);
  app.use('/v1/auth/signup', authSignupLimiter);
  app.use('/v1/auth/google', authLoginLimiter);
  app.use('/v1/auth/forgot-password', authRecoveryLimiter);
  app.use('/v1/auth/reset-password', authRecoveryLimiter);
  app.use('/v1/auth/resend-code', authRecoveryLimiter);
  app.use('/v1/auth/verify-email', authRecoveryLimiter);
  app.use('/v1/auth/reset-code', authRecoveryLimiter);
  app.use('/v1/auth/verify-code', authRecoveryLimiter);
  app.use('/v1/auth/check-username-unique', authLookupLimiter);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (!isProduction || enableAdminTools) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Ubuy Backend API')
      .setDescription('HTTP API documentation for Ubuy backend')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, swaggerDocument, {
      jsonDocumentUrl: 'docs-json',
    });
  }

  const configService = app.get(ConfigService);
  const redisAdapter = new RedisIoAdapter(app, configService);

  if (!isProduction || enableAdminTools) {
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');

    const auctionQueue = app.get<Queue>(getQueueToken('auctionQueue'));

    createBullBoard({
      queues: [new BullMQAdapter(auctionQueue)],
      serverAdapter,
    });

    app.use('/admin/queues', serverAdapter.getRouter());
  }

  try {
    await redisAdapter.connectToRedis();
    app.useWebSocketAdapter(redisAdapter);
  } catch (error) {
    Logger.warn(
      `Redis adapter unavailable. Falling back to default socket adapter. ${error instanceof Error ? error.message : ''}`,
      'Bootstrap',
    );
  }

  const port = Number(process.env.PORT ?? 6000);
  await app.listen(port, '0.0.0.0');

  Logger.log(`Server is running on: ${await app.getUrl()}`, 'Bootstrap');
  if (!isProduction || enableAdminTools) {
    Logger.log(
      `BullMQ dashboard: ${await app.getUrl()}/admin/queues`,
      'Bootstrap',
    );
  }
}
void bootstrap();
