import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { LinkedInPostService } from '../linkedin/linkedin-post.service';
import { SseEventsService } from '../events/sse-events.service';
import { PostStatus } from '@prisma/client';
import { TriggerExecutionResultDto } from './dto/trigger-response.dto';

@Injectable()
export class PostSchedulerService {
  private readonly logger = new Logger(PostSchedulerService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly linkedInPostService: LinkedInPostService,
    private readonly sseEventsService: SseEventsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    this.logger.debug('Cron tick: Checking for pending scheduled LinkedIn posts...');
    try {
      await this.executeScheduledPosts();
    } catch (error: any) {
      if (
        error.message?.includes('Can\'t reach database server') ||
        error.message?.includes('tenant/user') ||
        error.name === 'PrismaClientInitializationError'
      ) {
        this.logger.warn(
          'Database is currently unreachable. Skipping scheduler cycle until restored.',
        );
      } else {
        this.logger.error('Unhandled error during cron post execution:', error.stack);
      }
    }
  }

  async executeScheduledPosts(): Promise<TriggerExecutionResultDto> {
    if (this.isRunning) {
      this.logger.warn('Previous scheduler execution is still in progress. Skipping this cycle.');
      return {
        totalFound: 0,
        published: 0,
        failed: 0,
        skipped: 0,
        details: [],
        executedAt: new Date().toISOString(),
      };
    }

    this.isRunning = true;
    const now = new Date();

    const summary: TriggerExecutionResultDto = {
      totalFound: 0,
      published: 0,
      failed: 0,
      skipped: 0,
      details: [],
      executedAt: now.toISOString(),
    };

    try {
      const pendingPosts = await this.prisma.scheduledPost.findMany({
        where: {
          status: PostStatus.PENDING,
          scheduledTime: {
            lte: now,
          },
        },
        include: {
          account: true,
        },
        orderBy: {
          scheduledTime: 'asc',
        },
        take: 50,
      });

      summary.totalFound = pendingPosts.length;

      if (pendingPosts.length === 0) {
        return summary;
      }

      this.logger.log(`Found ${pendingPosts.length} post(s) due for publishing.`);

      const CONCURRENCY_LIMIT = 5;
      for (let i = 0; i < pendingPosts.length; i += CONCURRENCY_LIMIT) {
        const chunk = pendingPosts.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.allSettled(chunk.map((post) => this.processSinglePost(post, summary)));
      }
    } finally {
      this.isRunning = false;
    }

    return summary;
  }

  private async processSinglePost(
    post: any,
    summary: TriggerExecutionResultDto,
  ): Promise<void> {
    const lockResult = await this.prisma.scheduledPost.updateMany({
      where: {
        id: post.id,
        status: PostStatus.PENDING,
      },
      data: {
        status: PostStatus.PROCESSING,
      },
    });

    if (lockResult.count === 0) {
      this.logger.warn(`Post ${post.id} was already claimed by another worker. Skipping.`);
      summary.skipped++;
      return;
    }

    this.sseEventsService?.emitPostEvent({
      userId: post.userId,
      type: 'POST_PROCESSING',
      post,
    });

    try {
      this.logger.log(
        `Processing post id=${post.id} for user=${post.userId}, account=${post.accountId}`,
      );

      const validAccessToken = await this.authService.getValidAccessToken(post.account);

      const publishResult = await this.linkedInPostService.publishPostToLinkedIn(
        post.account,
        post.content,
        validAccessToken,
        post.targetUrn,
      );

      const publishedPost = await this.prisma.scheduledPost.update({
        where: { id: post.id },
        data: {
          status: PostStatus.PUBLISHED,
          linkedInPostId: publishResult.postId,
          failureReason: null,
        },
      });

      this.logger.log(
        `Post ${post.id} successfully published. LinkedIn Post ID: ${publishResult.postId}`,
      );

      this.sseEventsService?.emitPostEvent({
        userId: post.userId,
        type: 'POST_PUBLISHED',
        post: publishedPost,
      });

      summary.published++;
      summary.details.push({
        id: post.id,
        status: PostStatus.PUBLISHED,
        postId: publishResult.postId,
      });
    } catch (error) {
      const failureReason = error.message || 'Unknown publishing error occurred';
      this.logger.error(`Failed to publish post ${post.id}: ${failureReason}`, error.stack);

      const failedPost = await this.prisma.scheduledPost.update({
        where: { id: post.id },
        data: {
          status: PostStatus.FAILED,
          failureReason: failureReason.substring(0, 1000),
        },
      });

      this.sseEventsService?.emitPostEvent({
        userId: post.userId,
        type: 'POST_FAILED',
        post: failedPost,
      });

      summary.failed++;
      summary.details.push({
        id: post.id,
        status: PostStatus.FAILED,
        reason: failureReason,
      });
    }
  }
}

