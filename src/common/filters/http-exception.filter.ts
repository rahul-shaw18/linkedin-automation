import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Internal server error';
    let errorDetail: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'object') {
        message = (exceptionResponse as any).message || exceptionResponse;
      } else {
        message = exceptionResponse;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': {
          status = HttpStatus.CONFLICT;
          const target = (exception.meta?.target as string[]) || 'field';
          message = `Unique constraint violation on ${Array.isArray(target) ? target.join(', ') : target}.`;
          break;
        }
        case 'P2025': {
          status = HttpStatus.NOT_FOUND;
          message = (exception.meta?.cause as string) || 'Record not found.';
          break;
        }
        case 'P2003': {
          status = HttpStatus.BAD_REQUEST;
          message = 'Foreign key constraint failed on related entity.';
          break;
        }
        default:
          status = HttpStatus.BAD_REQUEST;
          message = `Database query error (Prisma ${exception.code}): ${exception.message}`;
      }
      errorDetail = exception.meta;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    this.logger.error(
      `[${request.method}] ${request.url} - Status: ${status} - Error: ${
        typeof message === 'object' ? JSON.stringify(message) : message
      }`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).send({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      error: message,
      details: errorDetail,
    });
  }
}

