import { Module } from '@nestjs/common';
import { LinkedInPostService } from './linkedin-post.service';

@Module({
  providers: [LinkedInPostService],
  exports: [LinkedInPostService],
})
export class LinkedInPostModule {}
