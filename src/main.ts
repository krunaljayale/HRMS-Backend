import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { initializeApp, getApps, cert } from 'firebase-admin/app';

async function bootstrap() {

  if (!getApps().length) {
    const serviceAccount = require('../src/notification/fcm-config/firebase-adminsdk.json');

    initializeApp({
      credential: cert(serviceAccount),
    });
    console.log('🔥 Firebase Admin successfully initialized');
  }
  const app = await NestFactory.create(AppModule);

  // 1. Global Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));

  // 2. Swagger Setup
  const config = new DocumentBuilder()
    .setTitle('HRMS API')
    .setDescription('The internal API for the HRMS Mobile Application')
    .setVersion('1.0')
    .addTag('Alerts') // We will use this tag in the controller
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const configService = app.get(ConfigService);

  const port = configService.get<number>('PORT', 3000);

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });


  await app.listen(port);
}
bootstrap();