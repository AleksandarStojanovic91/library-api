import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestApp } from './support/test-app';

const DAY = 86_400;
/** 15.5 days: a loan made "now" is 1.5 days overdue on the time-travel instance (LOAN_DAYS = 14). */
const FUTURE_OFFSET = 15.5 * DAY;

let t: TestApp;
let future: TestApp;
beforeAll(async () => {
  t = await TestApp.start();
  future = await t.startSibling({ CLOCK_OFFSET_SECONDS: String(FUTURE_OFFSET) });
});
afterAll(async () => {
  await future.close();
  await t.close();
});

describe('borrow and return', () => {
  it('borrows an AVAILABLE copy for 14 days and returns it on time without a fee', async () => {
    const member = await t.newMember();
    const book = await t.newBook({ copies: 1 });

    const loan = await t.borrow(member.token, book.id);
    expect(loan.status).toBe(201);
    expect(loan.header('location')).toBe(`/api/v2/loans/${loan.body.id}`);
    expect(loan.body).toMatchObject({ book: { id: book.id }, memberId: member.id, status: 'ACTIVE', overdueDays: 0, fee: null, returnedAt: null });
    expect(Date.parse(loan.body.dueAt) - Date.parse(loan.body.borrowedAt)).toBe(14 * DAY * 1000);
    expect((await t.request('GET', `/api/v1/books/${book.id}`)).body.availableCopies).toBe(0);
    expect((await t.request('GET', '/api/v1/members/me', { token: member.token })).body.activeLoans).toBe(1);

    const returned = await t.request('POST', `/api/v2/loans/${loan.body.id}/return`, { token: member.token });
    expect(returned.status).toBe(200);
    expect(returned.body).toMatchObject({ status: 'RETURNED', fee: null, overdueDays: 0 });
    expect((await t.request('GET', `/api/v1/books/${book.id}`)).body.availableCopies).toBe(1);
    expect((await t.request('GET', '/api/v1/members/me', { token: member.token })).body.activeLoans).toBe(0);

    const again = await t.request('POST', `/api/v2/loans/${loan.body.id}/return`, { token: member.token });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('already-returned');
  });

  it('a librarian may return any loan', async () => {
    const member = await t.newMember();
    const book = await t.newBook({ copies: 1 });
    const loan = await t.borrow(member.token, book.id);
    expect((await t.request('POST', `/api/v2/loans/${loan.body.id}/return`, { token: await t.librarian() })).status).toBe(200);
  });

  it('enforces the loan limit', async () => {
    const member = await t.newMember({ maxActiveLoans: 1 });
    const book = await t.newBook({ copies: 2 });
    expect((await t.borrow(member.token, book.id)).status).toBe(201);
    const second = await t.borrow(member.token, book.id);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('loan-limit-reached');
  });

  it('409 no-copy-available with the documented detail', async () => {
    const member = await t.newMember();
    const book = await t.newBook();
    const res = await t.borrow(member.token, book.id);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'no-copy-available',
      detail: 'No copy of this book is available. You can reserve it with POST /api/v1/reservations.',
    });
  });
});

describe('time travel (CLOCK_OFFSET_SECONDS)', () => {
  it('an open loan is OVERDUE in the future with whole overdue days and a projected fee (v2)', async () => {
    const member = await t.newMember();
    const book = await t.newBook({ copies: 1 });
    const loan = await t.borrow(member.token, book.id);
    const token = await future.login(member.email, 'password-1234');

    const later = await future.request('GET', `/api/v2/loans/${loan.body.id}`, { token });
    expect(later.body).toMatchObject({ status: 'OVERDUE', overdueDays: 1, fee: { amount: '1.00', currency: 'EUR' } });
    // v1 shows the fee only once the loan is returned
    expect((await future.request('GET', `/api/v1/loans/${loan.body.id}`, { token })).body).toMatchObject({ status: 'OVERDUE', feeCents: null });
    expect((await t.request('GET', `/api/v2/loans/${loan.body.id}`, { token: member.token })).body).toMatchObject({ status: 'ACTIVE', fee: null });
  });

  it('returning late charges 50 cents per started day', async () => {
    const member = await t.newMember();
    const book = await t.newBook({ copies: 1 });
    const loan = await t.borrow(member.token, book.id);
    const token = await future.login(member.email, 'password-1234');

    const returned = await future.request('POST', `/api/v1/loans/${loan.body.id}/return`, { token });
    expect(returned.body).toMatchObject({ status: 'RETURNED', feeCents: 100 });
    const v2 = await t.request('GET', `/api/v2/loans/${loan.body.id}`, { token: member.token });
    expect(v2.body).toMatchObject({ status: 'RETURNED', overdueDays: 1, fee: { amount: '1.00', currency: 'EUR' } });
  });

  it('?status=OVERDUE is evaluated in SQL against the shifted clock', async () => {
    const member = await t.newMember();
    const book = await t.newBook({ copies: 1 });
    const loan = await t.borrow(member.token, book.id);
    const token = await future.login(member.email, 'password-1234');
    expect((await future.request('GET', '/api/v2/loans?status=OVERDUE', { token })).body.data.map((l: { id: string }) => l.id)).toEqual([loan.body.id]);
    expect((await future.request('GET', '/api/v2/loans?status=ACTIVE', { token })).body.data).toEqual([]);
    expect((await t.request('GET', '/api/v2/loans?status=OVERDUE', { token: member.token })).body.data).toEqual([]);
  });

  it('the overdue scan notifies each overdue loan once (outbox -> notifications)', async () => {
    const member = await t.newMember();
    const book = await t.newBook({ copies: 1 });
    await t.borrow(member.token, book.id);
    await future.runWorker();
    await future.runWorker();
    const kinds = await future.query('SELECT kind FROM notifications WHERE member_id = $1 ORDER BY outbox_id', [member.id]);
    expect(kinds.map((r) => r.kind)).toEqual(['loan.created', 'loan.overdue']);
  });
});

