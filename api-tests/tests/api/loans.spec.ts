/**
 * Lending. v1 and v2 share the logic and differ only in representation (and v1 is deprecated).
 */
import { config, MISSING_ID } from '../../src/config';
import { unchecked } from '../../src/client/library-api';
import { expect, test } from '../../src/fixtures';

const DAY_MS = 86_400_000;

test.describe('loans: borrow (v2)', () => {
  test('201 with the v2 shape: embedded book and copy, due in LOAN_DAYS, no fee', async ({ factory }) => {
    const who = await factory.member();
    const { book, copies } = await factory.book({ copies: 1 });
    const before = Date.now();

    const res = await who.api.loans.borrow({ bookId: book.id });

    expect(res).toHaveStatus(201);
    expect(res.header('location')).toMatch(new RegExp(`/api/v2/loans/${res.body.id}$`));
    expect(res.header('deprecation')).toBeUndefined();
    const loan = res.body;
    expect(loan).toMatchObject({
      book: { id: book.id, title: book.title, isbn: book.isbn },
      copy: { id: copies[0]!.id, barcode: copies[0]!.barcode },
      memberId: who.member.id,
      status: 'ACTIVE',
      overdueDays: 0,
    });
    expect(loan.fee).toBeNull();
    expect(loan.returnedAt).toBeNull();
    expect(Date.parse(loan.dueAt) - Date.parse(loan.borrowedAt)).toBe(config.loanDays * DAY_MS);
    expect(Math.abs(Date.parse(loan.borrowedAt) - before)).toBeLessThan(5 * 60_000); // same clock, give or take
  });

  test('the copy goes ON_LOAN and the book has one copy fewer available', async ({ anon, factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 2 });
    const loan = await factory.loan(who, book.id);

    expect((await anon.books.get(book.id)).body).toMatchObject({ totalCopies: 2, availableCopies: 1 });
    const copies = (await anon.copies.list(book.id)).body.data;
    expect(copies.find((c) => c.id === loan.copy.id)?.status).toBe('ON_LOAN');
  });

  test('the librarian can borrow on behalf of a member (memberId)', async ({ librarian, factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    const res = await librarian.loans.borrow({ bookId: book.id, memberId: who.member.id });
    expect(res).toHaveStatus(201);
    expect(res.body.memberId).toBe(who.member.id);
    expect((await who.api.loans.get(res.body.id)).body.id).toBe(res.body.id);
  });

  test('the librarian borrowing for an unknown member gets 404', async ({ librarian, factory }) => {
    const { book } = await factory.book({ copies: 1 });
    expect(await librarian.loans.borrow({ bookId: book.id, memberId: MISSING_ID })).toBeProblem(404, 'not-found');
  });

  test('an unknown book is 404; a malformed bookId is 400', async ({ factory }) => {
    const who = await factory.member();
    expect(await who.api.loans.borrow({ bookId: MISSING_ID })).toBeProblem(404, 'not-found');
    expect(await who.api.loans.borrow(unchecked({ bookId: 'nope' }))).toBeProblem(400, 'validation-failed', { fields: ['bookId'] });
    expect(await who.api.loans.borrow(unchecked({}))).toBeProblem(400, 'validation-failed', { fields: ['bookId'] });
  });

  test('no copy available: 409 no-copy-available pointing to reservations', async ({ factory }) => {
    const [first, second] = await factory.members(2);
    const { book } = await factory.book({ copies: 1 });
    await factory.loan(first, book.id);

    const res = await second.api.loans.borrow({ bookId: book.id });
    expect(res).toBeProblem(409, 'no-copy-available', {
      detail: 'No copy of this book is available. You can reserve it with POST /api/v1/reservations.',
    });
  });

  test('a book with no copies at all is also no-copy-available', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book();
    expect(await who.api.loans.borrow({ bookId: book.id })).toBeProblem(409, 'no-copy-available');
  });

  test('loan limit: the (maxActiveLoans + 1)th open loan is 409 loan-limit-reached; returning frees a slot', async ({ factory }) => {
    const who = await factory.member({ maxActiveLoans: 2 });
    const { book } = await factory.book({ copies: 3 });
    const first = await factory.loan(who, book.id);
    await factory.loan(who, book.id);

    expect(await who.api.loans.borrow({ bookId: book.id })).toBeProblem(409, 'loan-limit-reached');

    expect(await who.api.loans.return(first.id)).toHaveStatus(200);
    expect(await who.api.loans.borrow({ bookId: book.id })).toHaveStatus(201);
  });

  test('the default limit is 3', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 4 });
    for (let i = 0; i < 3; i++) await factory.loan(who, book.id);
    expect(await who.api.loans.borrow({ bookId: book.id })).toBeProblem(409, 'loan-limit-reached');
  });

  test('a missing Idempotency-Key is 400', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    expect(await who.api.loans.borrow({ bookId: book.id }, { idempotencyKey: null })).toBeProblem(400, 'validation-failed');
    expect((await who.api.members.me()).body.activeLoans).toBe(0);
  });
});

