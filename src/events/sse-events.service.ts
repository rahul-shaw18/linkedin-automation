import { Injectable, MessageEvent } from '@nestjs/common';
import { Subject, Observable, interval, merge } from 'rxjs';
import { filter, map } from 'rxjs/operators';

export interface PostEventPayload {
  userId: string;
  type: 'POST_PUBLISHED' | 'POST_FAILED' | 'POST_PROCESSING' | 'POST_CREATED';
  post: any;
  timestamp: string;
}

@Injectable()
export class SseEventsService {
  private readonly postEvents$ = new Subject<PostEventPayload>();

  /**
   * Emits a real-time post lifecycle event to connected SSE clients.
   */
  emitPostEvent(payload: Omit<PostEventPayload, 'timestamp'>): void {
    this.postEvents$.next({
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Returns a filtered Observable stream for a specific user's SSE connection.
   * Merges a 25-second keepalive heartbeat to prevent reverse proxies and Render load balancers
   * from dropping idle HTTP streaming connections.
   */
  getUserStream(userId: string): Observable<MessageEvent> {
    const userEvents$ = this.postEvents$.pipe(
      filter((e) => !userId || e.userId === userId || userId === 'ALL'),
      map((event) => ({
        data: JSON.stringify(event),
      })),
    );

    const heartbeat$ = interval(25000).pipe(
      map(() => ({
        type: 'ping',
        data: JSON.stringify({ type: 'HEARTBEAT', timestamp: new Date().toISOString() }),
      })),
    );

    return merge(userEvents$, heartbeat$);
  }
}

