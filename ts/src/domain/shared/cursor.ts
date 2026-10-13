import { DomainError } from './domain-error';

/**
 * Keyset pagination cursor: base64url(JSON) of the sort key of the last row plus its id.
 * The cursor is opaque to clients; the server validates its shape before using any value in a query.
 */
export type CursorValue = string | number | null;
export type CursorPayload = Readonly<Record<string, CursorValue>>;
export type FieldCheck = (value: unknown) => boolean;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isString: FieldCheck = (v) => typeof v === 'string' && v.length <= 1000;
export const isUuid: FieldCheck = (v) => typeof v === 'string' && UUID.test(v);
export const isInteger: FieldCheck = (v) => typeof v === 'number' && Number.isSafeInteger(v);
/** Timestamps are carried as text with microsecond precision, see the repositories. */
export const isTimestamp: FieldCheck = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
/** Floats (search rank) are carried as the exact text Postgres printed, so they round-trip losslessly. */
export const isDecimalText: FieldCheck = (v) => typeof v === 'string' && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(v);
export const isLiteral =
  (literal: string): FieldCheck =>
  (v) =>
    v === literal;
export const nullable =
  (check: FieldCheck): FieldCheck =>
  (v) =>
    v === null || check(v);

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function invalidCursor(): DomainError {
  return DomainError.validation([{ field: 'cursor', message: 'Cursor is malformed or does not belong to this query' }]);
}

/** Decodes a cursor and checks it has exactly the expected fields; anything else is a 400. */
export function decodeCursor<T extends CursorPayload>(cursor: string, shape: Record<keyof T & string, FieldCheck>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalidCursor();
  }
  const record = parsed as Record<string, unknown>;
  const expected = Object.keys(shape);
  const actual = Object.keys(record);
  if (actual.length !== expected.length || !expected.every((key) => key in record && shape[key as keyof T & string](record[key]))) {
    throw invalidCursor();
  }
  return record as T;
}

/** Tries several cursor shapes in order (e.g. full-text vs trigram search) and returns the first match. */
export function decodeCursorVariant<T extends CursorPayload>(
  cursor: string,
  shapes: ReadonlyArray<Record<string, FieldCheck>>,
): T {
  for (const shape of shapes) {
    try {
      return decodeCursor<T>(cursor, shape);
    } catch {
      // try the next shape
    }
  }
  throw invalidCursor();
}
