/**
 * Optimistic concurrency (ETag / If-None-Match / If-Match), JSON merge patch and the Redis read cache.
 */
import { MISSING_ID } from '../../src/config';
import { unchecked } from '../../src/client/library-api';
import { DEFAULT_AUTHOR_ID } from '../../src/data/factory';
import * as gen from '../../src/data/generators';
import { expect, test } from '../../src/fixtures';

test.describe('books: conditional GET', () => {
  test('If-None-Match with the current ETag is 304 with no body; a stale one is 200', async ({ anon, librarian, factory }) => {
    const { book } = await factory.book();

    const notModified = await anon.books.get(book.id, { ifNoneMatch: '"1"' });
    expect(notModified).toHaveStatus(304);
    expect(notModified.text).toBe('');
    expect(notModified.header('etag')).toBe('"1"'); // RFC 9110 §15.4.5: a 304 repeats the ETag

    expect(await librarian.books.update(book.id, { title: 'Changed' }, { ifMatch: '"1"' })).toHaveStatus(200);

    const modified = await anon.books.get(book.id, { ifNoneMatch: '"1"' });
    expect(modified).toHaveStatus(200);
    expect(modified.header('etag')).toBe('"2"');
    expect(modified.body.title).toBe('Changed');
  });
});

test.describe('books: PATCH preconditions', () => {
  test('without If-Match: 428 precondition-required, and nothing changes', async ({ librarian, factory }) => {
    const { book } = await factory.book();
    const res = await librarian.books.update(book.id, { title: 'No precondition' }, { ifMatch: null });
    expect(res).toBeProblem(428, 'precondition-required');
    expect((await librarian.books.get(book.id)).body).toMatchObject({ title: book.title, version: 1 });
  });

  test('with a stale If-Match: 412 precondition-failed, and nothing changes', async ({ librarian, factory }) => {
    const { book } = await factory.book();
    expect(await librarian.books.update(book.id, { title: 'v2' }, { ifMatch: '"1"' })).toHaveStatus(200);

    const stale = await librarian.books.update(book.id, { title: 'lost update' }, { ifMatch: '"1"' });
    expect(stale).toBeProblem(412, 'precondition-failed');
    expect((await librarian.books.get(book.id)).body).toMatchObject({ title: 'v2', version: 2 });
  });

  test('a successful PATCH bumps version and ETag together, and updatedAt moves forward', async ({ librarian, factory }) => {
    const { book } = await factory.book();
    const res = await librarian.books.update(book.id, { title: 'Second edition' }, { ifMatch: '"1"' });
    expect(res).toHaveStatus(200);
    expect(res.body.version).toBe(2);
    expect(res.header('etag')).toBe('"2"');
    expect(Date.parse(res.body.updatedAt)).toBeGreaterThanOrEqual(Date.parse(book.updatedAt));
    expect(res.body.createdAt).toBe(book.createdAt);

    const again = await librarian.books.update(book.id, { title: 'Third edition' }, { ifMatch: res.header('etag')! });
    expect(again.body.version).toBe(3);
  });

  test('PATCH of an unknown book is 404', async ({ librarian }) => {
    expect(await librarian.books.update(MISSING_ID, { title: 'x' }, { ifMatch: '"1"' })).toBeProblem(404, 'not-found');
  });

  test('five parallel PATCHes with the same If-Match: exactly one wins, the rest get 412', async ({ librarian, factory }) => {
    const { book } = await factory.book();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => librarian.books.update(book.id, { title: `Writer ${i}` }, { ifMatch: '"1"' })),
    );
    const winners = results.filter((r) => r.status === 200);
    expect(winners, results.map((r) => r.status).join(',')).toHaveLength(1);
    for (const loser of results.filter((r) => r.status !== 200)) expect(loser).toBeProblem(412, 'precondition-failed');

    const final = await librarian.books.get(book.id);
    expect(final.body).toMatchObject({ version: 2, title: winners[0]!.body.title });
  });
});

