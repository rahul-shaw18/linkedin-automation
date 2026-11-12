import { Global, Module } from '@nestjs/common';
import { SseEventsService } from './sse-events.service';

@Global()
@Module({
  providers: [SseEventsService],
  exports: [SseEventsService],
})
export class EventsModule {}

