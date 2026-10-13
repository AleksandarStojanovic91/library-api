/**
 * The reservation queue: FIFO positions, a returned copy is held (READY) for the first in line, only that member
 * can borrow it, and cancelling a READY reservation passes the copy on.
 */
import { config, MISSING_ID } from '../../src/config';
import type { LibraryApi, Reservation } from '../../src/client/library-api';
import type { TestDataFactory } from '../../src/data/factory';
import { expect, test } from '../../src/fixtures';

/** A book with one copy that is out on loan, so it can be reserved. */
async function lentOutBook(factory: TestDataFactory) {
  const borrower = await factory.member();
  const { book, copies } = await factory.book({ copies: 1 });
  const loan = await factory.loan(borrower, book.id);
  return { book, copy: copies[0]!, borrower, loan };
}

async function queue(librarian: LibraryApi, bookId: string): Promise<Reservation[]> {
  const res = await librarian.reservations.list({ bookId, limit: 100 });
  expect(res).toHaveStatus(200);
  return res.body.data;
}

const statusOf = (list: Reservation[], id: string) => list.find((r) => r.id === id);

test.describe('reservations: queue', () => {
  test('reserving a lent-out book: 201, WAITING, positions 1, 2, 3 in order of arrival', async ({ factory, librarian }) => {
    const { book } = await lentOutBook(factory);
    const [a, b, c] = await factory.members(3);

    const ra = await a.api.reservations.create({ bookId: book.id });
    const rb = await b.api.reservations.create({ bookId: book.id });
    const rc = await c.api.reservations.create({ bookId: book.id });

    expect(ra).toHaveStatus(201);
    expect(ra.header('location')).toMatch(new RegExp(`/api/v1/reservations/${ra.body.id}$`));
    expect(ra.body).toMatchObject({ bookId: book.id, memberId: a.member.id, status: 'WAITING', position: 1 });
    expect(ra.body.heldCopyId).toBeNull();
    expect(ra.body.readyUntil).toBeNull();
    expect(rb.body.position).toBe(2);
    expect(rc.body.position).toBe(3);

    const listed = await queue(librarian, book.id);
    expect(listed.map((r) => [r.id, r.position])).toEqual([
      [ra.body.id, 1],
      [rb.body.id, 2],
      [rc.body.id, 3],
    ]);
  });

  test('cancelling a WAITING reservation moves everyone behind it up', async ({ factory, librarian }) => {
    const { book } = await lentOutBook(factory);
    const [a, b, c] = await factory.members(3);
    const ra = (await a.api.reservations.create({ bookId: book.id })).body;
    const rb = (await b.api.reservations.create({ bookId: book.id })).body;
    const rc = (await c.api.reservations.create({ bookId: book.id })).body;

    expect(await a.api.reservations.cancel(ra.id)).toHaveStatus(204);

    const listed = await queue(librarian, book.id);
    expect(statusOf(listed, ra.id)).toMatchObject({ status: 'CANCELLED' });
    expect(statusOf(listed, ra.id)?.position).toBeNull();
    expect(statusOf(listed, rb.id)?.position).toBe(1);
    expect(statusOf(listed, rc.id)?.position).toBe(2);
  });

  test('a book with an AVAILABLE copy cannot be reserved (409 copy-available)', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    expect(await who.api.reservations.create({ bookId: book.id })).toBeProblem(409, 'copy-available');
  });

  test('one open reservation per member and book (409 already-reserved); after cancelling you may queue again', async ({ factory }) => {
    const { book } = await lentOutBook(factory);
    const who = await factory.member();
    const first = await who.api.reservations.create({ bookId: book.id });
    expect(await who.api.reservations.create({ bookId: book.id })).toBeProblem(409, 'already-reserved');

    expect(await who.api.reservations.cancel(first.body.id)).toHaveStatus(204);
    const again = await who.api.reservations.create({ bookId: book.id });
    expect(again).toHaveStatus(201);
    expect(again.body.position).toBe(1);
  });

  test('an unknown book is 404; a bad body is 400', async ({ factory }) => {
    const who = await factory.member();
    expect(await who.api.reservations.create({ bookId: MISSING_ID })).toBeProblem(404, 'not-found');
    expect(await who.api.http.send('POST', '/api/v1/reservations', { data: { bookId: 'nope' } })).toBeProblem(400, 'validation-failed', { fields: ['bookId'] });
  });

  test('members list only their own reservations', async ({ factory }) => {
    const { book } = await lentOutBook(factory);
    const [a, b] = await factory.members(2);
    const ra = (await a.api.reservations.create({ bookId: book.id })).body;
    await b.api.reservations.create({ bookId: book.id });
    const mine = await a.api.reservations.list();
    expect(mine.body.data.map((r) => r.id)).toEqual([ra.id]);
  });
});

