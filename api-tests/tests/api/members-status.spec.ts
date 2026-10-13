/**
 * PUT /api/v1/members/{memberId}/status (librarian only) and what a suspension means (SPEC "Auth" and
 * "Decisions" 2): a SUSPENDED member can still log in, read and return, but cannot borrow or reserve
 * (409 member-suspended).
 */
import { MISSING_ID, seed } from '../../src/config';
import { unchecked } from '../../src/client/library-api';
import { expect, test } from '../../src/fixtures';

test.describe('member status: PUT /members/{id}/status', () => {
  test('the librarian suspends and reactivates a member; the Member is returned', async ({ librarian, factory }) => {
    const who = await factory.member();

    const suspended = await librarian.members.setStatus(who.member.id, { status: 'SUSPENDED' });
    expect(suspended).toHaveStatus(200);
    expect(suspended.body).toMatchObject({ id: who.member.id, email: who.email, status: 'SUSPENDED', maxActiveLoans: 3 });
    expect((await librarian.members.get(who.member.id)).body.status).toBe('SUSPENDED');

    const active = await librarian.members.setStatus(who.member.id, { status: 'ACTIVE' });
    expect(active.body.status).toBe('ACTIVE');
  });

  test('maxActiveLoans can be changed with the status, and the new limit applies', async ({ librarian, factory }) => {
    const who = await factory.member();
    const res = await librarian.members.setStatus(who.member.id, { status: 'ACTIVE', maxActiveLoans: 1 });
    expect(res.body).toMatchObject({ status: 'ACTIVE', maxActiveLoans: 1 });

    const { book } = await factory.book({ copies: 2 });
    await factory.loan(who, book.id);
    expect(await who.api.loans.borrow({ bookId: book.id })).toBeProblem(409, 'loan-limit-reached');
  });

  test('a member cannot change anyone\'s status, not even their own (403)', async ({ factory }) => {
    const [who, other] = await factory.members(2);
    expect(await who.api.members.setStatus(other.member.id, { status: 'SUSPENDED' })).toBeProblem(403, 'forbidden');
    expect(await who.api.members.setStatus(who.member.id, { status: 'ACTIVE', maxActiveLoans: 10 })).toBeProblem(403, 'forbidden');
    expect((await who.api.members.me()).body).toMatchObject({ status: 'ACTIVE', maxActiveLoans: 3 });
  });

  test('an unknown member is 404', async ({ librarian }) => {
    expect(await librarian.members.setStatus(MISSING_ID, { status: 'SUSPENDED' })).toBeProblem(404, 'not-found');
  });

  const invalid: [string, unknown, string?][] = [
    ['a missing status', { maxActiveLoans: 5 }, 'status'],
    ['an unknown status', { status: 'BANNED' }, 'status'],
    ['maxActiveLoans out of range', { status: 'ACTIVE', maxActiveLoans: 11 }, 'maxActiveLoans'],
    ['an unknown property', { status: 'ACTIVE', role: 'LIBRARIAN' }],
  ];
  for (const [name, body, field] of invalid) {
    test(`rejects ${name} with 400`, async ({ librarian, factory }) => {
      const who = await factory.member();
      const res = await librarian.members.setStatus(who.member.id, unchecked(body));
      expect(res).toBeProblem(400, 'validation-failed', field ? { fields: [field] } : {});
      expect((await librarian.members.get(who.member.id)).body).toMatchObject({ status: 'ACTIVE', role: 'MEMBER' });
    });
  }

  test('seeded members are never touched: a member cannot suspend the librarian', async ({ member }) => {
    expect(await member.members.setStatus(seed.librarian.id, { status: 'SUSPENDED' })).toBeProblem(403, 'forbidden');
  });
});

test.describe('member status: what a suspended member can do', () => {
  test('can still log in and read', async ({ anon, factory }) => {
    const who = await factory.member();
    await factory.setStatus(who, 'SUSPENDED');

    expect(await anon.auth.token({ email: who.email, password: who.password })).toHaveStatus(200);
    expect((await who.api.members.me()).body.status).toBe('SUSPENDED');
    expect(await who.api.books.list({ limit: 1 })).toHaveStatus(200);
    expect(await who.api.loans.list()).toHaveStatus(200);
  });

  for (const version of ['loans', 'loansV1'] as const) {
    test(`cannot borrow: 409 member-suspended (${version === 'loans' ? 'v2' : 'v1'})`, async ({ factory, anon }) => {
      const who = await factory.member();
      const { book } = await factory.book({ copies: 1 });
      await factory.setStatus(who, 'SUSPENDED');

      expect(await who.api[version].borrow({ bookId: book.id })).toBeProblem(409, 'member-suspended');
      expect((await anon.books.get(book.id)).body.availableCopies).toBe(1);
    });
  }

  test('the librarian cannot borrow on behalf of a suspended member', async ({ librarian, factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    await factory.setStatus(who, 'SUSPENDED');
    expect(await librarian.loans.borrow({ bookId: book.id, memberId: who.member.id })).toBeProblem(409, 'member-suspended');
  });

  test('suspension is checked before availability (step 1 before step 4 of the borrow)', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book(); // no copies: would otherwise be no-copy-available
    await factory.setStatus(who, 'SUSPENDED');
    expect(await who.api.loans.borrow({ bookId: book.id })).toBeProblem(409, 'member-suspended');
  });

  test('cannot reserve: 409 member-suspended', async ({ factory }) => {
    const [borrower, who] = await factory.members(2);
    const { book } = await factory.book({ copies: 1 });
    await factory.loan(borrower, book.id);
    await factory.setStatus(who, 'SUSPENDED');
    expect(await who.api.reservations.create({ bookId: book.id })).toBeProblem(409, 'member-suspended');
  });

  test('can still return a book borrowed before the suspension', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    const loan = await factory.loan(who, book.id);
    await factory.setStatus(who, 'SUSPENDED');

    const res = await who.api.loans.return(loan.id);
    expect(res).toHaveStatus(200);
    expect(res.body.status).toBe('RETURNED');
  });

  test('after reactivation the member can borrow again', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    await factory.setStatus(who, 'SUSPENDED');
    expect(await who.api.loans.borrow({ bookId: book.id })).toBeProblem(409, 'member-suspended');

    await factory.setStatus(who, 'ACTIVE');
    expect(await who.api.loans.borrow({ bookId: book.id })).toHaveStatus(201);
  });
});
