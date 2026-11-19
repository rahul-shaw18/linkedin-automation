import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Sse,
  MessageEvent,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { PostsService } from './posts.service';
import { SseEventsService } from '../events/sse-events.service';
import { CreateScheduledPostDto } from './dto/create-scheduled-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
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
    description: 'Lists scheduled, processing, published, and failed posts for a given user ID.',
  })
  @ApiParam({ name: 'userId', description: 'User identifier' })
  @ApiResponse({
    status: 200,
    description: 'List of posts for the user',
    type: [ScheduledPostResponseDto],
  })
  async getUserPosts(
    @Param('userId') userId: string,
  ): Promise<ScheduledPostResponseDto[]> {
    return this.postsService.getUserPosts(userId);
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
  async getPostById(
    @Param('postId', new ParseUUIDPipe()) postId: string,
  ): Promise<ScheduledPostResponseDto> {
    return this.postsService.getPostById(postId);
  }

  @Patch(':postId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Edit / update a post',
    description:
      'Edits post commentary. If already published, updates commentary on LinkedIn via LinkedIn API and syncs DB. If pending or failed, updates commentary and/or scheduled time in DB.',
  })
  @ApiParam({ name: 'postId', description: 'Scheduled post UUID' })
  @ApiResponse({
    status: 200,
    description: 'Post updated successfully',
    type: ScheduledPostResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or post is currently processing',
  })
  @ApiResponse({
    status: 404,
    description: 'Post not found',
  })
  async updatePost(
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @Body() dto: UpdatePostDto,
  ): Promise<ScheduledPostResponseDto> {
    return this.postsService.updatePost(postId, dto);
  }

  @Delete(':postId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete post',
    description:
      'Deletes a post. If the post is published to LinkedIn, it deletes it from LinkedIn via the Posts API and removes it from the database. If pending or failed, it deletes it from the database.',
  })
  @ApiParam({ name: 'postId', description: 'Scheduled post UUID' })
  @ApiResponse({
    status: 200,
    description: 'Post successfully deleted',
  })
  @ApiResponse({
    status: 400,
    description: 'Cannot delete a post currently being processed',
  })
  @ApiResponse({
    status: 404,
    description: 'Post not found',
  })
  async deletePost(
    @Param('postId', new ParseUUIDPipe()) postId: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.postsService.deletePost(postId);
  }

  @Post(':postId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry a failed post',
    description: 'Reschedules a FAILED post by resetting its status back to PENDING.',
  })
  @ApiParam({ name: 'postId', description: 'Failed post UUID' })
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
    @Param('postId', new ParseUUIDPipe()) postId: string,
  ): Promise<ScheduledPostResponseDto> {
    return this.postsService.retryFailedPost(postId);
  }
}
