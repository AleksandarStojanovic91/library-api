/**
 * Self-tests for the suite's own machinery. No server needed: `npx playwright test --project=unit`.
 * If the validator were silently accepting everything, every API test would be weaker than it looks.
 */
import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { Contract } from '../../src/contract/contract';
import { checkSpecInvariants, PROBLEM_CATALOGUE, type ExchangeUnderTest } from '../../src/contract/spec-invariants';
import { config } from '../../src/config';
import * as gen from '../../src/data/generators';
import { decodeJwt, signHs256, withTamperedClaims } from '../../src/data/jwt';

const source = fs.readFileSync(config.contractPath, 'utf8');
const closed = new Contract(source, { closed: true });
const open = new Contract(source, { closed: false });

const ID = '20000000-0000-4000-8000-000000000001';
const T = '2026-10-13T09:15:00.000Z';
const book = {
  id: ID, isbn: '9780132350884', title: 'Clean Code', description: null, publishedYear: 2008,
  authors: [{ id: ID, name: 'Robert C. Martin' }], tags: ['software'], totalCopies: 2, availableCopies: 1,
  version: 3, createdAt: T, updatedAt: T,
};
const problem = (code: keyof typeof PROBLEM_CATALOGUE, status: number, path: string) => ({
  type: `https://library.example/problems/${code}`, title: PROBLEM_CATALOGUE[code].title, status, code, instance: path, requestId: 'req-12345678',
});

function check(c: Contract, method: string, path: string, status: number, body: unknown, contentType = 'application/json', headers: Record<string, string> = {}) {
  return c.check({ method, path, status, headers, contentType, body, rawText: body === undefined ? '' : JSON.stringify(body) });
}

