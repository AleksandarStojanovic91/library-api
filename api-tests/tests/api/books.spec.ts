import { MISSING_ID, seed } from '../../src/config';
import { unchecked } from '../../src/client/library-api';
import { DEFAULT_AUTHOR_ID } from '../../src/data/factory';
import * as gen from '../../src/data/generators';
import { expect, test } from '../../src/fixtures';

test.describe('books: create and read', () => {
  test('creates a book: 201, Location, ETag "1", and the stored representation', async ({ librarian, anon, factory }) => {
    const author = await factory.author();
    const input = {
      isbn: gen.isbn(),
      title: `Refactoring ${gen.word(6)}`,
      description: 'Improving the design of existing code.',
      publishedYear: 2018,
      authorIds: [author.id, DEFAULT_AUTHOR_ID],
      tags: ['software', 'design'],
    };

    const created = await librarian.books.create(input);

    expect(created).toHaveStatus(201);
    expect(created.header('location')).toMatch(new RegExp(`/api/v1/books/${created.body.id}$`));
    expect(created.header('etag')).toBe('"1"');
    expect(created.body).toMatchObject({
      isbn: input.isbn,
      title: input.title,
      description: input.description,
      publishedYear: 2018,
      totalCopies: 0,
      availableCopies: 0,
      version: 1,
    });
    expect([...created.body.tags].sort()).toEqual(['design', 'software']);
    expect(created.body.authors.map((a) => a.id).sort()).toEqual([author.id, DEFAULT_AUTHOR_ID].sort());
    expect(created.body.authors.find((a) => a.id === author.id)?.name).toBe(author.name);

    const fetched = await anon.books.get(created.body.id);
    expect(fetched).toHaveStatus(200);
    expect(fetched.header('etag')).toBe('"1"');
    expect(fetched.body).toEqual(created.body);
  });

  test('only the required fields are needed; tags default to []; empty nullable fields are null, not omitted', async ({ librarian }) => {
    const res = await librarian.books.create({ isbn: gen.isbn(), title: 'Minimal', authorIds: [DEFAULT_AUTHOR_ID] });
    expect(res).toHaveStatus(201);
    expect(res.body.tags).toEqual([]);
    // SPEC "Decisions" 5 (the contract validator also enforces this on every response)
    expect(res.body).toHaveProperty('description', null);
    expect(res.body).toHaveProperty('publishedYear', null);
    expect(JSON.parse(res.text)).toHaveProperty('description', null);
  });

  test('a seeded book has its author, copies and counters', async ({ anon }) => {
    const res = await anon.books.get(seed.books.ddia.id);
    expect(res).toHaveStatus(200);
    expect(res.body).toMatchObject({ isbn: seed.books.ddia.isbn, title: seed.books.ddia.title, totalCopies: 3 });
    expect(res.body.authors).toEqual([seed.authors.kleppmann]);
  });

  test('an unknown book id is 404', async ({ anon }) => {
    expect(await anon.books.get(MISSING_ID)).toBeProblem(404, 'not-found');
  });

  test('a malformed book id is 400', async ({ anon }) => {
    expect(await anon.books.get('not-a-uuid')).toBeProblem(400, 'validation-failed');
  });
});

