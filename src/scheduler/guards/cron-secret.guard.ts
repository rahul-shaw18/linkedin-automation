import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class CronSecretGuard implements CanActivate {
  private readonly logger = new Logger(CronSecretGuard.name);
  private expectedSecret: string | null = null;
  private expectedBuffer: Buffer | null = null;

  constructor(private readonly configService: ConfigService) {
    this.initSecret();
  }

  private initSecret(): void {
    this.expectedSecret = this.configService.get<string>('CRON_SECRET_KEY') || null;
    if (this.expectedSecret) {
      this.expectedBuffer = Buffer.from(this.expectedSecret);
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    // Lazily re-verify secret buffer if environment changed or delayed config injection
    if (!this.expectedSecret || !this.expectedBuffer) {
      this.initSecret();
      if (!this.expectedSecret || !this.expectedBuffer) {
        this.logger.error('CRON_SECRET_KEY is not configured in environment variables.');
        throw new UnauthorizedException('Scheduler webhook authentication is not configured on the server.');
      }
    }

    const rawProvided =
      request.headers['x-cron-secret'] ||
      request.headers['authorization']?.replace(/^Bearer\s+/i, '');

    const providedSecret =
      typeof rawProvided === 'string'
        ? rawProvided
        : Array.isArray(rawProvided)
        ? rawProvided[0]
        : '';

    if (!providedSecret) {
      this.logger.warn(`Unauthorized trigger attempt from IP: ${request.ip} - Missing secret header`);
      throw new UnauthorizedException('Invalid or missing X-Cron-Secret authentication header.');
    }

    // Constant-time buffer comparison to prevent timing side-channel attacks
    const providedBuffer = Buffer.from(providedSecret);

    const isMatch =
      this.expectedBuffer.length === providedBuffer.length &&
      timingSafeEqual(this.expectedBuffer, providedBuffer);

    if (!isMatch) {
      this.logger.warn(`Unauthorized trigger attempt from IP: ${request.ip} - Invalid secret provided`);
      throw new UnauthorizedException('Invalid or missing X-Cron-Secret authentication header.');
    }

    return true;
  }
}

