import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduledPostDto } from './dto/create-scheduled-post.dto';
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

  constructor(private readonly prisma: PrismaService) {}

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

  async getUserPosts(
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<PostWithAccount[]> {
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const safeOffset = Math.max(0, offset);

    return this.prisma.scheduledPost.findMany({
      where: {
        OR: [
          { userId },
          { account: { userId } },
          { account: { linkedInId: userId } },
        ],
      },
      orderBy: { scheduledTime: 'desc' },
      take: safeLimit,
      skip: safeOffset,
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

  async cancelScheduledPost(postId: string): Promise<{ success: boolean; message: string }> {
    const post = await this.prisma.scheduledPost.findUnique({
      where: { id: postId },
      select: { id: true, status: true },
    });

    if (!post) {
      throw new NotFoundException(`Scheduled post ${postId} not found.`);
    }

    if (post.status === PostStatus.PUBLISHED) {
      throw new BadRequestException('Cannot delete or cancel a post that has already been published to LinkedIn.');
    }

    if (post.status === PostStatus.PROCESSING) {
      throw new BadRequestException('Cannot cancel a post that is currently being processed by the publisher.');
    }

    // Atomic delete ensuring the post status has not changed to PROCESSING concurrently
    const deleted = await this.prisma.scheduledPost.deleteMany({
      where: {
        id: postId,
        status: { in: [PostStatus.PENDING, PostStatus.FAILED] },
      },
    });

    if (deleted.count === 0) {
      throw new BadRequestException(
        'Post could not be cancelled because it is already being processed or published.',
      );
    }

    this.logger.log(`Post ${postId} was successfully cancelled and deleted.`);

    return {
      success: true,
      message: `Scheduled post ${postId} was successfully cancelled.`,
    };
  }

  async retryFailedPost(postId: string, newScheduledTime?: string): Promise<PostWithAccount> {
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

    const scheduledDate = newScheduledTime ? new Date(newScheduledTime) : new Date();

    return this.prisma.scheduledPost.update({
      where: { id: postId },
      data: {
        status: PostStatus.PENDING,
        scheduledTime: scheduledDate,
        failureReason: null,
      },
      select: postWithAccountSelect,
    });
  }
}
