import { Injectable, MessageEvent, BadRequestException } from '@nestjs/common';
import { Subject, Observable, interval, merge } from 'rxjs';
import { filter, map } from 'rxjs/operators';

export interface PostEventPayload {
  userId: string;
  type:
    | 'POST_PUBLISHED'
    | 'POST_FAILED'
    | 'POST_PROCESSING'
    | 'POST_CREATED'
    | 'POST_UPDATED'
    | 'POST_DELETED';
  post: Record<string, unknown>;
  timestamp: string;
}

@Injectable()
export class SseEventsService {
  private readonly postEvents$ = new Subject<PostEventPayload>();

  emitPostEvent(payload: Omit<PostEventPayload, 'timestamp'>): void {
    this.postEvents$.next({
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  getUserStream(userId: string): Observable<MessageEvent> {
    const trimmedUserId = userId?.trim();
    if (!trimmedUserId || trimmedUserId === 'ALL') {
      throw new BadRequestException('A valid userId is required to subscribe to real-time events.');
    }

    const userEvents$ = this.postEvents$.pipe(
      filter((e) => {
        if (e.userId === trimmedUserId) return true;
        const postAccount = (e.post as Record<string, any>)?.account;
        if (
          postAccount &&
          (postAccount.userId === trimmedUserId || postAccount.linkedInId === trimmedUserId)
        ) {
          return true;
        }
        return false;
      }),
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
