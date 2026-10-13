/**
 * Races the database design has to win (row locks, SKIP LOCKED, unique partial indexes, version checks).
 * Each test fires requests at the same moment and checks the invariant, not the timing.
 */
import { expect, test } from '../../src/fixtures';

test.describe('concurrency', () => {
  test('10 members borrow a book with 2 copies at once: exactly 2 succeed, with different copies', async ({ factory, anon }) => {
    const members = await factory.members(10);
    const { book, copies } = await factory.book({ copies: 2 });

    const results = await Promise.all(members.map((m) => m.api.loans.borrow({ bookId: book.id })));

    const won = results.filter((r) => r.status === 201);
    const lost = results.filter((r) => r.status !== 201);
    expect(won, results.map((r) => r.status).join(',')).toHaveLength(2);
    for (const r of lost) expect(r).toBeProblem(409, 'no-copy-available');
    expect(new Set(won.map((r) => r.body.copy.id))).toEqual(new Set(copies.map((c) => c.id)));

    expect((await anon.books.get(book.id)).body).toMatchObject({ totalCopies: 2, availableCopies: 0 });
    expect((await anon.copies.list(book.id)).body.data.every((c) => c.status === 'ON_LOAN')).toBe(true);
  });

  test('the same race through v1 and v2 mixed gives the same result', async ({ factory }) => {
    const members = await factory.members(8);
    const { book } = await factory.book({ copies: 2 });
    const results = await Promise.all(
      members.map((m, i) => (i % 2 ? m.api.loansV1 : m.api.loans).borrow({ bookId: book.id })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
  });

  test('one member borrowing 6 different books at once never exceeds the limit of 3', async ({ factory }) => {
    const who = await factory.member({ maxActiveLoans: 3 });
    const books = await Promise.all(Array.from({ length: 6 }, () => factory.book({ copies: 1 })));

    const results = await Promise.all(books.map(({ book }) => who.api.loans.borrow({ bookId: book.id })));

    expect(results.filter((r) => r.status === 201), results.map((r) => r.status).join(',')).toHaveLength(3);
    for (const r of results.filter((x) => x.status !== 201)) expect(r).toBeProblem(409, 'loan-limit-reached');
    expect((await who.api.members.me()).body.activeLoans).toBe(3);
  });

  test('returning the same loan 5 times at once: one 200, four already-returned, copy AVAILABLE once', async ({ factory, anon }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    const loan = await factory.loan(who, book.id);

    const results = await Promise.all(Array.from({ length: 5 }, () => who.api.loans.return(loan.id)));

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) expect(r).toBeProblem(409, 'already-returned');
    expect((await anon.books.get(book.id)).body.availableCopies).toBe(1);
  });

  test('reserve vs return race: never a WAITING reservation next to an AVAILABLE copy (no lost wake-up)', async ({ factory, librarian, anon }) => {
    const [borrower, a, b] = await factory.members(3);
    const { book } = await factory.book({ copies: 1 });
    const loan = await factory.loan(borrower, book.id);

    await Promise.all([
      a.api.reservations.create({ bookId: book.id }),
      b.api.reservations.create({ bookId: book.id }),
      borrower.api.loans.return(loan.id),
    ]);

    const reservations = (await librarian.reservations.list({ bookId: book.id })).body.data;
    const ready = reservations.filter((r) => r.status === 'READY');
    const copy = (await anon.copies.list(book.id)).body.data[0]!;
    // Either a reservation got in before the return (copy held for the earliest one) or the copy is free.
    if (ready.length === 1) expect(copy.status).toBe('RESERVED');
    else {
      expect(ready).toHaveLength(0);
      expect(copy.status).toBe('AVAILABLE');
    }
    const waiting = reservations.filter((r) => r.status === 'WAITING');
    expect(waiting.every((r) => typeof r.position === 'number')).toBe(true);
    // A reservation that slipped in while the return was committing would wait forever for a free copy.
    if (copy.status === 'AVAILABLE') expect(waiting).toHaveLength(0);
  });
});