test.describe('contract validator', () => {
  test('accepts a valid Book with its documented ETag header', () => {
    expect(check(closed, 'GET', `/api/v1/books/${ID}`, 200, book, 'application/json', { etag: '"3"' }).violations).toEqual([]);
  });

  test('rejects a missing required field', () => {
    const { title: _omit, ...withoutTitle } = book;
    const r = check(closed, 'GET', `/api/v1/books/${ID}`, 200, withoutTitle, 'application/json', { etag: '"3"' });
    expect(r.violations.join()).toContain("must have required property 'title'");
  });

  test('rejects undeclared fields (closed schemas), but only when closed', () => {
    const body = { ...book, internalNote: 'x' };
    expect(check(closed, 'GET', `/api/v1/books/${ID}`, 200, body, 'application/json', { etag: '"3"' }).violations.join()).toContain('internalNote');
    expect(check(open, 'GET', `/api/v1/books/${ID}`, 200, body, 'application/json', { etag: '"3"' }).violations).toEqual([]);
  });

  test('rejects timestamps without milliseconds or Z (SPEC "Time")', () => {
    for (const ts of ['2026-10-13T09:15:00Z', '2026-10-13T09:15:00.000+02:00', '2026-10-13 09:15:00.000Z']) {
      const r = check(closed, 'GET', `/api/v1/books/${ID}`, 200, { ...book, createdAt: ts }, 'application/json', { etag: '"3"' });
      expect(r.violations.join(), ts).toContain('date-time');
    }
  });

  test('rejects a missing documented header and a wrong content type', () => {
    expect(check(closed, 'GET', `/api/v1/books/${ID}`, 200, book).violations.join()).toContain('ETag');
    expect(check(closed, 'GET', `/api/v1/books/${ID}`, 200, book, 'text/html', { etag: '"1"' }).violations.join()).toContain('Content-Type');
  });

  test('matches literal paths before templated ones (/members/me vs /members/{id})', () => {
    expect(closed.findOperation('GET', '/api/v1/members/me')?.template).toBe('/api/v1/members/me');
    expect(closed.findOperation('GET', `/api/v1/members/${ID}`)?.template).toBe('/api/v1/members/{memberId}');
  });

  test('validates problems through $ref responses and keeps Problem open for extension members', () => {
    const p = { ...problem('not-found', 404, `/api/v1/books/${ID}`), traceId: 'abc' };
    expect(check(closed, 'GET', `/api/v1/books/${ID}`, 404, p, 'application/problem+json').violations).toEqual([]);
    const bad = { ...p, code: 'teapot' as never };
    expect(check(closed, 'GET', `/api/v1/books/${ID}`, 404, bad, 'application/problem+json').violations.join()).toContain('allowed values');
  });

  test('an undocumented error status is a gap (annotated), an undocumented success status is a violation', () => {
    // getBook documents 400, 404 and 429 but not 409
    const gap = check(closed, 'GET', `/api/v1/books/${ID}`, 409, problem('duplicate', 409, `/api/v1/books/${ID}`), 'application/problem+json');
    expect(gap.violations).toEqual([]);
    expect(gap.gaps.join()).toContain('409');
    const wrong = check(closed, 'POST', '/api/v1/books', 200, book);
    expect(wrong.violations.join()).toContain('does not document');
  });

  test('429 is documented on API operations and must carry Retry-After (SPEC Decisions 4)', () => {
    const p = problem('rate-limited', 429, '/api/v1/members/me');
    expect(closed.isDocumented('GET', '/api/v1/members/me', 429)).toBe(true);
    expect(closed.isDocumented('GET', '/health/ready', 429)).toBe(false);
    expect(check(closed, 'GET', '/api/v1/members/me', 429, p, 'application/problem+json', { 'retry-after': '12' }).violations).toEqual([]);
    expect(check(closed, 'GET', '/api/v1/members/me', 429, p, 'application/problem+json').violations.join()).toContain('Retry-After');
  });

  test('400 is documented on every list endpoint (SPEC Decisions 4)', () => {
    for (const path of ['/api/v1/books', '/api/v1/authors', '/api/v1/members', '/api/v1/loans', '/api/v2/loans', '/api/v1/reservations']) {
      expect(closed.isDocumented('GET', path, 400), path).toBe(true);
    }
  });

  test('nullable fields must be present (null), never omitted (SPEC Decisions 5)', () => {
    const { description: _d, ...omitted } = book;
    const r = check(closed, 'GET', `/api/v1/books/${ID}`, 200, omitted, 'application/json', { etag: '"3"' });
    expect(r.violations.join()).toContain("must have required property 'description'");
    const loanV1 = { id: ID, bookId: ID, copyId: ID, memberId: ID, status: 'ACTIVE', borrowedAt: T, dueAt: T };
    const v1 = check(closed, 'GET', `/api/v1/loans/${ID}`, 200, loanV1).violations.join();
    expect(v1).toContain('returnedAt');
    expect(v1).toContain('feeCents');
  });

  test('the new member status endpoint validates against the Member schema', () => {
    const member = { id: ID, email: 'a@b.test', name: 'A', role: 'MEMBER', status: 'SUSPENDED', maxActiveLoans: 3, activeLoans: 0, createdAt: T };
    expect(check(closed, 'PUT', `/api/v1/members/${ID}/status`, 200, member).violations).toEqual([]);
    expect(check(closed, 'PUT', `/api/v1/members/${ID}/status`, 200, { ...member, status: 'BANNED' }).violations.join()).toContain('allowed values');
  });

  test('204 and 304 must not have a body', () => {
    expect(check(closed, 'DELETE', `/api/v1/books/${ID}`, 204, undefined, undefined).violations).toEqual([]);
    expect(check(closed, 'DELETE', `/api/v1/books/${ID}`, 204, { ok: true }).violations.join()).toContain('empty');
  });

  test('validates inline schemas (copies list) and nested objects (Loan.book)', () => {
    const copies = { data: [{ id: ID, bookId: ID, barcode: 'CC-1', status: 'MISSING', createdAt: T }] };
    expect(check(closed, 'GET', `/api/v1/books/${ID}/copies`, 200, copies).violations.join()).toContain('allowed values');
    const loan = {
      id: ID, book: { id: ID, title: 't', isbn: '9780132350884', extra: 1 }, copy: { id: ID, barcode: 'CC-1' }, memberId: ID,
      status: 'ACTIVE', borrowedAt: T, dueAt: T, overdueDays: 0, fee: null,
    };
    expect(check(closed, 'GET', `/api/v2/loans/${ID}`, 200, loan).violations.join()).toContain('extra');
  });

  test('errors on routes outside the contract must still be problem documents', () => {
    expect(check(closed, 'GET', '/nope', 404, { error: 'Not Found' }).violations.join()).toContain('problem+json');
    expect(check(closed, 'GET', '/nope', 404, problem('not-found', 404, '/nope'), 'application/problem+json').violations).toEqual([]);
  });
});

