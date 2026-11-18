import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Number of records to return (default: 50, max: 100)',
    example: 50,
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @ApiPropertyOptional({
    description: 'Number of records to skip (default: 0)',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}

export class RetryPostQueryDto {
  @ApiPropertyOptional({
    description: 'Optional new scheduled execution time in ISO 8601 format (defaults to immediate execution)',
    example: '2026-11-01T15:30:00.000Z',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'scheduledTime must be a valid ISO 8601 date string.' })
  scheduledTime?: string;
}
