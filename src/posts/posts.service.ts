import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { LinkedInPostService } from '../linkedin/linkedin-post.service';
import { SseEventsService } from '../events/sse-events.service';
import { CreateScheduledPostDto } from './dto/create-scheduled-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostStatus, AccountStatus, Prisma } from '@prisma/client';

export const postWithAccountSelect = {
  id: true,
  userId: true,
  accountId: true,
  content: true,
  scheduledTime: true,
  status: true,
  linkedInPostId: true,
  failureReason: true,
  createdAt: true,
  updatedAt: true,
  account: {
    select: {
      id: true,
      linkedInId: true,
      status: true,
      name: true,
      pictureUrl: true,
    },
  },
} as const;

export type PostWithAccount = Prisma.ScheduledPostGetPayload<{
  select: typeof postWithAccountSelect;
}>;

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly linkedInPostService: LinkedInPostService,
    private readonly sseEventsService: SseEventsService,
  ) {}

  async createScheduledPost(dto: CreateScheduledPostDto): Promise<PostWithAccount> {
    const scheduledDate = new Date(dto.scheduledTime);

    if (isNaN(scheduledDate.getTime())) {
      throw new BadRequestException('Invalid scheduledTime timestamp provided.');
    }

    // Allow scheduling at current time or future; reject times more than 5 minutes in the past
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    if (scheduledDate.getTime() < fiveMinutesAgo) {
      throw new BadRequestException('Cannot schedule a post in the past.');
    }

    const account = await this.prisma.linkedInAccount.findUnique({
      where: { id: dto.accountId },
      select: { id: true, userId: true, linkedInId: true, name: true, status: true },
    });

    if (!account) {
      throw new NotFoundException(`LinkedIn account with ID ${dto.accountId} does not exist.`);
    }

    if (account.userId !== dto.userId && account.linkedInId !== dto.userId) {
      throw new BadRequestException(
        `LinkedIn account ${dto.accountId} does not belong to user ${dto.userId}.`,
      );
    }

    if (account.status === AccountStatus.DISCONNECTED) {
      throw new BadRequestException(
        'Cannot schedule a post for a disconnected LinkedIn account. Please reconnect.',
      );
    }

    const newPost = await this.prisma.scheduledPost.create({
      data: {
        userId: account.userId,
        accountId: dto.accountId,
        content: dto.content,
        scheduledTime: scheduledDate,
        status: PostStatus.PENDING,
      },
      select: postWithAccountSelect,
    });

    this.logger.log(
      `Scheduled new post id=${newPost.id} for user=${newPost.userId} at ${newPost.scheduledTime.toISOString()}`,
    );

    return newPost;
  }

  async getUserPosts(userId: string): Promise<PostWithAccount[]> {
    return this.prisma.scheduledPost.findMany({
      where: {
        OR: [
          { userId },
          { account: { userId } },
          { account: { linkedInId: userId } },
        ],
      },
      orderBy: { scheduledTime: 'desc' },
      select: postWithAccountSelect,
    });
  }

  async getPostById(postId: string): Promise<PostWithAccount> {
    const post = await this.prisma.scheduledPost.findUnique({
      where: { id: postId },
      select: postWithAccountSelect,
    });

    if (!post) {
      throw new NotFoundException(`Scheduled post ${postId} not found.`);
    }

    return post;
  }

  async deletePost(postId: string): Promise<{ success: boolean; message: string }> {
    const post = await this.prisma.scheduledPost.findUnique({
      where: { id: postId },
      include: { account: true },
    });

    if (!post) {
      throw new NotFoundException(`Post ${postId} not found.`);
    }

    if (post.status === PostStatus.PROCESSING) {
      throw new BadRequestException(
        'Cannot delete a post that is currently being processed by the publisher.',
      );
    }

    // If already published to LinkedIn, delete from LinkedIn first
    if (post.status === PostStatus.PUBLISHED && post.linkedInPostId) {
      try {
        const accessToken = await this.authService.getValidAccessToken(post.account);
        await this.linkedInPostService.deletePostFromLinkedIn(
          post.account,
          post.linkedInPostId,
          accessToken,
        );
      } catch (error) {
        if (error instanceof NotFoundException) {
          this.logger.warn(`Post ${post.linkedInPostId} was already removed on LinkedIn.`);
        } else {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to delete post ${postId} from LinkedIn: ${msg}`);
          throw error;
        }
      }
    }

    // Delete from database
    await this.prisma.scheduledPost.delete({
      where: { id: postId },
    });

    this.logger.log(`Post ${postId} (status=${post.status}) successfully deleted.`);

    this.sseEventsService.emitPostEvent({
      userId: post.userId,
      type: 'POST_DELETED',
      post: { id: postId },
    });

    return {
      success: true,
      message:
        post.status === PostStatus.PUBLISHED
          ? `Post was successfully deleted from LinkedIn and the database.`
          : `Post was successfully removed.`,
    };
  }

  async updatePost(postId: string, dto: UpdatePostDto): Promise<PostWithAccount> {
    const post = await this.prisma.scheduledPost.findUnique({
      where: { id: postId },
      include: { account: true },
    });

    if (!post) {
      throw new NotFoundException(`Post ${postId} not found.`);
    }

    if (post.status === PostStatus.PROCESSING) {
      throw new BadRequestException(
        'Cannot edit a post that is currently being processed by the publisher.',
      );
    }

    if (dto.content === undefined && dto.scheduledTime === undefined) {
      throw new BadRequestException('Provide either content or scheduledTime to update the post.');
    }

    // 1. Published post: LinkedIn API supports partial update of commentary text only
    if (post.status === PostStatus.PUBLISHED) {
      if (dto.content !== undefined) {
        const trimmed = dto.content.trim();
        if (!trimmed) {
          throw new BadRequestException('Post commentary cannot be empty.');
        }

        if (post.linkedInPostId) {
          const accessToken = await this.authService.getValidAccessToken(post.account);
          await this.linkedInPostService.updatePostOnLinkedIn(
            post.account,
            post.linkedInPostId,
            trimmed,
            accessToken,
          );
        }

        const updated = await this.prisma.scheduledPost.update({
          where: { id: postId },
          data: { content: trimmed },
          select: postWithAccountSelect,
        });

        this.sseEventsService.emitPostEvent({
          userId: post.userId,
          type: 'POST_UPDATED',
          post: updated,
        });

        return updated;
      }

      if (dto.scheduledTime !== undefined) {
        throw new BadRequestException(
          'Cannot modify scheduled time for a post that has already been published to LinkedIn.',
        );
      }
    }

    // 2. Pending post: Can update content and/or scheduled execution time
    if (post.status === PostStatus.PENDING) {
      const data: Prisma.ScheduledPostUpdateInput = {};

      if (dto.content !== undefined) {
        const trimmed = dto.content.trim();
        if (!trimmed) {
          throw new BadRequestException('Post commentary cannot be empty.');
        }
        data.content = trimmed;
      }

      if (dto.scheduledTime !== undefined) {
        const scheduledDate = new Date(dto.scheduledTime);
        if (isNaN(scheduledDate.getTime())) {
          throw new BadRequestException('Invalid scheduledTime timestamp provided.');
        }

        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        if (scheduledDate.getTime() < fiveMinutesAgo) {
          throw new BadRequestException('Cannot schedule a post in the past.');
        }
        data.scheduledTime = scheduledDate;
      }

      const updated = await this.prisma.scheduledPost.update({
        where: { id: postId },
        data,
        select: postWithAccountSelect,
      });

      this.sseEventsService.emitPostEvent({
        userId: post.userId,
        type: 'POST_UPDATED',
        post: updated,
      });

      return updated;
    }

    // 3. Failed post: Can update content and/or scheduled execution time
    if (post.status === PostStatus.FAILED) {
      const data: Prisma.ScheduledPostUpdateInput = {};

      if (dto.content !== undefined) {
        const trimmed = dto.content.trim();
        if (!trimmed) {
          throw new BadRequestException('Post commentary cannot be empty.');
        }
        data.content = trimmed;
      }

      if (dto.scheduledTime !== undefined) {
        const scheduledDate = new Date(dto.scheduledTime);
        if (isNaN(scheduledDate.getTime())) {
          throw new BadRequestException('Invalid scheduledTime timestamp provided.');
        }
        data.scheduledTime = scheduledDate;
      }

      const updated = await this.prisma.scheduledPost.update({
        where: { id: postId },
        data,
        select: postWithAccountSelect,
      });

      this.sseEventsService.emitPostEvent({
        userId: post.userId,
        type: 'POST_UPDATED',
        post: updated,
      });

      return updated;
    }

    throw new BadRequestException(`Post with status ${post.status} cannot be edited.`);
  }

  async retryFailedPost(postId: string): Promise<PostWithAccount> {
    const post = await this.prisma.scheduledPost.findUnique({
      where: { id: postId },
      select: { id: true, status: true },
    });

    if (!post) {
      throw new NotFoundException(`Scheduled post ${postId} not found.`);
    }

    if (post.status !== PostStatus.FAILED) {
      throw new BadRequestException(`Only posts with status FAILED can be retried. Current status: ${post.status}`);
    }

    return this.prisma.scheduledPost.update({
      where: { id: postId },
      data: {
        status: PostStatus.PENDING,
        scheduledTime: new Date(),
        failureReason: null,
      },
      select: postWithAccountSelect,
    });
  }
}
