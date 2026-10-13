import { MISSING_ID, seed } from '../../src/config';
import { unchecked } from '../../src/client/library-api';
import * as gen from '../../src/data/generators';
import { expect, test } from '../../src/fixtures';

test.describe('copies', () => {
  test('adding a copy: 201, Location, AVAILABLE, and the book counters follow', async ({ librarian, anon, factory }) => {
    const { book } = await factory.book();
    const barcode = gen.barcode('CP');

    const res = await librarian.copies.add(book.id, { barcode });

    expect(res).toHaveStatus(201);
    expect(res.header('location')).toMatch(/\/[0-9a-f-]{36}$/);
    expect(res.body).toMatchObject({ bookId: book.id, barcode, status: 'AVAILABLE' });
    expect((await anon.books.get(book.id)).body).toMatchObject({ totalCopies: 1, availableCopies: 1 });
  });

  test('lists the copies of a book with their status', async ({ anon, factory }) => {
    const borrower = await factory.member();
    const { book, copies } = await factory.book({ copies: 2 });
    const loan = await factory.loan(borrower, book.id);

    const res = await anon.copies.list(book.id);
    expect(res).toHaveStatus(200);
    expect(res.body.data.map((c) => c.id).sort()).toEqual(copies.map((c) => c.id).sort());
    const statusById = Object.fromEntries(res.body.data.map((c) => [c.id, c.status]));
    expect(statusById[loan.copy.id]).toBe('ON_LOAN');
    expect(Object.values(statusById).filter((s) => s === 'AVAILABLE')).toHaveLength(1);
  });

  test('a duplicate barcode is 409 duplicate, even on another book', async ({ librarian, factory }) => {
    const { copies } = await factory.book({ copies: 1 });
    const { book: other } = await factory.book();
    expect(await librarian.copies.add(other.id, { barcode: copies[0]!.barcode })).toBeProblem(409, 'duplicate');
  });

  for (const barcode of ['abc-1', 'ABC', 'A'.repeat(33), 'ABC 123', 'ABC_123']) {
    test(`barcode "${barcode.length > 12 ? `${barcode.slice(0, 6)}… (${barcode.length} chars)` : barcode}" is rejected`, async ({ librarian, factory }) => {
      const { book } = await factory.book();
      expect(await librarian.copies.add(book.id, { barcode })).toBeProblem(400, 'validation-failed', { fields: ['barcode'] });
    });
  }

  test('copies of an unknown book: 404 for list and add', async ({ anon, librarian }) => {
    expect(await anon.copies.list(MISSING_ID)).toBeProblem(404, 'not-found');
    expect(await librarian.copies.add(MISSING_ID, { barcode: gen.barcode() })).toBeProblem(404, 'not-found');
  });
});

test.describe('authors', () => {
  test('create, then read it back', async ({ librarian, anon }) => {
    const created = await librarian.authors.create({ name: 'Barbara Liskov', bio: 'Substitution principle.' });
    expect(created).toHaveStatus(201);
    expect(created.header('location')).toMatch(new RegExp(`/api/v1/authors/${created.body.id}$`));
    expect(created.body).toMatchObject({ name: 'Barbara Liskov', bio: 'Substitution principle.' });

    const fetched = await anon.authors.get(created.body.id);
    expect(fetched.body).toEqual(created.body);
  });

  test('validation: empty name, too long bio, unknown property', async ({ librarian }) => {
    expect(await librarian.authors.create({ name: '' })).toBeProblem(400, 'validation-failed', { fields: ['name'] });
    expect(await librarian.authors.create({ name: 'x', bio: 'b'.repeat(2001) })).toBeProblem(400, 'validation-failed', { fields: ['bio'] });
    expect(await librarian.authors.create(unchecked({ name: 'x', born: 1900 }))).toBeProblem(400, 'validation-failed');
  });

  test('an unknown author is 404', async ({ anon }) => {
    expect(await anon.authors.get(MISSING_ID)).toBeProblem(404, 'not-found');
  });
});

test.describe('members', () => {
  test('the librarian registers a member: defaults, no password in the response, can log in', async ({ librarian, anon }) => {
    const email = gen.email();
    const res = await librarian.members.create({ email, name: 'New Member', password: 'correct-horse-battery' });

    expect(res).toHaveStatus(201);
    expect(res.header('location')).toMatch(new RegExp(`/api/v1/members/${res.body.id}$`));
    expect(res.body).toMatchObject({ email, name: 'New Member', role: 'MEMBER', status: 'ACTIVE', maxActiveLoans: 3, activeLoans: 0 });
    expect(res.text).not.toContain('correct-horse-battery');
    // the closed contract schema already rejects any extra field such as password or passwordHash

    expect(await anon.auth.token({ email, password: 'correct-horse-battery' })).toHaveStatus(200);
  });

  test('maxActiveLoans can be set (1..10)', async ({ librarian }) => {
    const ok = await librarian.members.create({ email: gen.email(), name: 'Heavy reader', password: 'long-enough-pw', maxActiveLoans: 10 });
    expect(ok.body.maxActiveLoans).toBe(10);
    const tooMany = await librarian.members.create({ email: gen.email(), name: 'x', password: 'long-enough-pw', maxActiveLoans: 11 });
    expect(tooMany).toBeProblem(400, 'validation-failed', { fields: ['maxActiveLoans'] });
  });

  test('a duplicate e-mail is 409 duplicate, case-insensitively', async ({ librarian }) => {
    const email = gen.email();
    expect(await librarian.members.create({ email, name: 'First', password: 'long-enough-pw' })).toHaveStatus(201);
    expect(await librarian.members.create({ email: email.toUpperCase(), name: 'Second', password: 'long-enough-pw' })).toBeProblem(409, 'duplicate');
  });

  test('validation: short password, bad e-mail, missing name are all reported', async ({ librarian }) => {
    const res = await librarian.members.create(unchecked({ email: 'not-an-email', password: 'short' }));
    expect(res).toBeProblem(400, 'validation-failed', { fields: ['email', 'password', 'name'] });
  });

  test('activeLoans counts open loans only', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 2 });
    const first = await factory.loan(who, book.id);
    await factory.loan(who, book.id);
    expect((await who.api.members.me()).body.activeLoans).toBe(2);
    await who.api.loans.return(first.id);
    expect((await who.api.members.me()).body.activeLoans).toBe(1);
  });

  test('an unknown member is 404 for the librarian', async ({ librarian }) => {
    expect(await librarian.members.get(MISSING_ID)).toBeProblem(404, 'not-found');
  });

  test('seeded members exist with their roles', async ({ librarian }) => {
    expect((await librarian.members.get(seed.librarian.id)).body.role).toBe('LIBRARIAN');
    expect((await librarian.members.get(seed.member.id)).body.role).toBe('MEMBER');
  });
});
