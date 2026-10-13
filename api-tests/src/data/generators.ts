/**
 * Unique, valid test data. Values are random enough that parallel workers and repeated runs against the
 * same database do not collide, and readable enough to spot in the service logs.
 */
import { randomInt, randomUUID } from 'node:crypto';

/** ISBN-13 check digit: weights 1,3,1,3,... over the first 12 digits. */
export function isbn13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error(`need 12 digits, got "${first12}"`);
  const sum = [...first12].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidIsbn13(isbn: string): boolean {
  return /^97[89]\d{10}$/.test(isbn) && isbn13CheckDigit(isbn.slice(0, 12)) === Number(isbn[12]);
}

/** A random ISBN-13 with a correct check digit (978 or 979 prefix). */
export function isbn(): string {
  const prefix = randomInt(2) === 0 ? '978' : '979';
  const body = Array.from({ length: 9 }, () => randomInt(10)).join('');
  const first12 = prefix + body;
  return first12 + isbn13CheckDigit(first12);
}

/** Same ISBN with the check digit deliberately wrong. */
export function withWrongCheckDigit(valid: string): string {
  const last = Number(valid[12]);
  return valid.slice(0, 12) + String((last + 1) % 10);
}

/** Copy barcode matching ^[A-Z0-9-]{4,32}$ */
export function barcode(prefix = 'T'): string {
  return `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

export function email(label = 'member'): string {
  return `${label}-${randomUUID()}@test.library.test`;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
/** A made-up lowercase word that will not appear in any other book (for search tests). */
export function word(length = 12): string {
  return Array.from({ length }, () => LETTERS[randomInt(LETTERS.length)]).join('');
}

/** A tag that only the current test uses, so list/filter tests can isolate their own books. */
export function uniqueTag(): string {
  return `t-${randomUUID().slice(0, 18)}`;
}

export function idempotencyKey(): string {
  return randomUUID();
}
