import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduledPostDto } from './dto/create-scheduled-post.dto';
import { PostStatus, ScheduledPost, AccountStatus } from '@prisma/client';

const accountSummarySelect = {
  id: true,
  linkedInId: true,
  status: true,
  name: true,
  pictureUrl: true,
};

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createScheduledPost(dto: CreateScheduledPostDto): Promise<ScheduledPost> {
    const scheduledDate = new Date(dto.scheduledTime);

    if (isNaN(scheduledDate.getTime())) {
      throw new BadRequestException('Invalid scheduledTime timestamp provided.');
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
        targetType: 'PERSON',
        targetUrn: null,
        targetName: account.name || 'Personal Profile',
      },
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
  ): Promise<ScheduledPost[]> {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 100);
    const safeOffset = Math.max(0, Number(offset) || 0);

    const userAccounts = await this.prisma.linkedInAccount.findMany({
      where: { userId },
      select: { id: true, linkedInId: true },
    });
    const linkedInIds = userAccounts
      .map((acc) => acc.linkedInId)
      .filter((id): id is string => Boolean(id));

    return this.prisma.scheduledPost.findMany({
      where: {
        OR: [
          { userId },
          ...(linkedInIds.length > 0
            ? [{ account: { linkedInId: { in: linkedInIds } } }]
            : []),
        ],
      },
      orderBy: { scheduledTime: 'desc' },
      take: safeLimit,
      skip: safeOffset,
      include: {
        account: {
          select: accountSummarySelect,
        },
      },
    });
  }

  async getPostById(postId: string): Promise<ScheduledPost> {
    const post = await this.prisma.scheduledPost.findUnique({
      where: { id: postId },
      include: {
        account: {
          select: accountSummarySelect,
        },
      },
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

    await this.prisma.scheduledPost.delete({
      where: { id: postId },
    });

    this.logger.log(`Post ${postId} was successfully cancelled and deleted.`);

    return {
      success: true,
      message: `Scheduled post ${postId} was successfully cancelled.`,
    };
  }

  async retryFailedPost(postId: string, newScheduledTime?: string): Promise<ScheduledPost> {
    const post = await this.prisma.scheduledPost.findUnique({
      where: { id: postId },
      select: { id: true, status: true, targetUrn: true },
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
    });
  }
}
