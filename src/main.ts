import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger, ClassSerializerInterceptor } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCompress from '@fastify/compress';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // FastifyAdapter tuned for maximum throughput, low memory footprint, and proxy compliance
  const adapter = new FastifyAdapter({
    trustProxy: true,
    bodyLimit: 1048576, // 1MB payload limit to prevent buffer bloating
    keepAliveTimeout: 65000, // Aligned with Render and cloud reverse proxies
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3000;
  const nodeEnv = configService.get<string>('NODE_ENV') || 'development';
  const frontendUrl = configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';

  // Enable HTTP response compression (gzip / deflate) for payloads > 1KB
  await app.register(fastifyCompress, {
    encodings: ['gzip', 'deflate'],
    threshold: 1024,
  });

  // Enable Fastify cookie plugin for reading HttpOnly session cookies
  await app.register(fastifyCookie);

  // Enable CORS with credentials for frontend applications
  app.enableCors({
    origin: [frontendUrl, 'http://localhost:4200', 'http://127.0.0.1:4200'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Cron-Secret', 'Cookie'],
  });

  // Enable graceful shutdown lifecycle hooks (rule: devops-graceful-shutdown)
  app.enableShutdownHooks();

  // Global request interceptors: structured logging & DTO serialization (rules: api-use-interceptors, api-use-dto-serialization)
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new ClassSerializerInterceptor(app.get(Reflector)),
  );

  // Global exception filter for unified error response & explicit logging
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global validation pipe with fail-fast optimization
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true, // Fail-fast on first validation error to reduce CPU cycles
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Setup Swagger OpenAPI documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('LinkedIn Post Scheduler & Automation Engine')
    .setDescription(
      'Production-ready NestJS REST API powered by Fastify, integrated with Supabase (PostgreSQL) and Prisma ORM for managing LinkedIn OAuth 2.0 tokens, scheduling posts, and executing automated publishing via lightweight cron tasks.',
    )
    .setVersion('1.0.0')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-Cron-Secret',
        in: 'header',
        description: 'Secret key for authenticating scheduler heartbeat/webhook triggers',
      },
      'X-Cron-Secret',
    )
    .addTag('LinkedIn Auth', 'OAuth 2.0 flow, token exchange, and account status')
    .addTag('LinkedIn Scheduled Posts', 'Post scheduling, user post listings, cancellation, and retries')
    .addTag('Scheduler & Triggers', 'Cron task automation and manual heartbeat triggers for Render')
    .addTag('System & Health', 'Uptime monitoring and system health checks')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'LinkedIn Scheduler API Docs',
  });

  // Listen on 0.0.0.0 for container and Render environment compatibility
  await app.listen(port, '0.0.0.0');

  logger.log(`========================================================`);
  logger.log(`⚡ LinkedIn Scheduler Engine (Fastify) is running on: http://localhost:${port}`);
  logger.log(`📚 Swagger API Documentation: http://localhost:${port}/api/docs`);
  logger.log(`🩺 Health Check Endpoint:     http://localhost:${port}/health`);
  logger.log(`⏱️ Mode:                      ${nodeEnv}`);
  logger.log(`========================================================`);
}

bootstrap();

