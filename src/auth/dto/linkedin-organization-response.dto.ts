import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LinkedInOrganizationResponseDto {
  @ApiProperty({ example: '12345678' })
  id: string;

  @ApiProperty({ example: 'urn:li:organization:12345678' })
  urn: string;

  @ApiProperty({ example: 'Acme Corp' })
  name: string;

  @ApiPropertyOptional({ example: 'acme-corp' })
  vanityName?: string | null;

  @ApiPropertyOptional({ example: 'https://media.licdn.com/...' })
  logoUrl?: string | null;

  @ApiPropertyOptional({ example: 'ADMINISTRATOR' })
  role?: string | null;
}

