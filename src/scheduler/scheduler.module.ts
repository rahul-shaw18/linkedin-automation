import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PostSchedulerService } from './post-scheduler.service';
import { TriggerController } from './trigger.controller';
import { LinkedInAuthModule } from '../auth/auth.module';
import { LinkedInPostModule } from '../linkedin/linkedin-post.module';
import { CronSecretGuard } from './guards/cron-secret.guard';

@Module({
  imports: [ScheduleModule.forRoot(), LinkedInAuthModule, LinkedInPostModule],
  controllers: [TriggerController],
  providers: [PostSchedulerService, CronSecretGuard],
  exports: [PostSchedulerService],
})
export class SchedulerModule {}