describe('API versions', () => {
  it('v1 is flat with feeCents and carries Deprecation, Sunset and Link, also on errors', async () => {
    const member = await t.newMember();
    const book = await t.newBook({ copies: 1 });
    const loan = await t.borrow(member.token, book.id, { version: 'v1' });
    expect(loan.status).toBe(201);
    expect(Object.keys(loan.body).sort()).toEqual(['bookId', 'borrowedAt', 'copyId', 'dueAt', 'feeCents', 'id', 'memberId', 'returnedAt', 'status']);
    for (const res of [loan, await t.request('GET', '/api/v1/loans/00000000-0000-4000-8000-0000000000ff', { token: member.token })]) {
      expect(res.header('deprecation')).toBe('@1767225600');
      expect(res.header('sunset')).toBe('Thu, 31 Dec 2026 23:59:59 GMT');
      expect(res.header('link')).toBe('</api/v2/loans>; rel="successor-version"');
    }
    const v2 = await t.request('GET', `/api/v2/loans/${loan.body.id}`, { token: member.token });
    expect(v2.header('deprecation')).toBeUndefined();
    expect(v2.body.copy.barcode).toMatch(/^T-/);
  });
});

describe('idempotency', () => {
  it('replays the stored response for the same key and body', async () => {
    const member = await t.newMember();
    const book = await t.newBook({ copies: 2 });
    const key = randomUUID();
    const first = await t.borrow(member.token, book.id, { key });
    const replay = await t.borrow(member.token, book.id, { key });
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.header('location')).toBe(first.header('location'));
    expect(replay.header('idempotent-replayed')).toBe('true');
    expect(first.header('idempotent-replayed')).toBeUndefined();
    expect((await t.request('GET', `/api/v1/books/${book.id}`)).body.availableCopies).toBe(1);
  });

  it('422 when the key is reused with a different body', async () => {
    const member = await t.newMember();
    const [a, b] = [await t.newBook({ copies: 1 }), await t.newBook({ copies: 1 })];
    const key = randomUUID();
    await t.borrow(member.token, a.id, { key });
    const res = await t.borrow(member.token, b.id, { key });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('idempotency-key-reused');
  });

  it('stores 4xx responses too: the retry gets the same 409 even after a copy appears', async () => {
    const member = await t.newMember();
    const book = await t.newBook();
    const key = randomUUID();
    expect((await t.borrow(member.token, book.id, { key })).body.code).toBe('no-copy-available');
    await t.request('POST', `/api/v1/books/${book.id}/copies`, { token: await t.librarian(), body: { barcode: `I-${key.slice(0, 8).toUpperCase()}` } });
    const retry = await t.borrow(member.token, book.id, { key });
    expect(retry.status).toBe(409);
    expect(retry.header('idempotent-replayed')).toBe('true');
    expect(retry.body.requestId).toBe(retry.header('x-request-id'));
  });

  it('keys are scoped per caller', async () => {
    const [alice, bob] = [await t.newMember(), await t.newMember()];
    const book = await t.newBook({ copies: 2 });
    const key = randomUUID();
    const a = await t.borrow(alice.token, book.id, { key });
    const b = await t.borrow(bob.token, book.id, { key });
    expect(b.status).toBe(201);
    expect(b.body.id).not.toBe(a.body.id);
  });

  it('a missing or too short Idempotency-Key is 400', async () => {
    const member = await t.newMember();
    const book = await t.newBook({ copies: 1 });
    const missing = await t.request('POST', '/api/v2/loans', { token: member.token, body: { bookId: book.id } });
    expect(missing.status).toBe(400);
    expect(missing.body.errors[0].field).toBe('Idempotency-Key');
    expect((await t.borrow(member.token, book.id, { key: 'short' })).status).toBe(400);
  });
});
