import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { HttpMetrics, Principal, RateLimitDecision, RateLimiter, TokenService } from '../../../application/ports/services';
import { sendProblem } from '../problem/problem';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
    authFailure: 'missing' | 'invalid' | null;
    rateLimit: RateLimitDecision | null;
  }
}

const VALID_REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;
const EXEMPT_FROM_RATE_LIMIT = /^\/(health\/|metrics(?:[/?]|$))/;
const V1_LOANS = /^\/api\/v1\/loans(?:[/?]|$)/;

export const DEPRECATION_HEADERS = {
  Deprecation: '@1767225600',
  Sunset: 'Thu, 31 Dec 2026 23:59:59 GMT',
  Link: '</api/v2/loans>; rel="successor-version"',
} as const;

/**
 * Fastify `genReqId`: echo a well-formed client X-Request-Id, otherwise generate a UUID. The id is also
 * stored on the raw request so nestjs-pino (which only sees the raw request) logs the same id.
 */
export function requestIdFor(raw: IncomingMessage): string {
  const header = raw.headers['x-request-id'];
  const id = typeof header === 'string' && VALID_REQUEST_ID.test(header) ? header : randomUUID();
  (raw as IncomingMessage & { id?: string }).id = id;
  return id;
}

export interface PipelineDependencies {
  readonly tokens: TokenService;
  readonly rateLimiter: RateLimiter;
  readonly metrics: HttpMetrics;
}

/**
 * Cross-cutting HTTP behaviour as Fastify hooks rather than Nest interceptors: hooks also run for requests
 * that never reach a controller (unknown routes, malformed bodies, guard rejections, 429s), and every one
 * of those responses still needs its request id, rate-limit headers, log line and metric.
 */
export function installHttpPipeline(fastify: FastifyInstance, deps: PipelineDependencies): void {
  fastify.decorateRequest('principal', null);
  fastify.decorateRequest('authFailure', null);
  fastify.decorateRequest('rateLimit', null);

  fastify.addHook('onRequest', async (request, reply) => {
    await authenticate(request, deps.tokens);
    if (EXEMPT_FROM_RATE_LIMIT.test(request.url)) {
      return;
    }
    // Authenticated callers are limited per member, anonymous ones per client IP.
    request.rateLimit = await deps.rateLimiter.consume(request.principal?.memberId ?? request.ip);
    if (request.rateLimit && !request.rateLimit.allowed) {
      reply.header('Retry-After', String(request.rateLimit.resetSeconds));
      return sendProblem(reply, request, {
        code: 'rate-limited',
        detail: `Rate limit of ${request.rateLimit.limit} requests per minute exceeded; retry in ${request.rateLimit.resetSeconds} s.`,
      });
    }
  });

  fastify.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Request-Id', request.id);
    if (request.rateLimit) {
      reply.header('RateLimit-Limit', String(request.rateLimit.limit));
      reply.header('RateLimit-Remaining', String(request.rateLimit.remaining));
      reply.header('RateLimit-Reset', String(request.rateLimit.resetSeconds));
    }
    if (V1_LOANS.test(request.url)) {
      reply.headers(DEPRECATION_HEADERS);
    }
    return payload;
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? 'UNMATCHED';
    const durationMs = reply.elapsedTime;
    deps.metrics.observeRequest(request.method, route, reply.statusCode, durationMs / 1000);
    request.log.info(
      {
        method: request.method,
        path: route,
        status: reply.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        requestId: request.id,
        memberId: request.principal?.memberId ?? null,
      },
      'request completed',
    );
  });
}

async function authenticate(request: FastifyRequest, tokens: TokenService): Promise<void> {
  const header = request.headers.authorization;
  if (!header) {
    request.authFailure = 'missing';
    return;
  }
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  request.principal = token ? await tokens.verify(token) : null;
  request.authFailure = request.principal ? null : 'invalid';
}