test.describe('books: validation', () => {
  test('ISBN with a wrong check digit is rejected', async ({ librarian }) => {
    const res = await librarian.books.create({
      isbn: gen.withWrongCheckDigit(gen.isbn()),
      title: 'Bad ISBN',
      authorIds: [DEFAULT_AUTHOR_ID],
    });
    expect(res).toBeProblem(400, 'validation-failed', { fields: ['isbn'] });
  });

  for (const isbn of ['123', '9780132350884X', '0132350882', '9770132350884', '978-0132350884']) {
    test(`ISBN "${isbn}" that does not match the ISBN-13 pattern is rejected`, async ({ librarian }) => {
      const res = await librarian.books.create({ isbn, title: 'Bad ISBN', authorIds: [DEFAULT_AUTHOR_ID] });
      expect(res).toBeProblem(400, 'validation-failed', { fields: ['isbn'] });
    });
  }

  test('a duplicate ISBN is 409 duplicate', async ({ librarian, factory }) => {
    const { book } = await factory.book();
    const res = await librarian.books.create({ isbn: book.isbn, title: 'Same ISBN', authorIds: [DEFAULT_AUTHOR_ID] });
    expect(res).toBeProblem(409, 'duplicate');
  });

  test('every failing field is listed, not just the first one', async ({ librarian }) => {
    const res = await librarian.books.create(
      unchecked({ isbn: 'nope', title: '', authorIds: [], publishedYear: 1000, tags: ['ok', 'ok'] }),
    );
    expect(res).toBeProblem(400, 'validation-failed', { fields: ['isbn', 'title', 'authorIds', 'publishedYear', 'tags'] });
  });

  test('missing required fields are each reported', async ({ librarian }) => {
    const res = await librarian.books.create(unchecked({}));
    expect(res).toBeProblem(400, 'validation-failed', { fields: ['isbn', 'title', 'authorIds'] });
  });

  test('a malformed author id is reported with its JSON pointer (authorIds.0)', async ({ librarian }) => {
    const res = await librarian.books.create(unchecked({ isbn: gen.isbn(), title: 'x', authorIds: ['not-a-uuid'] }));
    expect(res).toBeProblem(400, 'validation-failed', { fields: ['authorIds.0'] });
  });

  test('an unknown author id is 400 on authorIds', async ({ librarian }) => {
    const res = await librarian.books.create({ isbn: gen.isbn(), title: 'x', authorIds: [MISSING_ID] });
    expect(res).toBeProblem(400, 'validation-failed', { fields: ['authorIds'] });
  });

  test('unknown properties are rejected', async ({ librarian }) => {
    const res = await librarian.books.create(
      unchecked({ isbn: gen.isbn(), title: 'x', authorIds: [DEFAULT_AUTHOR_ID], availableCopies: 99 }),
    );
    expect(res).toBeProblem(400, 'validation-failed');
  });

  test('boundaries: title 300 chars and year 1450/2100 pass; 301 chars and 1449/2101 fail', async ({ librarian }) => {
    const base = { authorIds: [DEFAULT_AUTHOR_ID] };
    expect(await librarian.books.create({ ...base, isbn: gen.isbn(), title: 'a'.repeat(300), publishedYear: 1450 })).toHaveStatus(201);
    expect(await librarian.books.create({ ...base, isbn: gen.isbn(), title: 'b', publishedYear: 2100 })).toHaveStatus(201);
    expect(await librarian.books.create({ ...base, isbn: gen.isbn(), title: 'a'.repeat(301) })).toBeProblem(400, 'validation-failed', { fields: ['title'] });
    expect(await librarian.books.create({ ...base, isbn: gen.isbn(), title: 'c', publishedYear: 1449 })).toBeProblem(400, 'validation-failed', { fields: ['publishedYear'] });
    expect(await librarian.books.create({ ...base, isbn: gen.isbn(), title: 'd', publishedYear: 2101 })).toBeProblem(400, 'validation-failed', { fields: ['publishedYear'] });
  });

  test('malformed JSON is 400 with detail "Malformed JSON body"', async ({ librarian }) => {
    const res = await librarian.http.send('POST', '/api/v1/books', { data: '{"isbn": "978', contentType: 'application/json' });
    expect(res).toBeProblem(400, 'validation-failed', { detail: 'Malformed JSON body' });
  });
});

test.describe('books: delete', () => {
  test('deletes a book without loans: 204, then 404', async ({ librarian, anon, factory }) => {
    const { book } = await factory.book({ copies: 2 });
    const res = await librarian.books.delete(book.id);
    expect(res).toHaveStatus(204);
    expect(res.text).toBe('');
    expect(await anon.books.get(book.id)).toBeProblem(404, 'not-found');
    expect(await anon.copies.list(book.id)).toBeProblem(404, 'not-found');
    expect(await librarian.books.delete(book.id)).toBeProblem(404, 'not-found');
  });

  test('a book with a copy on loan cannot be deleted (409 book-has-active-loans)', async ({ librarian, factory }) => {
    const borrower = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    await factory.loan(borrower, book.id);
    expect(await librarian.books.delete(book.id)).toBeProblem(409, 'book-has-active-loans');
  });

  test('a book with a copy held for a reservation cannot be deleted', async ({ librarian, factory }) => {
    const [borrower, reserver] = await factory.members(2);
    const { book } = await factory.book({ copies: 1 });
    const loan = await factory.loan(borrower, book.id);
    expect(await reserver.api.reservations.create({ bookId: book.id })).toHaveStatus(201);
    expect(await borrower.api.loans.return(loan.id)).toHaveStatus(200); // copy is now RESERVED for `reserver`

    expect(await librarian.books.delete(book.id)).toBeProblem(409, 'book-has-active-loans');
  });

  // SPEC "Decisions" 1: loan history is kept, so a book that was ever lent cannot be deleted.
  test('a book whose loans are all returned cannot be deleted (409 book-has-loan-history) and stays readable', async ({ librarian, anon, factory }) => {
    const borrower = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    const loan = await factory.loan(borrower, book.id);
    expect(await borrower.api.loans.return(loan.id)).toHaveStatus(200);

    expect(await librarian.books.delete(book.id)).toBeProblem(409, 'book-has-loan-history');
    expect(await anon.books.get(book.id)).toHaveStatus(200);
    expect((await borrower.api.loans.get(loan.id)).body.status).toBe('RETURNED');
  });

  test('active loans win over loan history: 409 book-has-active-loans', async ({ librarian, factory }) => {
    const borrower = await factory.member();
    const { book } = await factory.book({ copies: 2 });
    const first = await factory.loan(borrower, book.id);
    await borrower.api.loans.return(first.id); // history
    await factory.loan(borrower, book.id); // and an active loan
    expect(await librarian.books.delete(book.id)).toBeProblem(409, 'book-has-active-loans');
  });
});
