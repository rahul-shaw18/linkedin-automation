import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { LinkedInPostService } from '../linkedin/linkedin-post.service';
import { SseEventsService } from '../events/sse-events.service';
import { PostStatus } from '@prisma/client';

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
    } catch (error: any) {
      this.logger.error(`Error in scheduled posts check: ${error.message}`);
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
    });

    if (duePosts.length === 0) {
      return;
    }

    this.logger.log(`Found ${duePosts.length} post(s) due for publishing.`);

    for (const post of duePosts) {
      await this.processSinglePost(post);
    }
  }

  private async processSinglePost(post: any): Promise<void> {
    await this.prisma.scheduledPost.update({
      where: { id: post.id },
      data: { status: PostStatus.PROCESSING },
    });

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
        post.targetUrn,
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
        post: publishedPost,
      });

      this.logger.log(`Post ${post.id} published successfully. ID: ${result.postId}`);
    } catch (error: any) {
      const reason = error.message || 'Unknown publishing error';
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
        post: failedPost,
      });
    }
  }
}
