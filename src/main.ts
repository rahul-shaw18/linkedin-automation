import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger, ClassSerializerInterceptor } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3000;
  const nodeEnv = configService.get<string>('NODE_ENV') || 'development';
  const frontendUrl = configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';

  await app.register(fastifyCookie);

  app.enableCors({
    origin: [frontendUrl, 'http://localhost:4200', 'http://127.0.0.1:4200'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  });

  app.enableShutdownHooks();

  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new ClassSerializerInterceptor(app.get(Reflector)),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('LinkedIn Post Scheduler & Automation Engine')
    .setDescription(
      'REST API powered by Fastify and Prisma ORM for managing LinkedIn OAuth 2.0 tokens, composing posts, and executing scheduled publishing.',
    )
    .setVersion('1.0.0')
    .addTag('LinkedIn Auth', 'OAuth 2.0 flow, token exchange, and account status')
    .addTag('LinkedIn Scheduled Posts', 'Post scheduling, user post listings, cancellation, and retries')
    .addTag('System & Health', 'Uptime monitoring and system health checks')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'LinkedIn Scheduler API Docs',
  });

  await app.listen(port, '0.0.0.0');

  logger.log(`========================================================`);
  logger.log(`LinkedIn Scheduler Engine (Fastify) is running on: http://localhost:${port}`);
  logger.log(`Swagger API Documentation: http://localhost:${port}/api/docs`);
  logger.log(`Health Check Endpoint:     http://localhost:${port}/health`);
  logger.log(`Mode:                      ${nodeEnv}`);
  logger.log(`========================================================`);
}

bootstrap();
