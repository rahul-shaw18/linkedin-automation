import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PostSchedulerService } from './post-scheduler.service';
import { LinkedInAuthModule } from '../auth/auth.module';
import { LinkedInPostModule } from '../linkedin/linkedin-post.module';

@Module({
  imports: [ScheduleModule.forRoot(), LinkedInAuthModule, LinkedInPostModule],
  providers: [PostSchedulerService],
  exports: [PostSchedulerService],
})
export class SchedulerModule {}
