import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest<FastifyRequest>();
    const res = httpCtx.getResponse<FastifyReply>();

    const method = req.method;
    const url = req.url;

    // Suppress high-frequency health-check pings to reduce stdout I/O overhead
    if (url === '/health' || url.startsWith('/health?')) {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          this.logger.log(
            `[${method}] ${url} -> ${res.statusCode} (${duration}ms)`,
          );
        },
        error: (err) => {
          const duration = Date.now() - startTime;
          this.logger.warn(
            `[${method}] ${url} -> ${err.status || 500} (${duration}ms) - ${err.message}`,
          );
        },
      }),
    );
  }
}

