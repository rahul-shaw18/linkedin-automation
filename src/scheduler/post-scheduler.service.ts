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

  /**
   * Module C.1: Cron Task Scheduler
   * Runs automatically every minute to publish due scheduled posts.
   */
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
          'Database is currently unreachable (Supabase project may be paused). Skipping scheduler cycle until restored.',
        );
      } else {
        this.logger.error('Unhandled error during cron post execution:', error.stack);
      }
    }
  }

  /**
   * Core execution pipeline:
   * 1. Query pending posts where scheduledTime <= NOW()
   * 2. Atomically transition to PROCESSING to prevent duplicate execution
   * 3. Fetch/refresh valid LinkedIn access token
   * 4. Publish post via LinkedIn API
   * 5. Record PUBLISHED with linkedInPostId or FAILED with failureReason
   */
  async executeScheduledPosts(): Promise<TriggerExecutionResultDto> {
    // Basic in-memory mutex to prevent overlapping cron runs on a single node
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
      // Step 1: Query ScheduledPost table where status == PENDING and scheduledTime <= NOW()
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
        take: 50, // Batch size cap to prevent timeout
      });

      summary.totalFound = pendingPosts.length;

      if (pendingPosts.length === 0) {
        return summary;
      }

      this.logger.log(`Found ${pendingPosts.length} post(s) due for publishing.`);

      // Process posts in bounded parallel chunks (concurrency: 5) to maximize throughput without overloading DB connections
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

  /**
   * Processes a single scheduled post through atomic locking, validation, publishing, and SSE notification.
   */
  private async processSinglePost(
    post: any,
    summary: TriggerExecutionResultDto,
  ): Promise<void> {
    // Step 2: Atomic state transition to PROCESSING
    // Using updateMany ensures that if another replica/cron fired concurrently,
    // only the worker that successfully matches status: PENDING will process it.
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

      // Step 3: Obtain a valid access token (uses pre-fetched post.account to avoid N+1 queries)
      const validAccessToken = await this.authService.getValidAccessToken(post.account);

      // Step 3 (cont): Attempt to publish to LinkedIn
      const publishResult = await this.linkedInPostService.publishPostToLinkedIn(
        post.account,
        post.content,
        validAccessToken,
        post.targetUrn,
      );

      // Step 4: If successful, set status = PUBLISHED and store linkedInPostId
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

      // Step 4 (cont): If failed, set status = FAILED and save error log in failureReason
      const failedPost = await this.prisma.scheduledPost.update({
        where: { id: post.id },
        data: {
          status: PostStatus.FAILED,
          failureReason: failureReason.substring(0, 1000), // Protect against excessive error string length
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

