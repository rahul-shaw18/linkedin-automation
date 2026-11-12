import { ApiProperty } from '@nestjs/swagger';

export class TriggerExecutionResultDto {
  @ApiProperty({ example: 3, description: 'Number of pending scheduled posts found' })
  totalFound: number;

  @ApiProperty({ example: 2, description: 'Number of posts successfully published to LinkedIn' })
  published: number;

  @ApiProperty({ example: 1, description: 'Number of posts that failed to publish' })
  failed: number;

  @ApiProperty({ example: 0, description: 'Number of posts skipped due to concurrency lock' })
  skipped: number;

  @ApiProperty({
    example: [
      { id: 'uuid-1', status: 'PUBLISHED', postId: 'urn:li:share:123456' },
      { id: 'uuid-2', status: 'FAILED', reason: 'LinkedIn access token expired' },
    ],
    description: 'Detailed execution records for each processed post',
  })
  details: Array<{
    id: string;
    status: string;
    postId?: string;
    reason?: string;
  }>;

  @ApiProperty({ example: '2026-11-01T12:00:00.000Z' })
  executedAt: string;
}

