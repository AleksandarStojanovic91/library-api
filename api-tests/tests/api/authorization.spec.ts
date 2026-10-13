/**
 * Who may do what (SPEC "Auth"):
 *  - no/invalid token on a protected route        -> 401
 *  - member on a librarian-only route              -> 403
 *  - member asking for SOMEONE ELSE's resource     -> 404 (not 403), so ids of other members' data do not leak
 */
import { MISSING_ID, seed } from '../../src/config';
import type { Method } from '../../src/client/http';
import * as gen from '../../src/data/generators';
import { expect, test } from '../../src/fixtures';

const idem = { 'Idempotency-Key': '6b0f1a0e-0000-4000-8000-authz0000001' };

const protectedRoutes: { method: Method; path: string; data?: unknown; headers?: Record<string, string>; contentType?: string }[] = [
  { method: 'POST', path: '/api/v1/books', data: { isbn: '9780132350884', title: 'x', authorIds: [seed.authors.kleppmann.id] } },
  { method: 'PATCH', path: `/api/v1/books/${seed.books.cleanCode.id}`, data: { title: 'x' }, headers: { 'If-Match': '"1"' }, contentType: 'application/merge-patch+json' },
  { method: 'DELETE', path: `/api/v1/books/${MISSING_ID}` },
  { method: 'POST', path: `/api/v1/books/${seed.books.cleanCode.id}/copies`, data: { barcode: 'AUTHZ-0001' } },
  { method: 'POST', path: '/api/v1/authors', data: { name: 'x' } },
  { method: 'GET', path: '/api/v1/members' },
  { method: 'POST', path: '/api/v1/members', data: { email: 'x@library.test', name: 'x', password: 'long-enough-pw' } },
  { method: 'GET', path: '/api/v1/members/me' },
  { method: 'GET', path: `/api/v1/members/${seed.member.id}` },
  { method: 'PUT', path: `/api/v1/members/${seed.member.id}/status`, data: { status: 'SUSPENDED' } },
  { method: 'GET', path: '/api/v1/loans' },
  { method: 'POST', path: '/api/v1/loans', data: { bookId: seed.books.cleanCode.id }, headers: idem },
  { method: 'GET', path: `/api/v1/loans/${MISSING_ID}` },
  { method: 'POST', path: `/api/v1/loans/${MISSING_ID}/return` },
  { method: 'GET', path: '/api/v2/loans' },
  { method: 'POST', path: '/api/v2/loans', data: { bookId: seed.books.cleanCode.id }, headers: idem },
  { method: 'GET', path: `/api/v2/loans/${MISSING_ID}` },
  { method: 'POST', path: `/api/v2/loans/${MISSING_ID}/return` },
  { method: 'GET', path: '/api/v1/reservations' },
  { method: 'POST', path: '/api/v1/reservations', data: { bookId: seed.books.cleanCode.id } },
  { method: 'DELETE', path: `/api/v1/reservations/${MISSING_ID}` },
];

test.describe('authorization: 401 without a token', () => {
  for (const route of protectedRoutes) {
    test(`${route.method} ${route.path.replace(/[0-9a-f-]{36}/g, '{id}')} -> 401`, async ({ anon }) => {
      const res = await anon.http.send(route.method, route.path, route);
      expect(res).toBeProblem(401, 'unauthorized');
    });
  }
});

