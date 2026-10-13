import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError, type ErrorCode } from '../../../domain/shared/domain-error';
import { sendProblem, type ProblemSpec } from './problem';

/**
 * Every code has one fixed status (SPEC), so statuses without a code of their own (405, 413, 415, ...)
 * are reported as the closest code, with that code's status.
 */
const CODE_BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not-found',
  405: 'not-found',
  409: 'conflict',
  412: 'precondition-failed',
  428: 'precondition-required',
  429: 'rate-limited',
};

/** Turns anything thrown during a request into an RFC 9457 problem; unexpected errors never leak details. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const spec = this.toProblem(exception, request);
    if (spec.code === 'internal') {
      this.logger.error({ err: exception, requestId: request.id }, 'Unhandled error while processing the request');
    }
    sendProblem(reply, request, spec);
  }

  private toProblem(exception: unknown, request: FastifyRequest): ProblemSpec {
    if (exception instanceof DomainError) {
      return { code: exception.code, detail: exception.message, errors: exception.fieldErrors };
    }
    // Nest itself throws HttpException for unknown routes and wraps Fastify's own errors (415, 413, ...) in one.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 404) {
        return { code: 'not-found', detail: `No route for ${request.method} ${request.url.split('?')[0] ?? ''}.` };
      }
      return this.fromStatus(status, exception.message);
    }
    return { code: 'internal', detail: 'An unexpected error occurred.' };
  }

  private fromStatus(status: number, message: string): ProblemSpec {
    if (status >= 500) {
      return { code: 'internal', detail: 'An unexpected error occurred.' };
    }
    if (status === 415) {
      return { code: 'validation-failed', detail: 'Unsupported Content-Type; send application/json.' };
    }
    if (status === 413) {
      return { code: 'validation-failed', detail: 'The request body is too large.' };
    }
    return { code: CODE_BY_STATUS[status] ?? 'validation-failed', detail: message };
  }
}
