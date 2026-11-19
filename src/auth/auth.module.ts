import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LinkedInApiClient } from './linkedin-api.client';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, LinkedInApiClient, SessionService],
  exports: [AuthService, LinkedInApiClient, SessionService],
})
export class AuthModule {}
