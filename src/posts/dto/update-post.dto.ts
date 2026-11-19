import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MaxLength,
  IsISO8601,
} from 'class-validator';

export class UpdatePostDto {
  @ApiPropertyOptional({
    description: 'Updated commentary text for the post (max 3,000 characters)',
    example: 'Updated post content with new insights! #tech #updates',
    maxLength: 3000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(3000, { message: 'LinkedIn post content must not exceed 3,000 characters.' })
  content?: string;

  @ApiPropertyOptional({
    description:
      'Updated scheduled execution timestamp in ISO 8601 format (only applicable for PENDING or FAILED posts)',
    example: '2026-11-20T10:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'scheduledTime must be a valid ISO 8601 date string.' })
  scheduledTime?: string;
}
