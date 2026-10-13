/**
 * GET /api/v1/books?q=  : full-text search (title > author > description) with a trigram fallback on the title
 * when full-text finds nothing. Every test searches for made-up words, so other books never interfere.
 */
import { seed } from '../../src/config';
import * as gen from '../../src/data/generators';
import { expect, test } from '../../src/fixtures';

test.describe('search: full text', () => {
  test('finds a book by a word in its title', async ({ anon, factory }) => {
    const term = gen.word();
    const { book } = await factory.book({ title: `The ${term} handbook` });
    const res = await anon.books.list({ q: term });
    expect(res).toHaveStatus(200);
    expect(res.body.data.map((b) => b.id)).toEqual([book.id]);
  });

  test('finds a book by a word in its description', async ({ anon, factory }) => {
    const term = gen.word();
    const { book } = await factory.book({ description: `A story about ${term} and friends.` });
    expect((await anon.books.list({ q: term })).body.data.map((b) => b.id)).toEqual([book.id]);
  });

  test('finds a book by its author\'s name', async ({ anon, factory }) => {
    const surname = gen.word();
    const author = await factory.author(`Ada ${surname}`);
    const { book } = await factory.book({ authorIds: [author.id] });
    expect((await anon.books.list({ q: surname })).body.data.map((b) => b.id)).toEqual([book.id]);
  });

  test('finds seeded books by author (Kleppmann -> DDIA)', async ({ anon }) => {
    const res = await anon.books.list({ q: 'kleppmann' });
    expect(res.body.data.map((b) => b.id)).toContain(seed.books.ddia.id);
  });

  test('ranks a title match above a description match', async ({ anon, factory }) => {
    const term = gen.word();
    const { book: inDescription } = await factory.book({ title: 'Aaaa first by title', description: `mentions ${term} once` });
    const { book: inTitle } = await factory.book({ title: `Zzzz ${term}` });
    const ids = (await anon.books.list({ q: term })).body.data.map((b) => b.id);
    expect(ids).toEqual([inTitle.id, inDescription.id]);
  });

  test('supports websearch syntax: two words must both match', async ({ anon, factory }) => {
    const [a, b] = [gen.word(), gen.word()];
    const { book: both } = await factory.book({ title: `${a} ${b}` });
    await factory.book({ title: `${a} only` });
    expect((await anon.books.list({ q: `${a} ${b}` })).body.data.map((x) => x.id)).toEqual([both.id]);
  });

  test('q can be combined with filters (tag)', async ({ anon, factory }) => {
    const term = gen.word();
    const tag = gen.uniqueTag();
    const { book: tagged } = await factory.book({ title: `${term} one`, tags: [tag] });
    await factory.book({ title: `${term} two` });
    expect((await anon.books.list({ q: term, tag })).body.data.map((b) => b.id)).toEqual([tagged.id]);
  });

  test('q longer than 200 characters is 400', async ({ anon }) => {
    expect(await anon.books.list({ q: 'a'.repeat(201) })).toBeProblem(400, 'validation-failed');
  });
});

test.describe('search: trigram fallback on title', () => {
  test('a misspelled title still finds the book when full text finds nothing', async ({ anon, factory }) => {
    const title = gen.word(14);
    const typo = title.slice(0, 6) + (title[6] === 'x' ? 'y' : 'x') + title.slice(7); // one wrong letter
    const { book } = await factory.book({ title });

    const res = await anon.books.list({ q: typo });
    expect(res).toHaveStatus(200);
    expect(res.body.data.map((b) => b.id)).toContain(book.id);
  });

  test('the fallback is not used when full text already finds something', async ({ anon, factory }) => {
    const title = gen.word(14);
    const { book: exact } = await factory.book({ title });
    // a near-identical title that full-text does NOT match but trigram would
    const { book: similar } = await factory.book({ title: title.slice(0, 13) + (title[13] === 'q' ? 'r' : 'q') });

    const ids = (await anon.books.list({ q: title })).body.data.map((b) => b.id);
    expect(ids).toContain(exact.id);
    expect(ids).not.toContain(similar.id);
  });

  test('nonsense finds nothing (empty page, nextCursor null)', async ({ anon }) => {
    const res = await anon.books.list({ q: `${gen.word(10)} ${gen.word(10)}` });
    expect(res).toHaveStatus(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.page.nextCursor).toBeNull();
  });
});

test.describe('books: filters and sorting', () => {
  test('filter by tag', async ({ anon, factory }) => {
    const tag = gen.uniqueTag();
    const { book: a } = await factory.book({ tags: [tag, 'x'] });
    const { book: b } = await factory.book({ tags: [tag] });
    await factory.book({ tags: ['x'] });
    const ids = (await anon.books.list({ tag })).body.data.map((x) => x.id);
    expect(ids.sort()).toEqual([a.id, b.id].sort());
  });

  test('filter by author', async ({ anon, factory }) => {
    const author = await factory.author();
    const { book: a } = await factory.book({ authorIds: [author.id] });
    const { book: b } = await factory.book({ authorIds: [author.id, seed.authors.kleppmann.id] });
    const ids = (await anon.books.list({ authorId: author.id })).body.data.map((x) => x.id);
    expect(ids.sort()).toEqual([a.id, b.id].sort());
  });

  test('available=true only returns books with an AVAILABLE copy, and follows loans', async ({ anon, factory }) => {
    const tag = gen.uniqueTag();
    const borrower = await factory.member();
    const { book: withCopy } = await factory.book({ tags: [tag], copies: 1 });
    await factory.book({ tags: [tag] }); // no copies

    expect((await anon.books.list({ tag, available: true })).body.data.map((b) => b.id)).toEqual([withCopy.id]);

    await factory.loan(borrower, withCopy.id);
    expect((await anon.books.list({ tag, available: true })).body.data).toEqual([]);
    expect((await anon.books.list({ tag })).body.data).toHaveLength(2);
  });

  test('default sort is by title, case-insensitive', async ({ anon, factory }) => {
    const tag = gen.uniqueTag();
    for (const title of ['banana', 'Cherry', 'apple', 'Apricot']) await factory.book({ title, tags: [tag] });
    const titles = (await anon.books.list({ tag })).body.data.map((b) => b.title);
    expect(titles).toEqual(['apple', 'Apricot', 'banana', 'Cherry']);
  });

  test('sort=-publishedYear puts the newest first and books without a year last', async ({ anon, factory }) => {
    const tag = gen.uniqueTag();
    await factory.book({ title: 'old', publishedYear: 1999, tags: [tag] });
    await factory.book({ title: 'none', tags: [tag] });
    await factory.book({ title: 'new', publishedYear: 2020, tags: [tag] });
    const titles = (await anon.books.list({ tag, sort: '-publishedYear' })).body.data.map((b) => b.title);
    expect(titles).toEqual(['new', 'old', 'none']);
  });

  test('an unknown sort value is 400', async ({ anon }) => {
    const res = await anon.http.send('GET', '/api/v1/books', { params: { sort: 'isbn' } });
    expect(res).toBeProblem(400, 'validation-failed');
  });
});
