import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  IsISO8601,
  IsOptional,
  IsIn,
} from 'class-validator';

export class CreateScheduledPostDto {
  @ApiProperty({
    description: 'Application / Clerk user identifier',
    example: 'user_2NNE7BvO8Zf1q',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'ID of the connected LinkedInAccount record to publish from',
    example: '87bfa254-4693-4796-98ec-6e1215104113',
  })
  @IsUUID()
  @IsNotEmpty()
  accountId: string;

  @ApiProperty({
    description: 'Text commentary content of the LinkedIn post',
    example: 'Excited to announce our new product release! 🚀 #tech #ai #innovation',
    maxLength: 3000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000, { message: 'LinkedIn post content must not exceed 3,000 characters.' })
  content: string;

  @ApiProperty({
    description: 'Scheduled execution timestamp in ISO 8601 format (e.g., 2026-11-01T15:30:00.000Z)',
    example: '2026-11-01T15:30:00.000Z',
  })
  @IsISO8601({}, { message: 'scheduledTime must be a valid ISO 8601 date string.' })
  @IsNotEmpty()
  scheduledTime: string;

  @ApiPropertyOptional({
    description: 'Target author type: PERSON or ORGANIZATION',
    enum: ['PERSON', 'ORGANIZATION'],
    example: 'PERSON',
  })
  @IsOptional()
  @IsIn(['PERSON', 'ORGANIZATION'])
  targetType?: string;

  @ApiPropertyOptional({
    description: 'Target URN for the post author (e.g., urn:li:organization:12345678). If omitted, defaults to the personal profile URN.',
    example: 'urn:li:organization:12345678',
  })
  @IsOptional()
  @IsString()
  targetUrn?: string;

  @ApiPropertyOptional({
    description: 'Target entity display name (e.g., Loadgo or Chandan Shaw)',
    example: 'Loadgo',
  })
  @IsOptional()
  @IsString()
  targetName?: string;
}

