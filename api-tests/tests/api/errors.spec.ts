/**
 * The error catalogue: every problem code that can be triggered from outside, one test each.
 *
 * The API client already checks EVERY error response for the common rules (application/problem+json,
 * type = https://library.example/problems/<code>, status matches, instance = path, requestId = X-Request-Id,
 * code uses its HTTP status and its exact title from SPEC "Decisions" 7, no stack traces). This file makes sure
 * each code is actually reachable and documents how. Not reachable black-box: `conflict` (generic) and
 * `internal`; `rate-limited` lives in rate-limit.spec.ts.
 */
import { MISSING_ID } from '../../src/config';
import type { ApiResult } from '../../src/client/http';
import { unchecked, type LibraryApi } from '../../src/client/library-api';
import { DEFAULT_AUTHOR_ID, type TestDataFactory } from '../../src/data/factory';
import * as gen from '../../src/data/generators';
import { PROBLEM_CATALOGUE, PROBLEM_TYPE_PREFIX } from '../../src/contract/spec-invariants';
import { expect, test } from '../../src/fixtures';

type Ctx = { anon: LibraryApi; librarian: LibraryApi; member: LibraryApi; factory: TestDataFactory };

const catalogue: { code: keyof typeof PROBLEM_CATALOGUE; status: number; how: string; trigger: (c: Ctx) => Promise<ApiResult<unknown>> }[] = [
  { code: 'validation-failed', status: 400, how: 'POST /books with an empty body', trigger: ({ librarian }) => librarian.books.create(unchecked({})) },
  { code: 'unauthorized', status: 401, how: 'GET /members/me without a token', trigger: ({ anon }) => anon.members.me() },
  { code: 'forbidden', status: 403, how: 'member lists members', trigger: ({ member }) => member.members.list() },
  { code: 'not-found', status: 404, how: 'GET an unknown book', trigger: ({ anon }) => anon.books.get(MISSING_ID) },
  {
    code: 'duplicate', status: 409, how: 'POST /books with an existing ISBN',
    trigger: async ({ librarian, factory }) => {
      const { book } = await factory.book();
      return librarian.books.create({ isbn: book.isbn, title: 'dup', authorIds: [DEFAULT_AUTHOR_ID] });
    },
  },
  {
    code: 'no-copy-available', status: 409, how: 'borrow a book without copies',
    trigger: async ({ factory }) => {
      const who = await factory.member();
      const { book } = await factory.book();
      return who.api.loans.borrow({ bookId: book.id });
    },
  },
  {
    code: 'loan-limit-reached', status: 409, how: 'borrow twice with maxActiveLoans=1',
    trigger: async ({ factory }) => {
      const who = await factory.member({ maxActiveLoans: 1 });
      const { book } = await factory.book({ copies: 2 });
      await factory.loan(who, book.id);
      return who.api.loans.borrow({ bookId: book.id });
    },
  },
  {
    code: 'member-suspended', status: 409, how: 'a suspended member borrows',
    trigger: async ({ factory }) => {
      const who = await factory.member();
      const { book } = await factory.book({ copies: 1 });
      await factory.setStatus(who, 'SUSPENDED');
      return who.api.loans.borrow({ bookId: book.id });
    },
  },
  {
    code: 'already-returned', status: 409, how: 'return a loan twice',
    trigger: async ({ factory }) => {
      const who = await factory.member();
      const { book } = await factory.book({ copies: 1 });
      const loan = await factory.loan(who, book.id);
      await who.api.loans.return(loan.id);
      return who.api.loans.return(loan.id);
    },
  },
  {
    code: 'book-has-active-loans', status: 409, how: 'delete a book with a copy on loan',
    trigger: async ({ librarian, factory }) => {
      const who = await factory.member();
      const { book } = await factory.book({ copies: 1 });
      await factory.loan(who, book.id);
      return librarian.books.delete(book.id);
    },
  },
  {
    code: 'book-has-loan-history', status: 409, how: 'delete a book whose loans are all returned',
    trigger: async ({ librarian, factory }) => {
      const who = await factory.member();
      const { book } = await factory.book({ copies: 1 });
      const loan = await factory.loan(who, book.id);
      await who.api.loans.return(loan.id);
      return librarian.books.delete(book.id);
    },
  },
  {
    code: 'already-reserved', status: 409, how: 'reserve the same book twice',
    trigger: async ({ factory }) => {
      const [borrower, who] = await factory.members(2);
      const { book } = await factory.book({ copies: 1 });
      await factory.loan(borrower, book.id);
      await who.api.reservations.create({ bookId: book.id });
      return who.api.reservations.create({ bookId: book.id });
    },
  },
  {
    code: 'copy-available', status: 409, how: 'reserve a book that has a free copy',
    trigger: async ({ factory }) => {
      const who = await factory.member();
      const { book } = await factory.book({ copies: 1 });
      return who.api.reservations.create({ bookId: book.id });
    },
  },
  {
    code: 'reservation-not-cancellable', status: 409, how: 'cancel a reservation twice',
    trigger: async ({ factory }) => {
      const [borrower, who] = await factory.members(2);
      const { book } = await factory.book({ copies: 1 });
      await factory.loan(borrower, book.id);
      const r = await who.api.reservations.create({ bookId: book.id });
      await who.api.reservations.cancel(r.body.id);
      return who.api.reservations.cancel(r.body.id);
    },
  },
  {
    code: 'precondition-failed', status: 412, how: 'PATCH with a stale If-Match',
    trigger: async ({ librarian, factory }) => {
      const { book } = await factory.book();
      return librarian.books.update(book.id, { title: 'x' }, { ifMatch: '"999"' });
    },
  },
  {
    code: 'precondition-required', status: 428, how: 'PATCH without If-Match',
    trigger: async ({ librarian, factory }) => {
      const { book } = await factory.book();
      return librarian.books.update(book.id, { title: 'x' }, { ifMatch: null });
    },
  },
  {
    code: 'idempotency-key-reused', status: 422, how: 'reuse an Idempotency-Key with another body',
    trigger: async ({ factory }) => {
      const who = await factory.member();
      const { book: a } = await factory.book({ copies: 1 });
      const { book: b } = await factory.book({ copies: 1 });
      const key = gen.idempotencyKey();
      await who.api.loans.borrow({ bookId: a.id }, { idempotencyKey: key });
      return who.api.loans.borrow({ bookId: b.id }, { idempotencyKey: key });
    },
  },
];

