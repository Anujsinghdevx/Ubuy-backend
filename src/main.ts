import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { RedisIoAdapter } from './common/adapters/redis.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const redisAdapter = new RedisIoAdapter(app);
  await redisAdapter.connectToRedis();
  app.useWebSocketAdapter(redisAdapter);

  const port = Number(process.env.PORT ?? 6000);
  await app.listen(port);

  Logger.log(`Server is running on: ${await app.getUrl()}`, 'Bootstrap');
}
void bootstrap();
