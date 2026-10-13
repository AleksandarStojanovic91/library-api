/**
 * Rules from docs/SPEC.md that hold for EVERY response, so the API client checks them on every call
 * (in addition to the OpenAPI schema check in contract.ts). Each message names the SPEC section it comes from.
 */
import type { components } from '../generated/openapi';

type Problem = components['schemas']['Problem'];

export interface ExchangeUnderTest {
  method: string;
  path: string;
  status: number;
  headers: Record<string, string>;
  contentType: string | undefined;
  body: unknown;
  /** The X-Request-Id the client sent, if any. */
  sentRequestId: string | undefined;
}

export const PROBLEM_TYPE_PREFIX = 'https://library.example/problems/';

/** docs/SPEC.md "Decisions" 7: the HTTP status and the exact title of every problem code. */
export const PROBLEM_CATALOGUE: Record<Problem['code'], { status: number; title: string }> = {
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

const VALID_REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STACK_TRACE = /(\bat [\w$<>]+\.[\w$.<>]+\s*\(|\w+(Exception|Error):|\.java:\d+|\.[cm]?[jt]s:\d+|node_modules)/;
const RATE_LIMIT_EXEMPT = /^\/(health|metrics)(\/|$)/;

export function isValidClientRequestId(id: string | undefined): id is string {
  return id !== undefined && VALID_REQUEST_ID.test(id);
}

export function checkSpecInvariants(x: ExchangeUnderTest): string[] {
  const v: string[] = [];
  const h = x.headers;

  // Observability: X-Request-Id on every response, echoed if the client's one is valid, else a fresh UUID
  const rid = h['x-request-id'];
  if (!rid) v.push('SPEC Observability: every response must carry X-Request-Id');
  else if (isValidClientRequestId(x.sentRequestId) && rid !== x.sentRequestId)
    v.push(`SPEC Observability: X-Request-Id "${x.sentRequestId}" must be echoed, got "${rid}"`);
  else if (!isValidClientRequestId(x.sentRequestId) && !UUID.test(rid))
    v.push(`SPEC Observability: generated X-Request-Id must be a UUID, got "${rid}"`);

  // Rate limiting: every API response carries the three RateLimit-* headers (health and metrics are exempt)
  if (x.path.startsWith('/api/') && !RATE_LIMIT_EXEMPT.test(x.path)) {
    for (const name of ['ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset']) {
      const value = h[name];
      if (value === undefined) v.push(`SPEC Rate limiting: missing ${name} header`);
      else if (!/^\d+$/.test(value)) v.push(`SPEC Rate limiting: ${name} must be a non-negative integer, got "${value}"`);
    }
  }
  if (x.status === 429 && !/^\d+$/.test(h['retry-after'] ?? ''))
    v.push('SPEC Rate limiting: 429 must carry Retry-After in seconds');

  // Auth: 401 always tells the client which scheme to use
  if (x.status === 401 && !/^Bearer\b/i.test(h['www-authenticate'] ?? ''))
    v.push('SPEC Auth: 401 must carry "WWW-Authenticate: Bearer"');

  // Versioning: every /api/v1/loans* response, errors included, is marked deprecated
  if (/^\/api\/v1\/loans(\/|$)/.test(x.path)) {
    if (h['deprecation'] !== '@1767225600') v.push(`SPEC Deprecation: expected "Deprecation: @1767225600", got "${h['deprecation']}"`);
    if (h['sunset'] !== 'Thu, 31 Dec 2026 23:59:59 GMT') v.push(`SPEC Deprecation: unexpected Sunset "${h['sunset']}"`);
    if (!/<[^>]*\/api\/v2\/loans>;\s*rel="successor-version"/.test(h['link'] ?? ''))
      v.push(`SPEC Deprecation: Link with rel="successor-version" to /api/v2/loans missing, got "${h['link']}"`);
  } else if (h['deprecation'] !== undefined) {
    v.push(`SPEC Deprecation: only /api/v1/loans* is deprecated, but ${x.path} sent Deprecation`);
  }

  // Errors: every 4xx/5xx is a problem document with consistent fields
  if (x.status >= 400) v.push(...checkProblem(x));
  return v;
}

function checkProblem(x: ExchangeUnderTest): string[] {
  const v: string[] = [];
  const mediaType = x.contentType?.split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'application/problem+json') return [`SPEC Errors: ${x.status} must be application/problem+json, got "${x.contentType}"`];
  const p = x.body as Partial<Problem> | undefined;
  if (!p || typeof p !== 'object') return ['SPEC Errors: problem body is not a JSON object'];

  if (p.status !== x.status) v.push(`SPEC Errors: problem.status ${p.status} differs from HTTP status ${x.status}`);
  const expected = p.code ? PROBLEM_CATALOGUE[p.code] : undefined;
  if (expected && expected.status !== x.status)
    v.push(`SPEC Decisions 7: code "${p.code}" must use HTTP ${expected.status}, got ${x.status}`);
  if (expected && p.title !== expected.title)
    v.push(`SPEC Decisions 7: title for "${p.code}" must be "${expected.title}", got "${p.title}"`);
  if (p.type !== `${PROBLEM_TYPE_PREFIX}${p.code}`)
    v.push(`SPEC Errors: problem.type must be "${PROBLEM_TYPE_PREFIX}${p.code}", got "${p.type}"`);
  if (p.instance !== x.path) v.push(`SPEC Errors: problem.instance must be the request path "${x.path}", got "${p.instance}"`);
  if (p.requestId !== x.headers['x-request-id'])
    v.push(`SPEC Errors: problem.requestId "${p.requestId}" must equal X-Request-Id "${x.headers['x-request-id']}"`);
  const text = `${p.title ?? ''}\n${p.detail ?? ''}`;
  if (STACK_TRACE.test(text)) v.push(`SPEC Errors: problem leaks implementation details: "${text.slice(0, 200)}"`);
  return v;
}
