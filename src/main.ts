import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { getApps, initializeApp, cert } from 'firebase-admin/app'; // Modern, modular v14 helpers
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);

  // ── FIREBASE ADMIN PRODUCTION INITIALIZATION ──
  if (getApps().length === 0) {
    const credPath = configService.get<string>('FIREBASE_CREDENTIALS_PATH');

    if (!credPath) {
      logger.error('CRITICAL: FIREBASE_CREDENTIALS_PATH environment variable is missing.');
    } else {
      try {
        // Safe, cross-platform path resolution matching your active execution directory
        const resolvedPath = path.resolve(process.cwd(), credPath);

        initializeApp({
          credential: cert(resolvedPath), // Native type-safe v14 initialization signature
        });

        logger.log('🔥 Firebase Admin initialized successfully via Explicit Cert configuration');
      } catch (error: any) {
        logger.error(`Failed to initialize Firebase Admin: ${error.message}`, error.stack);
      }
    }
  }

  // 1. Global Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 2. Swagger Setup
  const config = new DocumentBuilder()
    .setTitle('HRMS API')
    .setDescription('The internal API for the HRMS Mobile Application')
    .setVersion('1.0')
    .addTag('Alerts')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('PORT', 3000);

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });

  await app.listen(port);
  logger.log(`Application successfully listening on port: ${port}`);
}
bootstrap();