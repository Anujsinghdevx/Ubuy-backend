import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { RedisIoAdapter } from '@/common/adapters/redis.adapter';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const configService = app.get(ConfigService);
  const redisAdapter = new RedisIoAdapter(app, configService);
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
  await app.listen(port);

  Logger.log(`Server is running on: ${await app.getUrl()}`, 'Bootstrap');
}
void bootstrap();
