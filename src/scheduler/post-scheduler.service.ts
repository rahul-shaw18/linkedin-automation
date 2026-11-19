import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { LinkedInPostService } from '../linkedin/linkedin-post.service';
import { SseEventsService } from '../events/sse-events.service';
import { PostStatus, Prisma } from '@prisma/client';

type DuePostWithAccount = Prisma.ScheduledPostGetPayload<{
  include: { account: true };
}>;

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
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    try {
      await this.publishDuePosts();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error in scheduled posts check: ${msg}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async publishDuePosts(): Promise<void> {
    const duePosts = await this.prisma.scheduledPost.findMany({
      where: {
        status: PostStatus.PENDING,
        scheduledTime: {
          lte: new Date(),
        },
      },
      include: {
        account: true,
      },
      orderBy: {
        scheduledTime: 'asc',
      },
      take: 20,
    });

    if (duePosts.length === 0) {
      return;
    }

    this.logger.log(`Found ${duePosts.length} post(s) due for publishing.`);

    for (const post of duePosts) {
      await this.processSinglePost(post);
    }
  }

  private async processSinglePost(post: DuePostWithAccount): Promise<void> {
    // Atomic status transition: protects against duplicate publishing across multiple worker instances
    const claimed = await this.prisma.scheduledPost.updateMany({
      where: {
        id: post.id,
        status: PostStatus.PENDING,
      },
      data: { status: PostStatus.PROCESSING },
    });

    if (claimed.count === 0) {
      this.logger.warn(`Post ${post.id} was already claimed by another process.`);
      return;
    }

    this.sseEventsService.emitPostEvent({
      userId: post.userId,
      type: 'POST_PROCESSING',
      post,
    });

    try {
      this.logger.log(`Publishing post ${post.id} for user ${post.userId}`);

      const accessToken = await this.authService.getValidAccessToken(post.account);
      const result = await this.linkedInPostService.publishPostToLinkedIn(
        post.account,
        post.content,
        accessToken,
      );

      const publishedPost = await this.prisma.scheduledPost.update({
        where: { id: post.id },
        data: {
          status: PostStatus.PUBLISHED,
          linkedInPostId: result.postId,
          failureReason: null,
        },
      });

      this.sseEventsService.emitPostEvent({
        userId: post.userId,
        type: 'POST_PUBLISHED',
        post: { ...publishedPost, account: post.account },
      });

      this.logger.log(`Post ${post.id} published successfully. ID: ${result.postId}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown publishing error';
      this.logger.error(`Failed to publish post ${post.id}: ${reason}`);

      const failedPost = await this.prisma.scheduledPost.update({
        where: { id: post.id },
        data: {
          status: PostStatus.FAILED,
          failureReason: reason.substring(0, 1000),
        },
      });

      this.sseEventsService.emitPostEvent({
        userId: post.userId,
        type: 'POST_FAILED',
        post: { ...failedPost, account: post.account },
      });
    }
  }
}
