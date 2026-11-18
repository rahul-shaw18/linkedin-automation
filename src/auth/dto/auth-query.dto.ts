import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GetLoginUrlQueryDto {
  @ApiProperty({ description: 'Application or Clerk User ID', example: 'user_2NNE7BvO8Zf1q' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({
    description: 'Custom OAuth callback redirect URI',
    example: 'http://localhost:3000/auth/linkedin/callback',
  })
  @IsString()
  @IsOptional()
  redirectUri?: string;
}

export class OAuthCallbackQueryDto {
  @ApiPropertyOptional({ description: 'Authorization code from LinkedIn OAuth consent screen' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ description: 'Base64URL state payload containing user ID' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ description: 'Error code from OAuth failure' })
  @IsString()
  @IsOptional()
  error?: string;

  @ApiPropertyOptional({ description: 'Detailed error description from OAuth failure' })
  @IsString()
  @IsOptional()
  error_description?: string;
}
