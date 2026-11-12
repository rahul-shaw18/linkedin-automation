import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LinkedInCallbackDto {
  @ApiProperty({
    description: 'Authorization code returned from LinkedIn OAuth authorization flow',
    example: 'AQR7...k_o9w',
  })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({
    description: 'User ID of the application/Clerk user connecting their LinkedIn account',
    example: 'user_2NNE7BvO8Zf1q',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({
    description: 'Optional custom redirect URI if different from default environment variable',
    example: 'http://localhost:3000/auth/linkedin/callback',
  })
  @IsString()
  @IsOptional()
  redirectUri?: string;
}