test.describe('errors: problem catalogue', () => {
  for (const entry of catalogue) {
    test(`${entry.status} ${entry.code}: ${entry.how}`, async ({ anon, librarian, member, factory }) => {
      const res = await entry.trigger({ anon, librarian, member, factory });
      expect(res).toBeProblem(entry.status, entry.code);
      expect(res.header('content-type')).toMatch(/^application\/problem\+json/);
      expect(res.problem.type).toBe(PROBLEM_TYPE_PREFIX + entry.code);
      expect(res.problem.title).toBe(PROBLEM_CATALOGUE[entry.code].title);
      expect(res).toBeDocumentedInContract();
      expect(res.problem.instance).toBe(res.path);
      expect(res.problem.requestId).toBe(res.requestId);
    });
  }
});

test.describe('errors: general rules', () => {
  test('an unknown route is a 404 not-found problem', async ({ anon }) => {
    const res = await anon.http.send('GET', '/api/v1/does-not-exist');
    expect(res).toBeProblem(404, 'not-found');
    expect(res.problem.instance).toBe('/api/v1/does-not-exist');
  });

  test('the title is the fixed sentence from the SPEC table, whatever route produced it', async ({ anon, librarian }) => {
    const titles = [
      (await anon.books.get(MISSING_ID)).problem.title,
      (await librarian.members.get(MISSING_ID)).problem.title,
      (await anon.http.send('GET', '/api/v1/nothing-here')).problem.title,
    ];
    expect(titles).toEqual(Array(3).fill('Resource not found'));
  });

  test('validation errors list fields as JSON pointers without the leading slash', async ({ librarian }) => {
    const res = await librarian.books.create(unchecked({ isbn: gen.isbn(), title: 't', authorIds: [DEFAULT_AUTHOR_ID, 'bad'], tags: ['ok', ''] }));
    expect(res).toBeProblem(400, 'validation-failed', { fields: ['authorIds.1', 'tags.1'] });
    for (const e of res.problem.errors ?? []) {
      expect(e.field).not.toMatch(/^\//);
      expect(e.message.length).toBeGreaterThan(0);
    }
  });

  test('a body that is JSON but not an object is 400', async ({ librarian }) => {
    const res = await librarian.http.send('POST', '/api/v1/books', { data: '[1,2,3]', contentType: 'application/json' });
    expect(res).toBeProblem(400, 'validation-failed');
  });

  test('a wrong type is 400 with the field named', async ({ librarian }) => {
    const res = await librarian.books.create(unchecked({ isbn: gen.isbn(), title: 't', authorIds: [DEFAULT_AUTHOR_ID], publishedYear: 'nineteen' }));
    expect(res).toBeProblem(400, 'validation-failed', { fields: ['publishedYear'] });
  });
});
