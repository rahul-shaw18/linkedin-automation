import {
  Controller,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiHeader,
} from '@nestjs/swagger';
import { PostSchedulerService } from './post-scheduler.service';
import { CronSecretGuard } from './guards/cron-secret.guard';
import { TriggerExecutionResultDto } from './dto/trigger-response.dto';

@ApiTags('Scheduler & Triggers')
@Controller('api')
export class TriggerController {
  private readonly logger = new Logger(TriggerController.name);

  constructor(private readonly schedulerService: PostSchedulerService) {}

  @Post('trigger-posts')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CronSecretGuard)
  @ApiSecurity('X-Cron-Secret')
  @ApiHeader({
    name: 'X-Cron-Secret',
    description: 'Secret authentication key matching CRON_SECRET_KEY in server environment',
    required: true,
  })
  @ApiOperation({
    summary: 'Manually trigger scheduled post execution (External Webhook)',
    description:
      'Triggers the cron processing cycle on demand. Useful for external cron pingers (e.g. cron-job.org, UptimeRobot) to keep Render Web Services active and guarantee post publishing on free/serverless tiers.',
  })
  @ApiResponse({
    status: 200,
    description: 'Summary of scheduled post execution cycle',
    type: TriggerExecutionResultDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Missing or invalid X-Cron-Secret header',
  })
  async triggerScheduledPosts(): Promise<TriggerExecutionResultDto> {
    this.logger.log('Manual webhook trigger received for scheduled posts execution.');
    return this.schedulerService.executeScheduledPosts();
  }
}

