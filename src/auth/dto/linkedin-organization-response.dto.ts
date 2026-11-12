import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LinkedInOrganizationResponseDto {
  @ApiProperty({ example: '12345678' })
  id: string;

  @ApiProperty({ example: 'urn:li:organization:12345678' })
  urn: string;

  @ApiProperty({ example: 'Loadgo' })
  name: string;

  @ApiPropertyOptional({ example: 'loadgo' })
  vanityName?: string | null;

  @ApiPropertyOptional({ example: 'https://media.licdn.com/...' })
  logoUrl?: string | null;

  @ApiPropertyOptional({ example: 'ADMINISTRATOR' })
  role?: string | null;
}