test.describe('SPEC invariants', () => {
  const base = (over: Partial<ExchangeUnderTest>): ExchangeUnderTest => ({
    method: 'GET', path: '/api/v1/books', status: 200, contentType: 'application/json', body: {}, sentRequestId: 'req-12345678',
    headers: { 'x-request-id': 'req-12345678', 'ratelimit-limit': '120', 'ratelimit-remaining': '119', 'ratelimit-reset': '30' },
    ...over,
  });

  test('a well-behaved response passes', () => {
    expect(checkSpecInvariants(base({}))).toEqual([]);
  });

  test('X-Request-Id must be echoed, or be a UUID when the client sent an invalid one', () => {
    expect(checkSpecInvariants(base({ headers: { ...base({}).headers, 'x-request-id': 'other-id-123' } })).join()).toContain('echoed');
    expect(checkSpecInvariants(base({ sentRequestId: 'bad', headers: { ...base({}).headers, 'x-request-id': 'bad' } })).join()).toContain('UUID');
  });

  test('RateLimit headers are required on /api routes but not on /health', () => {
    expect(checkSpecInvariants(base({ headers: { 'x-request-id': 'req-12345678' } })).join()).toContain('ratelimit-limit');
    expect(checkSpecInvariants(base({ path: '/health/live', headers: { 'x-request-id': 'req-12345678' } }))).toEqual([]);
  });

  test('v1 loans need Deprecation, Sunset and Link; other routes must not be deprecated', () => {
    expect(checkSpecInvariants(base({ path: '/api/v1/loans' })).join()).toContain('Deprecation');
    const h = { ...base({}).headers, deprecation: '@1767225600', sunset: 'Thu, 31 Dec 2026 23:59:59 GMT', link: '</api/v2/loans>; rel="successor-version"' };
    expect(checkSpecInvariants(base({ path: '/api/v1/loans/x', headers: h }))).toEqual([]);
    expect(checkSpecInvariants(base({ path: '/api/v2/loans', headers: h })).join()).toContain('only /api/v1/loans');
  });

  test('problems: code/status pairing, type URI, instance, requestId, 401 challenge, stack traces', () => {
    const err = (body: object, status = 409, extra: Record<string, string> = {}) =>
      checkSpecInvariants(base({ status, contentType: 'application/problem+json', body, headers: { ...base({}).headers, ...extra } })).join('\n');

    expect(err(problem('duplicate', 409, '/api/v1/books'))).toBe('');
    expect(err(problem('duplicate', 400, '/api/v1/books'), 400)).toContain('must use HTTP 409');
    expect(err({ ...problem('duplicate', 409, '/api/v1/books'), type: 'about:blank' })).toContain('problem.type');
    expect(err({ ...problem('duplicate', 409, '/api/v1/books'), instance: '/api/v1/books?x=1' })).toContain('instance');
    expect(err({ ...problem('duplicate', 409, '/api/v1/books'), requestId: 'nope' })).toContain('requestId');
    expect(err(problem('unauthorized', 401, '/api/v1/books'), 401)).toContain('WWW-Authenticate');
    expect(err({ ...problem('internal', 500, '/api/v1/books'), detail: 'java.lang.NullPointerException: x\n at com.example.Foo.bar(Foo.java:42)' }, 500)).toContain('leaks');
    expect(checkSpecInvariants(base({ status: 404, contentType: 'application/json', body: {} })).join()).toContain('problem+json');
  });

  test('problem titles must be exactly the SPEC table entry (Decisions 7)', () => {
    const body = { ...problem('not-found', 404, '/api/v1/books'), title: 'Not Found' };
    const v = checkSpecInvariants(base({ status: 404, contentType: 'application/problem+json', body })).join();
    expect(v).toContain('must be "Resource not found"');
  });

  test('the SPEC title table covers exactly the codes in the contract enum', () => {
    const components = closed.document.components as { schemas: { Problem: { properties: { code: { enum: string[] } } } } };
    expect(Object.keys(PROBLEM_CATALOGUE).sort()).toEqual([...components.schemas.Problem.properties.code.enum].sort());
  });
});

test.describe('test data generators', () => {
  test('ISBN-13 check digit matches known books', () => {
    for (const known of ['9780132350884', '9781449373320', '9780321125217', '9780321146533', '9788652117895']) {
      expect(gen.isValidIsbn13(known), known).toBe(true);
    }
  });

  test('generated ISBNs are valid, distinct, and the "wrong" variant is invalid', () => {
    const many = Array.from({ length: 1000 }, gen.isbn);
    expect(many.every(gen.isValidIsbn13)).toBe(true);
    expect(new Set(many).size).toBe(many.length);
    expect(many.map(gen.withWrongCheckDigit).some(gen.isValidIsbn13)).toBe(false);
  });

  test('barcodes match the contract pattern; e-mails and tags are unique', () => {
    const barcodes = Array.from({ length: 200 }, () => gen.barcode());
    expect(barcodes.every((b) => /^[A-Z0-9-]{4,32}$/.test(b))).toBe(true);
    expect(new Set(barcodes).size).toBe(200);
    expect(new Set(Array.from({ length: 200 }, () => gen.email())).size).toBe(200);
  });

  test('JWT helpers: sign, decode and tamper', () => {
    const token = signHs256({ sub: 'x', role: 'MEMBER' }, 'secret');
    expect(decodeJwt(token).claims).toEqual({ sub: 'x', role: 'MEMBER' });
    const tampered = withTamperedClaims(token, { role: 'LIBRARIAN' });
    expect(decodeJwt(tampered).claims.role).toBe('LIBRARIAN');
    expect(tampered.split('.')[2]).toBe(token.split('.')[2]);
  });
});