test.describe('authorization: 403 for members on librarian-only routes', () => {
  test('a member cannot add, change or delete books', async ({ member, factory }) => {
    const { book } = await factory.book();
    expect(
      await member.books.create({ isbn: gen.isbn(), title: 'Not allowed', authorIds: [seed.authors.kleppmann.id] }),
    ).toBeProblem(403, 'forbidden');
    expect(await member.books.update(book.id, { title: 'Hijacked' }, { ifMatch: '"1"' })).toBeProblem(403, 'forbidden');
    expect(await member.books.delete(book.id)).toBeProblem(403, 'forbidden');
    expect(await member.copies.add(book.id, { barcode: gen.barcode() })).toBeProblem(403, 'forbidden');

    // and nothing changed
    const after = await member.books.get(book.id);
    expect(after.body).toMatchObject({ title: book.title, version: 1, totalCopies: 0 });
  });

  test('a member cannot add authors', async ({ member }) => {
    expect(await member.authors.create({ name: 'Not allowed' })).toBeProblem(403, 'forbidden');
  });

  test('a member cannot list or register members', async ({ member }) => {
    expect(await member.members.list()).toBeProblem(403, 'forbidden');
    expect(
      await member.members.create({ email: gen.email(), name: 'Sneaky', password: 'long-enough-pw' }),
    ).toBeProblem(403, 'forbidden');
  });

  for (const version of ['loans', 'loansV1'] as const) {
    test(`a member cannot borrow for someone else (memberId on POST ${version === 'loans' ? 'v2' : 'v1'}/loans)`, async ({ factory }) => {
      const [me, other] = await factory.members(2);
      const { book } = await factory.book({ copies: 1 });
      const res = await me.api[version].borrow({ bookId: book.id, memberId: other.member.id });
      expect(res).toBeProblem(403, 'forbidden');
    });
  }
});

test.describe('authorization: 404 (not 403) for other members\' data', () => {
  test('a member reading another member gets 404, their own record 200', async ({ member }) => {
    expect(await member.members.get(seed.member2.id)).toBeProblem(404, 'not-found');
    expect(await member.members.get(seed.member.id)).toHaveStatus(200);
  });

  test('a member reading or returning another member\'s loan gets 404 (v1 and v2)', async ({ factory, librarian }) => {
    const [owner, stranger] = await factory.members(2);
    const { book } = await factory.book({ copies: 1 });
    const loan = await factory.loan(owner, book.id);

    expect(await stranger.api.loans.get(loan.id)).toBeProblem(404, 'not-found');
    expect(await stranger.api.loansV1.get(loan.id)).toBeProblem(404, 'not-found');
    expect(await stranger.api.loans.return(loan.id)).toBeProblem(404, 'not-found');
    expect(await stranger.api.loansV1.return(loan.id)).toBeProblem(404, 'not-found');

    // the response is indistinguishable from a loan that does not exist
    const missing = await stranger.api.loans.get(MISSING_ID);
    expect(missing).toBeProblem(404, 'not-found');

    // the loan is untouched, and the owner and the librarian can still see it
    expect((await owner.api.loans.get(loan.id)).body.status).toBe('ACTIVE');
    expect(await librarian.loans.get(loan.id)).toHaveStatus(200);
  });

  test('a member cancelling another member\'s reservation gets 404', async ({ factory }) => {
    const [borrower, reserver, stranger] = await factory.members(3);
    const { book } = await factory.book({ copies: 1 });
    await factory.loan(borrower, book.id);
    const reservation = await reserver.api.reservations.create({ bookId: book.id });
    expect(reservation).toHaveStatus(201);

    expect(await stranger.api.reservations.cancel(reservation.body.id)).toBeProblem(404, 'not-found');
    const own = await reserver.api.reservations.list({ bookId: book.id });
    expect(own.body.data.find((r) => r.id === reservation.body.id)?.status).toBe('WAITING');
  });

  test('lists only ever contain the caller\'s own loans and reservations, even with ?memberId=', async ({ factory }) => {
    const [alice, bob] = await factory.members(2);
    const { book } = await factory.book({ copies: 2 });
    await factory.loan(alice, book.id);
    await factory.loan(bob, book.id);

    for (const api of [alice.api.loans, alice.api.loansV1]) {
      const res = await api.list({ memberId: bob.member.id });
      expect(res).toHaveStatus(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((l) => l.memberId === alice.member.id)).toBe(true);
    }
    const reservations = await alice.api.reservations.list({ memberId: bob.member.id });
    expect(reservations).toHaveStatus(200);
    expect(reservations.body.data.every((r) => r.memberId === alice.member.id)).toBe(true);
  });

  test('the librarian can read any member', async ({ librarian }) => {
    const res = await librarian.members.get(seed.member2.id);
    expect(res).toHaveStatus(200);
    expect(res.body.email).toBe(seed.member2.email);
  });
});
