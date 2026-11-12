import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Query,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { PostsService } from './posts.service';
import { SseEventsService } from '../events/sse-events.service';
import { CreateScheduledPostDto } from './dto/create-scheduled-post.dto';
import { ScheduledPostResponseDto } from './dto/post-response.dto';

@ApiTags('LinkedIn Scheduled Posts')
@Controller('posts')
export class PostsController {
  constructor(
    private readonly postsService: PostsService,
    private readonly sseEventsService: SseEventsService,
  ) {}

  @Sse('events/:userId')
  @ApiOperation({
    summary: 'Server-Sent Events (SSE) stream for real-time post lifecycle updates',
    description:
      'Provides a real-time HTTP event stream notifying the frontend whenever posts are scheduled, processing, published, or failed.',
  })
  streamPostEvents(@Param('userId') userId: string): Observable<MessageEvent> {
    return this.sseEventsService.getUserStream(userId);
  }

  @Post('schedule')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Schedule a new LinkedIn post',
    description:
      'Creates a new post entry in the database with status PENDING, queued for publishing at scheduledTime.',
  })
  @ApiResponse({
    status: 201,
    description: 'Post scheduled successfully',
    type: ScheduledPostResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or account does not belong to user / disconnected',
  })
  @ApiResponse({
    status: 404,
    description: 'LinkedIn account not found',
  })
  async schedulePost(@Body() dto: CreateScheduledPostDto): Promise<ScheduledPostResponseDto> {
    return this.postsService.createScheduledPost(dto);
  }

  @Get('user/:userId')
  @ApiOperation({
    summary: 'Retrieve all posts for a user with status details',
    description: 'Lists scheduled, processing, published, and failed posts for a given user ID with pagination support.',
  })
  @ApiParam({ name: 'userId', description: 'User identifier' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of posts to return (default: 50, max: 100)' })
  @ApiQuery({ name: 'offset', required: false, description: 'Number of posts to skip (default: 0)' })
  @ApiResponse({
    status: 200,
    description: 'List of posts for the user',
    type: [ScheduledPostResponseDto],
  })
  async getUserPosts(
    @Param('userId') userId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<ScheduledPostResponseDto[]> {
    return this.postsService.getUserPosts(userId, limit, offset);
  }

  @Get(':postId')
  @ApiOperation({
    summary: 'Get details of a specific scheduled post',
    description: 'Retrieves single post status, execution details, and failure logs if any.',
  })
  @ApiParam({ name: 'postId', description: 'Scheduled post UUID' })
  @ApiResponse({
    status: 200,
    description: 'Scheduled post details',
    type: ScheduledPostResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Post not found',
  })
  async getPostById(@Param('postId') postId: string): Promise<ScheduledPostResponseDto> {
    return this.postsService.getPostById(postId);
  }

  @Delete(':postId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel/delete a pending post',
    description:
      'Cancels and deletes a scheduled post before it is published. Fails if the post is already published or processing.',
  })
  @ApiParam({ name: 'postId', description: 'Scheduled post UUID' })
  @ApiResponse({
    status: 200,
    description: 'Post successfully cancelled',
  })
  @ApiResponse({
    status: 400,
    description: 'Cannot cancel an already published or processing post',
  })
  @ApiResponse({
    status: 404,
    description: 'Post not found',
  })
  async cancelPost(
    @Param('postId') postId: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.postsService.cancelScheduledPost(postId);
  }

  @Post(':postId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry a failed post',
    description: 'Reschedules a FAILED post by resetting its status back to PENDING.',
  })
  @ApiParam({ name: 'postId', description: 'Failed post UUID' })
  @ApiQuery({
    name: 'scheduledTime',
    required: false,
    description: 'Optional new scheduled execution time (defaults to immediate execution)',
  })
  @ApiResponse({
    status: 200,
    description: 'Post rescheduled successfully',
    type: ScheduledPostResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Post is not in FAILED state',
  })
  async retryPost(
    @Param('postId') postId: string,
    @Query('scheduledTime') scheduledTime?: string,
  ): Promise<ScheduledPostResponseDto> {
    return this.postsService.retryFailedPost(postId, scheduledTime);
  }
}

