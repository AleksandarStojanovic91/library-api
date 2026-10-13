import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestApp } from './support/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await TestApp.start({ DATABASE_POOL_MAX: '25' });
});
afterAll(() => t.close());

describe('concurrency', () => {
  it('20 parallel borrows of a book with 2 copies: exactly 2 succeed, on different copies', async () => {
    const book = await t.newBook({ copies: 2 });
    const members = await Promise.all(Array.from({ length: 20 }, () => t.newMember()));

    const results = await Promise.all(members.map((m) => t.borrow(m.token, book.id)));

    const created = results.filter((r) => r.status === 201);
    expect(created).toHaveLength(2);
    expect(new Set(created.map((r) => r.body.copy.id)).size).toBe(2);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'no-copy-available')).toBe(true);
    const [row] = await t.query<{ open: number }>('SELECT count(*)::int AS open FROM loans WHERE book_id = $1 AND returned_at IS NULL', [book.id]);
    expect(row?.open).toBe(2);
  });

  it('the same Idempotency-Key sent 10 times at once creates exactly one loan; the rest replay it', async () => {
    const member = await t.newMember();
    const book = await t.newBook({ copies: 3 });
    const key = randomUUID();

    const results = await Promise.all(Array.from({ length: 10 }, () => t.borrow(member.token, book.id, { key })));

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(results.filter((r) => r.header('idempotent-replayed') === 'true')).toHaveLength(9);
    const [row] = await t.query<{ loans: number }>('SELECT count(*)::int AS loans FROM loans WHERE book_id = $1', [book.id]);
    expect(row?.loans).toBe(1);
  });

  it('parallel borrows by one member never exceed the loan limit', async () => {
    const member = await t.newMember({ maxActiveLoans: 2 });
    const books = await Promise.all(Array.from({ length: 6 }, () => t.newBook({ copies: 1 })));
    const results = await Promise.all(books.map((b) => t.borrow(member.token, b.id)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.body.code === 'loan-limit-reached')).toHaveLength(4);
  });

  it('racing returns and reservations never leave a WAITING reservation next to an AVAILABLE copy', async () => {
    for (let round = 0; round < 5; round++) {
      const [borrower, reserver] = [await t.newMember(), await t.newMember()];
      const book = await t.newBook({ copies: 1 });
      const loan = await t.borrow(borrower.token, book.id);
      await Promise.all([
        t.request('POST', `/api/v2/loans/${loan.body.id}/return`, { token: borrower.token }),
        t.request('POST', '/api/v1/reservations', { token: reserver.token, body: { bookId: book.id } }),
      ]);
      const [state] = await t.query<{ waiting: number; available: number }>(
        `SELECT (SELECT count(*)::int FROM reservations WHERE book_id = $1 AND status = 'WAITING') AS waiting,
                (SELECT count(*)::int FROM copies WHERE book_id = $1 AND status = 'AVAILABLE') AS available`,
        [book.id],
      );
      expect(state!.waiting > 0 && state!.available > 0).toBe(false);
    }
  });
});
