import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LinkedInApiClient } from './linkedin-api.client';

@Module({
  controllers: [AuthController],
  providers: [AuthService, LinkedInApiClient],
  exports: [AuthService, LinkedInApiClient],
})
export class LinkedInAuthModule {}