test.describe('loans: return', () => {
  test('returning on time: RETURNED, returnedAt set, no fee, copy AVAILABLE again', async ({ anon, factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    const loan = await factory.loan(who, book.id);

    const res = await who.api.loans.return(loan.id);

    expect(res).toHaveStatus(200);
    expect(res.body).toMatchObject({ id: loan.id, status: 'RETURNED', overdueDays: 0 });
    expect(res.body.fee).toBeNull();
    expect(Date.parse(res.body.returnedAt!)).toBeGreaterThanOrEqual(Date.parse(loan.borrowedAt));
    expect((await anon.books.get(book.id)).body.availableCopies).toBe(1);
    expect((await anon.copies.list(book.id)).body.data[0]!.status).toBe('AVAILABLE');
  });

  test('returning twice is 409 already-returned', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    const loan = await factory.loan(who, book.id);
    expect(await who.api.loans.return(loan.id)).toHaveStatus(200);
    expect(await who.api.loans.return(loan.id)).toBeProblem(409, 'already-returned');
    expect(await who.api.loansV1.return(loan.id)).toBeProblem(409, 'already-returned');
  });

  test('returning an unknown loan is 404', async ({ factory }) => {
    const who = await factory.member();
    expect(await who.api.loans.return(MISSING_ID)).toBeProblem(404, 'not-found');
  });
});

test.describe('loans: v1 vs v2 representation', () => {
  test('the same loan in both versions: v1 has flat ids and feeCents, v2 embeds book/copy and has fee + overdueDays', async ({ factory }) => {
    const who = await factory.member();
    const { book, copies } = await factory.book({ copies: 1 });
    const created = await who.api.loansV1.borrow({ bookId: book.id });

    expect(created).toHaveStatus(201);
    expect(created.header('location')).toMatch(new RegExp(`/api/v1/loans/${created.body.id}$`));
    expect(created.body).toMatchObject({ bookId: book.id, copyId: copies[0]!.id, memberId: who.member.id, status: 'ACTIVE' });
    expect(created.body.feeCents).toBeNull();
    expect(created.body).not.toHaveProperty('book');
    expect(created.body).not.toHaveProperty('overdueDays');

    const v2 = await who.api.loans.get(created.body.id);
    expect(v2.body).toMatchObject({
      id: created.body.id,
      book: { id: book.id },
      copy: { id: copies[0]!.id },
      borrowedAt: created.body.borrowedAt,
      dueAt: created.body.dueAt,
      overdueDays: 0,
    });
    expect(v2.body).not.toHaveProperty('bookId');
    expect(v2.body).not.toHaveProperty('feeCents');
  });

  test('a loan returned through v2 reads as RETURNED through v1 (shared logic)', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    const loan = await factory.loan(who, book.id);
    await who.api.loans.return(loan.id);
    const v1 = await who.api.loansV1.get(loan.id);
    expect(v1.body).toMatchObject({ status: 'RETURNED', returnedAt: expect.any(String) });
    expect(v1.body.feeCents).toBeNull();
  });

  test('every v1 response carries Deprecation, Sunset and a successor Link; v2 does not', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    const borrowed = await who.api.loansV1.borrow({ bookId: book.id });
    const responses = [
      borrowed,
      await who.api.loansV1.list(),
      await who.api.loansV1.get(borrowed.body.id),
      await who.api.loansV1.return(borrowed.body.id),
      await who.api.loansV1.get(MISSING_ID), // errors too
      await who.api.loansV1.borrow({ bookId: book.id }, { idempotencyKey: null }),
    ];
    for (const res of responses) {
      expect(res.header('deprecation'), res.describe()).toBe('@1767225600');
      expect(res.header('sunset'), res.describe()).toBe('Thu, 31 Dec 2026 23:59:59 GMT');
      expect(res.header('link'), res.describe()).toMatch(/<[^>]*\/api\/v2\/loans>;\s*rel="successor-version"/);
    }
    for (const res of [await who.api.loans.list(), await who.api.loans.get(borrowed.body.id)]) {
      expect(res.header('deprecation')).toBeUndefined();
      expect(res.header('sunset')).toBeUndefined();
    }
  });
});

test.describe('loans: listing and filters', () => {
  test('status filter: ACTIVE and RETURNED split a member\'s loans; nothing is OVERDUE yet', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 2 });
    const kept = await factory.loan(who, book.id);
    const returned = await factory.loan(who, book.id);
    await who.api.loans.return(returned.id);

    const ids = async (status?: 'ACTIVE' | 'RETURNED' | 'OVERDUE') =>
      (await who.api.loans.list(status ? { status } : {})).body.data.map((l) => l.id);
    expect(await ids('ACTIVE')).toEqual([kept.id]);
    expect(await ids('RETURNED')).toEqual([returned.id]);
    expect(await ids('OVERDUE')).toEqual([]);
    expect((await ids()).sort()).toEqual([kept.id, returned.id].sort());
  });

  test('an invalid status filter is 400', async ({ factory }) => {
    const who = await factory.member();
    expect(await who.api.http.send('GET', '/api/v2/loans', { params: { status: 'LOST' } })).toBeProblem(400, 'validation-failed');
  });

  test('the librarian can list one member\'s loans with ?memberId=', async ({ librarian, factory }) => {
    const [who, other] = await factory.members(2);
    const { book } = await factory.book({ copies: 2 });
    const mine = await factory.loan(who, book.id);
    await factory.loan(other, book.id);

    const res = await librarian.loans.list({ memberId: who.member.id });
    expect(res.body.data.map((l) => l.id)).toEqual([mine.id]);
    const v1 = await librarian.loansV1.list({ memberId: who.member.id });
    expect(v1.body.data.map((l) => l.id)).toEqual([mine.id]);
  });
});
