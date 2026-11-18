import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus } from '@prisma/client';

export class LinkedInAccountResponseDto {
  @ApiProperty({ example: '87bfa254-4693-4796-98ec-6e1215104113' })
  id: string;

  @ApiProperty({ example: 'user_2NNE7BvO8Zf1q' })
  userId: string;

  @ApiProperty({ example: 'a1b2c3d4e5' })
  linkedInId: string;

  @ApiProperty({ example: 'Rahul Shaw', required: false, nullable: true })
  name?: string | null;

  @ApiProperty({ example: 'rahul@example.com', required: false, nullable: true })
  email?: string | null;

  @ApiProperty({ example: 'https://media.licdn.com/dms/image/...', required: false, nullable: true })
  pictureUrl?: string | null;

  @ApiProperty({ example: '2026-12-31T23:59:59.000Z' })
  tokenExpiresAt: Date;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.ACTIVE })
  status: AccountStatus;

  @ApiProperty({ example: '2026-11-01T12:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-01T12:00:00.000Z' })
  updatedAt: Date;
}

