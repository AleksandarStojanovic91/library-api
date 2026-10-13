import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestApp } from './support/test-app';

/** 49 hours: past the 48 h hold of a reservation made "now". */
const AFTER_HOLD = 49 * 3600;

let t: TestApp;
beforeAll(async () => {
  t = await TestApp.start();
});
afterAll(() => t.close());

const reserve = (token: string, bookId: string) => t.request('POST', '/api/v1/reservations', { token, body: { bookId } });
const reservationsOf = async (bookId: string) =>
  (await t.request('GET', `/api/v1/reservations?bookId=${bookId}`, { token: await t.librarian() })).body.data as {
    id: string;
    memberId: string;
    status: string;
    position: number | null;
    heldCopyId: string | null;
    readyUntil: string | null;
  }[];

describe('reservation queue', () => {
  it('no copy -> reserve -> return puts the copy on hold -> only the reserver can borrow it', async () => {
    const [borrower, reserver, other] = [await t.newMember(), await t.newMember(), await t.newMember()];
    const book = await t.newBook({ copies: 1 });
    const loan = await t.borrow(borrower.token, book.id);
    expect((await t.borrow(reserver.token, book.id)).body.code).toBe('no-copy-available');

    const reservation = await reserve(reserver.token, book.id);
    expect(reservation.status).toBe(201);
    expect(reservation.header('location')).toBe(`/api/v1/reservations/${reservation.body.id}`);
    expect(reservation.body).toMatchObject({ status: 'WAITING', position: 1, heldCopyId: null, readyUntil: null });

    await t.request('POST', `/api/v2/loans/${loan.body.id}/return`, { token: borrower.token });
    const [ready] = await reservationsOf(book.id);
    expect(ready).toMatchObject({ status: 'READY', position: null, heldCopyId: loan.body.copy.id });
    expect(Date.parse(ready!.readyUntil!) - Date.now()).toBeGreaterThan(47 * 3600 * 1000);
    expect((await t.request('GET', `/api/v1/books/${book.id}`)).body.availableCopies).toBe(0);

    expect((await t.borrow(other.token, book.id)).body.code).toBe('no-copy-available');
    const held = await t.borrow(reserver.token, book.id);
    expect(held.status).toBe(201);
    expect(held.body.copy.id).toBe(loan.body.copy.id);
    expect((await reservationsOf(book.id))[0]?.status).toBe('FULFILLED');
  });

  it('positions count earlier WAITING reservations (FIFO)', async () => {
    const [borrower, first, second] = [await t.newMember(), await t.newMember(), await t.newMember()];
    const book = await t.newBook({ copies: 1 });
    await t.borrow(borrower.token, book.id);
    expect((await reserve(first.token, book.id)).body.position).toBe(1);
    expect((await reserve(second.token, book.id)).body.position).toBe(2);
  });

  it('409 copy-available when a copy is on the shelf, 409 already-reserved for a second reservation', async () => {
    const [borrower, member] = [await t.newMember(), await t.newMember()];
    const book = await t.newBook({ copies: 1 });
    expect((await reserve(member.token, book.id)).body.code).toBe('copy-available');
    await t.borrow(borrower.token, book.id);
    expect((await reserve(member.token, book.id)).status).toBe(201);
    expect((await reserve(member.token, book.id)).body.code).toBe('already-reserved');
  });

  it('cancelling a READY reservation passes the copy to the next in line', async () => {
    const [borrower, first, second] = [await t.newMember(), await t.newMember(), await t.newMember()];
    const book = await t.newBook({ copies: 1 });
    const loan = await t.borrow(borrower.token, book.id);
    const r1 = await reserve(first.token, book.id);
    await reserve(second.token, book.id);
    await t.request('POST', `/api/v2/loans/${loan.body.id}/return`, { token: borrower.token });

    expect((await t.request('DELETE', `/api/v1/reservations/${r1.body.id}`, { token: second.token })).status).toBe(404);
    expect((await t.request('DELETE', `/api/v1/reservations/${r1.body.id}`, { token: first.token })).status).toBe(204);
    const queue = await reservationsOf(book.id);
    expect(queue.map((r) => r.status)).toEqual(['CANCELLED', 'READY']);
    expect(queue[1]?.memberId).toBe(second.id);

    const again = await t.request('DELETE', `/api/v1/reservations/${r1.body.id}`, { token: first.token });
    expect(again.body.code).toBe('reservation-not-cancellable');
  });

  it('cancelling the last READY reservation puts the copy back on the shelf', async () => {
    const [borrower, member] = [await t.newMember(), await t.newMember()];
    const book = await t.newBook({ copies: 1 });
    const loan = await t.borrow(borrower.token, book.id);
    const r = await reserve(member.token, book.id);
    await t.request('POST', `/api/v2/loans/${loan.body.id}/return`, { token: borrower.token });
    await t.request('DELETE', `/api/v1/reservations/${r.body.id}`, { token: member.token });
    expect((await t.request('GET', `/api/v1/books/${book.id}`)).body.availableCopies).toBe(1);
  });

  it('members only see their own reservations', async () => {
    const [borrower, a, b] = [await t.newMember(), await t.newMember(), await t.newMember()];
    const book = await t.newBook({ copies: 1 });
    await t.borrow(borrower.token, book.id);
    await reserve(a.token, book.id);
    await reserve(b.token, book.id);
    const seen = await t.request('GET', `/api/v1/reservations?memberId=${b.id}`, { token: a.token });
    expect(seen.body.data.map((r: { memberId: string }) => r.memberId)).toEqual([a.id]);
  });
});

describe('hold expiry (worker on a time-shifted instance)', () => {
  it('an expired hold becomes EXPIRED and the copy goes to the next reservation, with outbox events', async () => {
    const future = await t.startSibling({ CLOCK_OFFSET_SECONDS: String(AFTER_HOLD) });
    try {
      const [borrower, first, second] = [await t.newMember(), await t.newMember(), await t.newMember()];
      const book = await t.newBook({ copies: 1 });
      const loan = await t.borrow(borrower.token, book.id);
      await reserve(first.token, book.id);
      await reserve(second.token, book.id);
      await t.request('POST', `/api/v2/loans/${loan.body.id}/return`, { token: borrower.token });

      await t.runWorker(); // present: nothing has expired yet
      expect((await reservationsOf(book.id)).map((r) => r.status)).toEqual(['READY', 'WAITING']);

      await future.runWorker();
      const queue = await reservationsOf(book.id);
      expect(queue.map((r) => r.status)).toEqual(['EXPIRED', 'READY']);
      expect(queue[1]?.heldCopyId).toBe(loan.body.copy.id);

      const events = await t.query(
        `SELECT n.kind, n.member_id FROM notifications n JOIN outbox o ON o.id = n.outbox_id
          WHERE o.payload->>'bookId' = $1 AND n.kind LIKE 'reservation.%' ORDER BY n.outbox_id`,
        [book.id],
      );
      expect(events).toEqual([
        { kind: 'reservation.ready', member_id: first.id },
        { kind: 'reservation.expired', member_id: first.id },
        { kind: 'reservation.ready', member_id: second.id },
      ]);
    } finally {
      await future.close();
    }
  });
});
