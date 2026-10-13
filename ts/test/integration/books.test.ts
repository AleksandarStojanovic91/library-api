import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, TestApp, randomBarcode, randomIsbn } from './support/test-app';

let t: TestApp;
let librarian: string;
beforeAll(async () => {
  t = await TestApp.start();
  librarian = await t.librarian();
});
afterAll(() => t.close());

describe('creating books', () => {
  it('201 with Location, ETag "1" and the full representation', async () => {
    const isbn = randomIsbn();
    const res = await t.request('POST', '/api/v1/books', {
      token: librarian,
      body: { isbn, title: 'Refactoring', authorIds: [SEED.authorId], publishedYear: 1999, tags: ['software'] },
    });
    expect(res.status).toBe(201);
    expect(res.header('location')).toBe(`/api/v1/books/${res.body.id}`);
    expect(res.header('etag')).toBe('"1"');
    expect(res.body).toMatchObject({ isbn, title: 'Refactoring', description: null, publishedYear: 1999, totalCopies: 0, availableCopies: 0, version: 1 });
    expect(res.body.authors).toEqual([{ id: SEED.authorId, name: 'Robert C. Martin' }]);
  });

  it('rejects a wrong ISBN-13 check digit, unknown authors and duplicate ISBNs', async () => {
    const bad = await t.request('POST', '/api/v1/books', { token: librarian, body: { isbn: '9780132350885', title: 'x', authorIds: [SEED.authorId] } });
    expect(bad.body.errors).toEqual([{ field: 'isbn', message: 'Invalid ISBN-13 check digit' }]);

    const unknownAuthor = await t.request('POST', '/api/v1/books', {
      token: librarian,
      body: { isbn: randomIsbn(), title: 'x', authorIds: ['10000000-0000-4000-8000-0000000000ff'] },
    });
    expect(unknownAuthor.status).toBe(400);
    expect(unknownAuthor.body.errors[0].field).toBe('authorIds');

    const duplicate = await t.request('POST', '/api/v1/books', { token: librarian, body: { isbn: '9780132350884', title: 'x', authorIds: [SEED.authorId] } });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('duplicate');
  });

  it('rejects a duplicate copy barcode', async () => {
    const book = await t.newBook();
    const barcode = randomBarcode();
    const first = await t.request('POST', `/api/v1/books/${book.id}/copies`, { token: librarian, body: { barcode } });
    const second = await t.request('POST', `/api/v1/books/${book.id}/copies`, { token: librarian, body: { barcode } });
    expect(first.status).toBe(201);
    expect(second.body.code).toBe('duplicate');
  });
});

