import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { LinkedInAuthModule } from './auth/auth.module';
import { LinkedInPostModule } from './linkedin/linkedin-post.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { PostsModule } from './posts/posts.module';
import { HealthModule } from './health/health.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    PrismaModule,
    EventsModule,
    LinkedInAuthModule,
    LinkedInPostModule,
    SchedulerModule,
    PostsModule,
    HealthModule,
  ],
})
export class AppModule {}

