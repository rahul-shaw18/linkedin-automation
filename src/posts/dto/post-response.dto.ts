import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PostStatus } from '@prisma/client';

export class ScheduledPostResponseDto {
  @ApiProperty({ example: '6b414f52-8418-4b95-ba38-b7eb48b2649b' })
  id: string;

  @ApiProperty({ example: 'user_2NNE7BvO8Zf1q' })
  userId: string;

  @ApiProperty({ example: '87bfa254-4693-4796-98ec-6e1215104113' })
  accountId: string;

  @ApiProperty({ example: 'Excited to announce our new product release! 🚀' })
  content: string;

  @ApiProperty({ example: '2026-11-01T15:30:00.000Z' })
  scheduledTime: Date;

  @ApiProperty({ enum: PostStatus, example: PostStatus.PENDING })
  status: PostStatus;

  @ApiPropertyOptional({ example: 'ORGANIZATION', enum: ['PERSON', 'ORGANIZATION'] })
  targetType?: string | null;

  @ApiPropertyOptional({ example: 'urn:li:organization:12345678' })
  targetUrn?: string | null;

  @ApiPropertyOptional({ example: 'Acme Corp' })
  targetName?: string | null;

  @ApiPropertyOptional({ example: 'urn:li:share:7123456789' })
  linkedInPostId?: string | null;

  @ApiPropertyOptional({ example: null })
  failureReason?: string | null;

  @ApiProperty({ example: '2026-11-01T12:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-01T12:00:00.000Z' })
  updatedAt: Date;
}

