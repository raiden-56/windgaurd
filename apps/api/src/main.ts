import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.startsWith('dev-only'))) {
    throw new Error('Set a strong JWT_SECRET before running in production');
  }
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  // The web app proxies /api to this server, so requests are same-origin; CORS only for direct dev access.
  app.enableCors({ origin: (process.env.WEB_ORIGIN || 'http://localhost:3100').split(','), credentials: true });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT || 4000);
  await app.listen(port);
  Logger.log(`WINDGUARD API listening on http://localhost:${port}/api`, 'Bootstrap');
}
void bootstrap();
