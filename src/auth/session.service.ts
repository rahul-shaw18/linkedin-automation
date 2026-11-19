import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyReply, FastifyRequest } from 'fastify';

export const SESSION_COOKIE_NAME = 'la_session';
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

@Injectable()
export class SessionService {
  constructor(private readonly configService: ConfigService) {}

  setSessionCookie(reply: FastifyReply, userId: string): void {
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    reply.setCookie(SESSION_COOKIE_NAME, userId, {
      httpOnly: true,
      secure: isProd,
      signed: true,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: SESSION_MAX_AGE_MS,
      path: '/',
    });
  }

  clearSessionCookie(reply: FastifyReply): void {
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    reply.clearCookie(SESSION_COOKIE_NAME, {
      path: '/',
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
    });
  }

  extractSessionUserId(req: FastifyRequest): string | null {
    const rawCookie = req.cookies?.[SESSION_COOKIE_NAME];
    if (!rawCookie) {
      return null;
    }

    const unsigned = req.unsignCookie(rawCookie);
    if (unsigned.valid && unsigned.value) {
      return unsigned.value;
    }

    return rawCookie;
  }
}
