import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ErrorCode, FieldError } from '../../../domain/shared/domain-error';
import type { components } from '../../../generated/openapi';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
const TYPE_BASE = 'https://library.example/problems/';

/** Status and fixed title per code: the table in docs/SPEC.md, Decisions 7 (identical in the Java service). */
const CATALOG: Record<ErrorCode, { readonly status: number; readonly title: string }> = {
  'validation-failed': { status: 400, title: 'Request validation failed' },
  unauthorized: { status: 401, title: 'Authentication required' },
  forbidden: { status: 403, title: 'Not allowed' },
  'not-found': { status: 404, title: 'Resource not found' },
  conflict: { status: 409, title: 'Conflict' },
  duplicate: { status: 409, title: 'Resource already exists' },
  'no-copy-available': { status: 409, title: 'No copy available' },
  'loan-limit-reached': { status: 409, title: 'Loan limit reached' },
  'member-suspended': { status: 409, title: 'Member is suspended' },
  'already-returned': { status: 409, title: 'Loan already returned' },
  'book-has-active-loans': { status: 409, title: 'Book has copies on loan or on hold' },
  'book-has-loan-history': { status: 409, title: 'Book has loan history' },
  'already-reserved': { status: 409, title: 'Book already reserved by this member' },
  'copy-available': { status: 409, title: 'A copy is available, borrow it instead' },
  'reservation-not-cancellable': { status: 409, title: 'Reservation cannot be cancelled' },
  'precondition-failed': { status: 412, title: 'Precondition failed' },
  'precondition-required': { status: 428, title: 'Precondition required' },
  'idempotency-key-reused': { status: 422, title: 'Idempotency key reused with a different request' },
  'rate-limited': { status: 429, title: 'Too many requests' },
  internal: { status: 500, title: 'Internal server error' },
};

export type ProblemDocument = components['schemas']['Problem'] & { code: ErrorCode; instance: string; requestId: string };

export interface ProblemSpec {
  readonly code: ErrorCode;
  readonly detail: string;
  readonly errors?: readonly FieldError[] | undefined;
}

export function statusOf(code: ErrorCode): number {
  return CATALOG[code].status;
}

export function problemDocument(spec: ProblemSpec, instance: string, requestId: string): ProblemDocument {
  return {
    type: `${TYPE_BASE}${spec.code}`,
    title: CATALOG[spec.code].title,
    status: CATALOG[spec.code].status,
    detail: spec.detail,
    instance,
    code: spec.code,
    ...(spec.errors && spec.errors.length > 0 && { errors: spec.errors.map(({ field, message }) => ({ field, message })) }),
    requestId,
  };
}

export function pathOf(request: FastifyRequest): string {
  const queryStart = request.url.indexOf('?');
  return queryStart === -1 ? request.url : request.url.slice(0, queryStart);
}

export function sendProblem(reply: FastifyReply, request: FastifyRequest, spec: ProblemSpec): FastifyReply {
  const document = problemDocument(spec, pathOf(request), request.id);
  if (document.status === 401) {
    reply.header('WWW-Authenticate', 'Bearer realm="library-api"');
  }
  return reply.status(document.status).type(PROBLEM_CONTENT_TYPE).send(document);
}