test.describe('books: JSON merge patch semantics', () => {
  test('omitted fields stay, null clears nullable fields, arrays are replaced', async ({ librarian, factory }) => {
    const other = await factory.author();
    const { book } = await factory.book({ description: 'Original', publishedYear: 1999, tags: ['a', 'b'] });

    const res = await librarian.books.update(
      book.id,
      { description: null, publishedYear: null, tags: ['c'], authorIds: [other.id] },
      { ifMatch: '"1"' },
    );

    expect(res).toHaveStatus(200);
    expect(res.body.title).toBe(book.title); // omitted -> unchanged
    expect(res.body.isbn).toBe(book.isbn);
    expect(res.body.description).toBeNull(); // null -> cleared
    expect(res.body.publishedYear).toBeNull();
    expect(res.body.tags).toEqual(['c']); // replaced, not merged
    expect(res.body.authors).toEqual([{ id: other.id, name: other.name }]);
  });

  test('application/json is accepted as well as application/merge-patch+json', async ({ librarian, factory }) => {
    const { book } = await factory.book();
    const res = await librarian.books.update(book.id, { title: 'Plain JSON' }, { ifMatch: '"1"', mediaType: 'application/json' });
    expect(res).toHaveStatus(200);
    expect(res.body.title).toBe('Plain JSON');
  });

  test('changing the authors makes the book findable by the new author name', async ({ librarian, anon, factory }) => {
    const surname = gen.word(12);
    const author = await factory.author(`Ada ${surname}`);
    const { book } = await factory.book();
    expect(await librarian.books.update(book.id, { authorIds: [author.id] }, { ifMatch: '"1"' })).toHaveStatus(200);

    const found = await anon.books.list({ q: surname });
    expect(found.body.data.map((b) => b.id)).toContain(book.id);
  });

  const invalidPatches: [string, unknown, string?][] = [
    ['an empty patch', {}],
    ['title: null (title is not nullable)', { title: null }, 'title'],
    ['an empty title', { title: '' }, 'title'],
    ['publishedYear out of range', { publishedYear: 3000 }, 'publishedYear'],
    ['an empty authorIds list', { authorIds: [] }, 'authorIds'],
    ['an unknown author', { authorIds: [MISSING_ID] }, 'authorIds'],
    ['an ISBN change (isbn is not patchable)', { isbn: '9780132350884' }],
    ['an unknown property', { colour: 'red' }],
  ];
  for (const [name, patch, field] of invalidPatches) {
    test(`rejects ${name} with 400 and leaves the book unchanged`, async ({ librarian, factory }) => {
      const { book } = await factory.book({ authorIds: [DEFAULT_AUTHOR_ID] });
      const res = await librarian.books.update(book.id, unchecked(patch), { ifMatch: '"1"' });
      expect(res).toBeProblem(400, 'validation-failed', field ? { fields: [field] } : {});
      expect((await librarian.books.get(book.id)).body.version).toBe(1);
    });
  }
});

test.describe('books: read cache (X-Cache)', () => {
  test('second read is a HIT; a PATCH evicts it so the next read is a fresh MISS', async ({ anon, librarian, factory }) => {
    const { book } = await factory.book();

    expect((await anon.books.get(book.id)).header('x-cache')).toBe('MISS');
    expect((await anon.books.get(book.id)).header('x-cache')).toBe('HIT');

    expect(await librarian.books.update(book.id, { title: 'After eviction' }, { ifMatch: '"1"' })).toHaveStatus(200);

    const afterWrite = await anon.books.get(book.id);
    expect(afterWrite.header('x-cache')).toBe('MISS');
    expect(afterWrite.body.title).toBe('After eviction');
  });

  test('borrowing, returning and adding copies evict the cached counters', async ({ anon, factory }) => {
    const borrower = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    const read = async () => (await anon.books.get(book.id)).body;

    await read(); // warm the cache
    expect(await read()).toMatchObject({ totalCopies: 1, availableCopies: 1 });

    const loan = await factory.loan(borrower, book.id);
    expect(await read()).toMatchObject({ totalCopies: 1, availableCopies: 0 });

    await factory.copy(book.id);
    expect(await read()).toMatchObject({ totalCopies: 2, availableCopies: 1 });

    expect(await borrower.api.loans.return(loan.id)).toHaveStatus(200);
    expect(await read()).toMatchObject({ totalCopies: 2, availableCopies: 2 });
  });
});
