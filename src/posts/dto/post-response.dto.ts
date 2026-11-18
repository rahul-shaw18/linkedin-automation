import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountStatus, PostStatus } from '@prisma/client';

export class AccountSummaryDto {
  @ApiProperty({ example: '87bfa254-4693-4796-98ec-6e1215104113' })
  id: string;

  @ApiProperty({ example: 'a1b2c3d4e5' })
  linkedInId: string;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.ACTIVE })
  status: AccountStatus;

  @ApiPropertyOptional({ example: 'Rahul Shaw' })
  name?: string | null;

  @ApiPropertyOptional({ example: 'https://media.licdn.com/dms/image/...' })
  pictureUrl?: string | null;
}

export class ScheduledPostResponseDto {
  @ApiProperty({ example: '6b414f52-8418-4b95-ba38-b7eb48b2649b' })
  id: string;

  @ApiProperty({ example: 'user_2NNE7BvO8Zf1q' })
  userId: string;

  @ApiProperty({ example: '87bfa254-4693-4796-98ec-6e1215104113' })
  accountId: string;

  @ApiProperty({ example: 'Excited to announce our new product release!' })
  content: string;

  @ApiProperty({ example: '2026-11-01T15:30:00.000Z' })
  scheduledTime: Date;

  @ApiProperty({ enum: PostStatus, example: PostStatus.PENDING })
  status: PostStatus;

  @ApiPropertyOptional({ example: 'urn:li:share:7123456789' })
  linkedInPostId?: string | null;

  @ApiPropertyOptional({ example: null })
  failureReason?: string | null;

  @ApiProperty({ example: '2026-11-01T12:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-01T12:00:00.000Z' })
  updatedAt: Date;

  @ApiPropertyOptional({ type: AccountSummaryDto })
  account?: AccountSummaryDto | null;
}
