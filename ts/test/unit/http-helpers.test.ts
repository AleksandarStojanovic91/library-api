import { describe, expect, it } from 'vitest';
import { canonicalJson, requestHash } from '../../src/application/lending/request-hash';
import { ERROR_CODES } from '../../src/domain/shared/domain-error';
import { etagOf, ifNoneMatchMatches, parseIfMatch } from '../../src/interface/http/etag';
import { problemDocument, statusOf } from '../../src/interface/http/problem/problem';

describe('ETags', () => {
  it('formats the version as a strong ETag', () => {
    expect(etagOf(3)).toBe('"3"');
  });

  it('If-Match: missing -> undefined (428), * -> any, strong tags only', () => {
    expect(parseIfMatch(undefined)).toBeUndefined();
    expect(parseIfMatch('  ')).toBeUndefined();
    expect(parseIfMatch('*')).toBe('*');
    expect(parseIfMatch('"3"')).toEqual([3]);
    expect(parseIfMatch('"1", "4"')).toEqual([1, 4]);
    expect(parseIfMatch('W/"3"')).toEqual([]);
    expect(parseIfMatch('garbage')).toEqual([]);
  });

  it('If-None-Match uses weak comparison', () => {
    expect(ifNoneMatchMatches('"3"', 3)).toBe(true);
    expect(ifNoneMatchMatches('W/"3"', 3)).toBe(true);
    expect(ifNoneMatchMatches('"1", "3"', 3)).toBe(true);
    expect(ifNoneMatchMatches('*', 3)).toBe(true);
    expect(ifNoneMatchMatches('"2"', 3)).toBe(false);
    expect(ifNoneMatchMatches(undefined, 3)).toBe(false);
  });
});

describe('idempotency request hash', () => {
  it('canonical JSON sorts keys recursively and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
    expect(canonicalJson(undefined)).toBe('');
  });

  it('is the same for reordered keys and different for another path, method or body', () => {
    const base = requestHash('POST', '/api/v2/loans', { bookId: 'x', memberId: 'y' });
    expect(requestHash('post', '/api/v2/loans', { memberId: 'y', bookId: 'x' })).toBe(base);
    expect(requestHash('POST', '/api/v1/loans', { bookId: 'x', memberId: 'y' })).not.toBe(base);
    expect(requestHash('POST', '/api/v2/loans', { bookId: 'z', memberId: 'y' })).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('problem details', () => {
  it('every code has a fixed status and a title (SPEC Decisions 7)', () => {
    for (const code of ERROR_CODES) {
      const doc = problemDocument({ code, detail: 'd' }, '/x', 'rid-12345678');
      expect(doc.type).toBe(`https://library.example/problems/${code}`);
      expect(doc.title.length).toBeGreaterThan(0);
      expect(doc.status).toBe(statusOf(code));
    }
    expect(problemDocument({ code: 'book-has-loan-history', detail: 'd' }, '/x', 'r').title).toBe('Book has loan history');
  });

  it('only includes `errors` when there are field errors', () => {
    expect(problemDocument({ code: 'validation-failed', detail: 'd' }, '/x', 'r')).not.toHaveProperty('errors');
    expect(problemDocument({ code: 'validation-failed', detail: 'd', errors: [{ field: 'a', message: 'm' }] }, '/x', 'r').errors).toEqual([
      { field: 'a', message: 'm' },
    ]);
  });
});