test.describe('reservations: hold, borrow, cancel', () => {
  test('a returned copy is held for the first in line: READY, heldCopyId, readyUntil = now + hold; the next moves to position 1', async ({ factory, librarian, anon }) => {
    const { book, copy, borrower, loan } = await lentOutBook(factory);
    const [first, second] = await factory.members(2);
    const r1 = (await first.api.reservations.create({ bookId: book.id })).body;
    const r2 = (await second.api.reservations.create({ bookId: book.id })).body;

    const before = Date.now();
    expect(await borrower.api.loans.return(loan.id)).toHaveStatus(200);

    const listed = await queue(librarian, book.id);
    const ready = statusOf(listed, r1.id)!;
    expect(ready).toMatchObject({ status: 'READY', heldCopyId: copy.id });
    expect(ready.position).toBeNull();
    const holdMs = config.reservationHoldHours * 3_600_000;
    expect(Math.abs(Date.parse(ready.readyUntil!) - (before + holdMs))).toBeLessThan(5 * 60_000);
    expect(statusOf(listed, r2.id)).toMatchObject({ status: 'WAITING', position: 1 });

    // the held copy is RESERVED and does not count as available
    expect((await anon.copies.list(book.id)).body.data[0]!.status).toBe('RESERVED');
    expect((await anon.books.get(book.id)).body).toMatchObject({ totalCopies: 1, availableCopies: 0 });
  });

  test('only the member the copy is held for can borrow it; their borrow fulfils the reservation', async ({ factory, librarian }) => {
    const { book, copy, borrower, loan } = await lentOutBook(factory);
    const [holder, nextInLine, outsider] = await factory.members(3);
    const held = (await holder.api.reservations.create({ bookId: book.id })).body;
    await nextInLine.api.reservations.create({ bookId: book.id });
    await borrower.api.loans.return(loan.id);

    expect(await nextInLine.api.loans.borrow({ bookId: book.id })).toBeProblem(409, 'no-copy-available');
    expect(await outsider.api.loans.borrow({ bookId: book.id })).toBeProblem(409, 'no-copy-available');
    expect(await librarian.loans.borrow({ bookId: book.id, memberId: outsider.member.id })).toBeProblem(409, 'no-copy-available');

    const res = await holder.api.loans.borrow({ bookId: book.id });
    expect(res).toHaveStatus(201);
    expect(res.body.copy.id).toBe(copy.id);
    expect(statusOf(await queue(librarian, book.id), held.id)?.status).toBe('FULFILLED');
  });

  test('the holder gets the held copy even when another copy is AVAILABLE', async ({ factory, librarian, anon }) => {
    const [b1, b2, holder] = await factory.members(3);
    const { book } = await factory.book({ copies: 2 });
    const l1 = await factory.loan(b1, book.id);
    const l2 = await factory.loan(b2, book.id);
    const held = (await holder.api.reservations.create({ bookId: book.id })).body;

    await b1.api.loans.return(l1.id); // held for `holder`
    await b2.api.loans.return(l2.id); // nobody waiting: AVAILABLE
    expect((await anon.books.get(book.id)).body.availableCopies).toBe(1);

    const res = await holder.api.loans.borrow({ bookId: book.id });
    expect(res).toHaveStatus(201);
    expect(res.body.copy.id).toBe(l1.copy.id);
    expect(statusOf(await queue(librarian, book.id), held.id)?.status).toBe('FULFILLED');
    expect((await anon.books.get(book.id)).body.availableCopies).toBe(1); // the other copy is still free
  });

  test('cancelling a READY reservation passes the held copy to the next in line', async ({ factory, librarian }) => {
    const { book, copy, borrower, loan } = await lentOutBook(factory);
    const [first, second] = await factory.members(2);
    const r1 = (await first.api.reservations.create({ bookId: book.id })).body;
    const r2 = (await second.api.reservations.create({ bookId: book.id })).body;
    await borrower.api.loans.return(loan.id);

    expect(await first.api.reservations.cancel(r1.id)).toHaveStatus(204);

    const listed = await queue(librarian, book.id);
    expect(statusOf(listed, r1.id)?.status).toBe('CANCELLED');
    expect(statusOf(listed, r2.id)).toMatchObject({ status: 'READY', heldCopyId: copy.id });
    expect((await second.api.loans.borrow({ bookId: book.id })).body.copy.id).toBe(copy.id);
  });

  test('cancelling the last READY reservation makes the copy AVAILABLE again', async ({ factory, anon }) => {
    const { book, borrower, loan } = await lentOutBook(factory);
    const holder = await factory.member();
    const r = (await holder.api.reservations.create({ bookId: book.id })).body;
    await borrower.api.loans.return(loan.id);
    expect((await anon.books.get(book.id)).body.availableCopies).toBe(0);

    expect(await holder.api.reservations.cancel(r.id)).toHaveStatus(204);

    expect((await anon.books.get(book.id)).body.availableCopies).toBe(1);
    expect((await anon.copies.list(book.id)).body.data[0]!.status).toBe('AVAILABLE');
  });

  test('only WAITING or READY can be cancelled (409 reservation-not-cancellable)', async ({ factory }) => {
    const { book, borrower, loan } = await lentOutBook(factory);
    const holder = await factory.member();
    const r = (await holder.api.reservations.create({ bookId: book.id })).body;
    expect(await holder.api.reservations.cancel(r.id)).toHaveStatus(204);
    expect(await holder.api.reservations.cancel(r.id)).toBeProblem(409, 'reservation-not-cancellable');

    // FULFILLED cannot be cancelled either
    const r2 = (await holder.api.reservations.create({ bookId: book.id })).body;
    await borrower.api.loans.return(loan.id);
    await factory.loan(holder, book.id);
    expect(await holder.api.reservations.cancel(r2.id)).toBeProblem(409, 'reservation-not-cancellable');
  });

  test('the librarian can cancel anyone\'s reservation; unknown ids are 404', async ({ factory, librarian }) => {
    const { book } = await lentOutBook(factory);
    const who = await factory.member();
    const r = (await who.api.reservations.create({ bookId: book.id })).body;
    expect(await librarian.reservations.cancel(r.id)).toHaveStatus(204);
    expect(await librarian.reservations.cancel(MISSING_ID)).toBeProblem(404, 'not-found');
  });
});
