/**
 * Time travel: READY reservations expire after RESERVATION_HOLD_HOURS.
 *
 * The reservation becomes READY on the present instance (readyUntil = now + 48 h). The future instance's
 * background worker (every WORKER_INTERVAL_MS) sees readyUntil < its "now", marks it EXPIRED and passes the held
 * copy to the next WAITING reservation, or makes it AVAILABLE. We poll until that happens.
 */
import { config } from '../../src/config';
import type { LibraryApi } from '../../src/client/library-api';
import { expect, test } from '../../src/fixtures';

const statusOf = async (librarian: LibraryApi, bookId: string, id: string) =>
  (await librarian.reservations.list({ bookId })).body.data.find((r) => r.id === id);

test.describe('time travel: reservation expiry', () => {
  test.skip(!config.overdueBaseUrl, 'OVERDUE_BASE_URL is not set (see api-tests/README.md, "Time travel")');

  test.beforeAll(() => {
    if (config.overdueBaseUrl && config.overdueOffsetSeconds <= config.reservationHoldHours * 3600)
      throw new Error('OVERDUE_OFFSET_SECONDS must be larger than RESERVATION_HOLD_HOURS');
  });

  test('an expired READY reservation passes the held copy to the next in line', async ({ factory, future, librarian }) => {
    const [borrower, first, second] = await factory.members(3);
    const { book, copies } = await factory.book({ copies: 1 });
    const loan = await factory.loan(borrower, book.id);
    const r1 = (await first.api.reservations.create({ bookId: book.id })).body;
    const r2 = (await second.api.reservations.create({ bookId: book.id })).body;
    expect(await borrower.api.loans.return(loan.id)).toHaveStatus(200);
    expect((await statusOf(librarian, book.id, r1.id))?.status).toBe('READY');

    await expect
      .poll(async () => (await statusOf(future.librarian, book.id, r1.id))?.status, { timeout: 30_000, intervals: [500, 1000, 2000] })
      .toBe('EXPIRED');

    const next = await statusOf(future.librarian, book.id, r2.id);
    expect(next).toMatchObject({ status: 'READY', heldCopyId: copies[0]!.id });
    // the new hold is counted from the future instance's "now", so it is not immediately expired again
    expect(Date.parse(next!.readyUntil!)).toBeGreaterThan(Date.now() + config.overdueOffsetSeconds * 1000);
  });

  test('an expired READY reservation with nobody waiting makes the copy AVAILABLE (and evicts the cache)', async ({ factory, future, anon }) => {
    const [borrower, holder] = await factory.members(2);
    const { book } = await factory.book({ copies: 1 });
    const loan = await factory.loan(borrower, book.id);
    const r = (await holder.api.reservations.create({ bookId: book.id })).body;
    await borrower.api.loans.return(loan.id);
    await anon.books.get(book.id); // put availableCopies = 0 into the cache

    await expect
      .poll(async () => (await statusOf(future.librarian, book.id, r.id))?.status, { timeout: 30_000, intervals: [500, 1000, 2000] })
      .toBe('EXPIRED');

    expect((await future.anon.copies.list(book.id)).body.data[0]!.status).toBe('AVAILABLE');
    expect((await anon.books.get(book.id)).body.availableCopies).toBe(1);
  });
});