describe('ETags, caching and merge patch', () => {
  it('GET returns the ETag; a matching If-None-Match is 304', async () => {
    const book = await t.newBook();
    const res = await t.request('GET', `/api/v1/books/${book.id}`);
    expect(res.header('etag')).toBe('"1"');
    expect((await t.request('GET', `/api/v1/books/${book.id}`, { headers: { 'if-none-match': '"1"' } })).status).toBe(304);
    expect((await t.request('GET', `/api/v1/books/${book.id}`, { headers: { 'if-none-match': 'W/"1"' } })).status).toBe(304);
    expect((await t.request('GET', `/api/v1/books/${book.id}`, { headers: { 'if-none-match': '"2"' } })).status).toBe(200);
  });

  it('X-Cache is MISS then HIT, and a write evicts the entry', async () => {
    const book = await t.newBook();
    expect((await t.request('GET', `/api/v1/books/${book.id}`)).header('x-cache')).toBe('MISS');
    expect((await t.request('GET', `/api/v1/books/${book.id}`)).header('x-cache')).toBe('HIT');
    await t.request('POST', `/api/v1/books/${book.id}/copies`, { token: librarian, body: { barcode: `C-${book.id.slice(0, 8).toUpperCase()}` } });
    const after = await t.request('GET', `/api/v1/books/${book.id}`);
    expect(after.header('x-cache')).toBe('MISS');
    expect(after.body.totalCopies).toBe(1);
  });

  it('PATCH needs If-Match (428), rejects a stale one (412) and bumps the version on success', async () => {
    const book = await t.newBook();
    const missing = await t.request('PATCH', `/api/v1/books/${book.id}`, { token: librarian, body: { title: 'New' } });
    expect(missing.status).toBe(428);
    expect(missing.body.code).toBe('precondition-required');

    const stale = await t.request('PATCH', `/api/v1/books/${book.id}`, { token: librarian, body: { title: 'New' }, headers: { 'if-match': '"7"' } });
    expect(stale.status).toBe(412);

    const ok = await t.request('PATCH', `/api/v1/books/${book.id}`, {
      token: librarian,
      body: { title: 'New title', description: 'Some text' },
      headers: { 'if-match': '"1"', 'content-type': 'application/merge-patch+json' },
    });
    expect(ok.status).toBe(200);
    expect(ok.header('etag')).toBe('"2"');
    expect(ok.body).toMatchObject({ title: 'New title', description: 'Some text', version: 2 });

    // the old ETag is now stale
    expect((await t.request('PATCH', `/api/v1/books/${book.id}`, { token: librarian, body: { title: 'x' }, headers: { 'if-match': '"1"' } })).status).toBe(412);
  });

  it('merge patch: null clears a nullable field, absent fields stay, authorIds replaces the list', async () => {
    const book = await t.newBook({ publishedYear: 2001, tags: ['a', 'b'] });
    const res = await t.request('PATCH', `/api/v1/books/${book.id}`, {
      token: librarian,
      body: { publishedYear: null, authorIds: ['10000000-0000-4000-8000-000000000004', SEED.authorId] },
      headers: { 'if-match': '"1"' },
    });
    expect(res.status).toBe(200);
    expect(res.body.publishedYear).toBeNull();
    expect(res.body.tags).toEqual(['a', 'b']);
    expect(res.body.authors.map((a: { name: string }) => a.name)).toEqual(['Kent Beck', 'Robert C. Martin']);
    expect((await t.request('PATCH', `/api/v1/books/${book.id}`, { token: librarian, body: { title: null }, headers: { 'if-match': '"2"' } })).status).toBe(400);
    expect((await t.request('PATCH', `/api/v1/books/${book.id}`, { token: librarian, body: {}, headers: { 'if-match': '"2"' } })).status).toBe(400);
  });
});

describe('deleting books', () => {
  it('409 book-has-active-loans while a copy is on loan, 409 book-has-loan-history afterwards, 204 if never lent', async () => {
    const member = await t.newMember();
    const lent = await t.newBook({ copies: 1 });
    const loan = await t.borrow(member.token, lent.id);
    expect((await t.request('DELETE', `/api/v1/books/${lent.id}`, { token: librarian })).body.code).toBe('book-has-active-loans');
    await t.request('POST', `/api/v2/loans/${loan.body.id}/return`, { token: member.token });
    expect((await t.request('DELETE', `/api/v1/books/${lent.id}`, { token: librarian })).body.code).toBe('book-has-loan-history');

    const unused = await t.newBook({ copies: 2 });
    expect((await t.request('DELETE', `/api/v1/books/${unused.id}`, { token: librarian })).status).toBe(204);
    expect((await t.request('GET', `/api/v1/books/${unused.id}`)).status).toBe(404);
  });
});

describe('search', () => {
  it('full-text search over title, description and author names, ranked', async () => {
    const tag = `fts-${Date.now()}`;
    const book = await t.newBook({ title: 'Quantum Gardening Handbook', tags: [tag] });
    const res = await t.request('GET', `/api/v1/books?q=${encodeURIComponent('quantum gardening')}&tag=${tag}`);
    expect(res.body.data.map((b: { id: string }) => b.id)).toEqual([book.id]);
    const byAuthor = await t.request('GET', `/api/v1/books?q=Kleppmann`);
    expect(byAuthor.body.data.map((b: { title: string }) => b.title)).toContain('Designing Data-Intensive Applications');
  });

  it('falls back to trigram similarity on the title when full text finds nothing', async () => {
    await t.newBook({ title: 'Kubernetes Patterns' });
    const res = await t.request('GET', `/api/v1/books?q=${encodeURIComponent('Kubernets Paterns')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((b: { title: string }) => b.title)).toContain('Kubernetes Patterns');
  });

  it('filters by author, tag and availability', async () => {
    const tag = `filter-${Date.now()}`;
    const withCopy = await t.newBook({ copies: 1, tags: [tag] });
    await t.newBook({ tags: [tag] });
    const available = await t.request('GET', `/api/v1/books?tag=${tag}&available=true&authorId=${SEED.authorId}`);
    expect(available.body.data.map((b: { id: string }) => b.id)).toEqual([withCopy.id]);
  });
});
