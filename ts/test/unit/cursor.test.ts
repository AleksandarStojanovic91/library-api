import { describe, expect, it } from 'vitest';
import { decodeCursor, decodeCursorVariant, encodeCursor, type FieldCheck, isDecimalText, isInteger, isLiteral, isString, isTimestamp, isUuid } from '../../src/domain/shared/cursor';
import { DomainError } from '../../src/domain/shared/domain-error';

const ID = '20000000-0000-4000-8000-000000000001';

describe('cursor codec', () => {
  it('is base64url JSON of the sort key and id (the SPEC example)', () => {
    const cursor = encodeCursor({ t: 'clean code', id: ID });
    expect(cursor).not.toMatch(/[+/=]/);
    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString())).toEqual({ t: 'clean code', id: ID });
  });

  it('round-trips', () => {
    const cursor = encodeCursor({ y: 2008, id: ID });
    expect(decodeCursor(cursor, { y: isInteger, id: isUuid })).toEqual({ y: 2008, id: ID });
  });

  it('keeps microsecond timestamps and float text exactly', () => {
    const payload = { c: '2026-10-13T09:15:00.123456Z', r: '0.0607927', id: ID };
    expect(decodeCursor(encodeCursor(payload), { c: isTimestamp, r: isDecimalText, id: isUuid })).toEqual(payload);
  });

  it.each([
    ['not base64 JSON', 'not-a-cursor'],
    ['an array', encodeCursor({}).replace(/.*/, Buffer.from('[1]').toString('base64url'))],
    ['a missing field', encodeCursor({ id: ID })],
    ['an extra field', encodeCursor({ t: 'x', id: ID, evil: 1 })],
    ['a wrong type', encodeCursor({ t: 42, id: ID })],
    ['a non-uuid id', encodeCursor({ t: 'x', id: "1' OR 1=1" })],
  ])('rejects %s with a 400 validation error on "cursor"', (_, cursor) => {
    try {
      decodeCursor(cursor, { t: isString, id: isUuid });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('validation-failed');
      expect((error as DomainError).fieldErrors[0]?.field).toBe('cursor');
    }
  });

  it('picks the matching shape when several are allowed (full text vs trigram search)', () => {
    const shapes: Record<string, FieldCheck>[] = [
      { m: isLiteral('fts'), r: isDecimalText, id: isUuid },
      { m: isLiteral('trgm'), s: isDecimalText, id: isUuid },
    ];
    expect(decodeCursorVariant(encodeCursor({ m: 'trgm', s: '0.5', id: ID }), shapes)).toEqual({ m: 'trgm', s: '0.5', id: ID });
    expect(() => decodeCursorVariant(encodeCursor({ m: 'other', s: '0.5', id: ID }), shapes)).toThrow(DomainError);
  });
});
