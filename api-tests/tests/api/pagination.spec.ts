/**
 * Keyset (cursor) pagination: walking all pages returns every row exactly once, in order, and stays correct
 * when rows are inserted between page requests (which OFFSET pagination would get wrong).
 */
import type { ApiResult } from '../../src/client/http';
import type { Page } from '../../src/client/library-api';
import * as gen from '../../src/data/generators';
import { expect, test } from '../../src/fixtures';

/** Follows nextCursor until it is null and returns every page. */
async function walk<T>(fetchPage: (cursor?: string) => Promise<ApiResult<Page<T>>>, maxPages = 50): Promise<T[][]> {
  const pages: T[][] = [];
  let cursor: string | undefined;
  do {
    const res = await fetchPage(cursor);
    expect(res).toHaveStatus(200);
    pages.push(res.body.data);
    cursor = res.body.page.nextCursor ?? undefined;
    expect(pages.length, 'pagination does not terminate').toBeLessThanOrEqual(maxPages);
  } while (cursor);
  return pages;
}

test.describe('pagination: books', () => {
  test('7 books with limit=3 come back as pages of 3, 3, 1 with no duplicates or gaps, sorted by title', async ({ anon, factory }) => {
    const tag = gen.uniqueTag();
    const titles = ['delta', 'Alpha', 'golf', 'charlie', 'Echo', 'bravo', 'foxtrot'];
    const created = [];
    for (const title of titles) created.push((await factory.book({ title, tags: [tag] })).book);

    const pages = await walk((cursor) => anon.books.list({ tag, limit: 3, cursor }));

    expect(pages.map((p) => p.length)).toEqual([3, 3, 1]);
    const all = pages.flat();
    expect(new Set(all.map((b) => b.id)).size).toBe(7);
    expect(all.map((b) => b.id).sort()).toEqual(created.map((b) => b.id).sort());
    expect(all.map((b) => b.title)).toEqual(['Alpha', 'bravo', 'charlie', 'delta', 'Echo', 'foxtrot', 'golf']);
  });

  test('the last page has nextCursor null; an exactly full last page does not lead to an empty page', async ({ anon, factory }) => {
    const tag = gen.uniqueTag();
    for (let i = 0; i < 4; i++) await factory.book({ title: `book ${i}`, tags: [tag] });
    const pages = await walk((cursor) => anon.books.list({ tag, limit: 2, cursor }));
    expect(pages.map((p) => p.length)).toEqual([2, 2]);
  });

  test('page.limit echoes the requested limit and defaults to 20', async ({ anon }) => {
    expect((await anon.books.list({ limit: 1 })).body.page.limit).toBe(1);
    expect((await anon.books.list({ limit: 100 })).body.page.limit).toBe(100);
    const byDefault = await anon.books.list();
    expect(byDefault.body.page.limit).toBe(20);
    expect(byDefault.body.data.length).toBeLessThanOrEqual(20);
  });

  test('books with the same title are still paged deterministically (id breaks ties)', async ({ anon, factory }) => {
    const tag = gen.uniqueTag();
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await factory.book({ title: 'Same Title', tags: [tag] })).book.id);
    const all = (await walk((cursor) => anon.books.list({ tag, limit: 2, cursor }))).flat();
    expect(all.map((b) => b.id).sort()).toEqual(ids.sort());
    expect(new Set(all.map((b) => b.id)).size).toBe(5);
  });

  test('sort=-publishedYear pages correctly across the NULLS LAST boundary', async ({ anon, factory }) => {
    const tag = gen.uniqueTag();
    const years = [2001, undefined, 1990, 2015, undefined, 2001];
    for (const [i, publishedYear] of years.entries())
      await factory.book({ title: `y${i}`, tags: [tag], ...(publishedYear ? { publishedYear } : {}) });
    const all = (await walk((cursor) => anon.books.list({ tag, sort: '-publishedYear', limit: 2, cursor }))).flat();
    expect(all.map((b) => b.publishedYear)).toEqual([2015, 2001, 2001, 1990, null, null]);
  });

  test('search results page through without duplicates', async ({ anon, factory }) => {
    const term = gen.word();
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await factory.book({ title: `${term} volume ${i}` })).book.id);
    const all = (await walk((cursor) => anon.books.list({ q: term, limit: 2, cursor }))).flat();
    expect(all.map((b) => b.id).sort()).toEqual(ids.sort());
  });

  test('a book inserted before the cursor between two page requests does not shift the next page', async ({ anon, factory }) => {
    const tag = gen.uniqueTag();
    for (const title of ['b', 'c', 'd', 'e']) await factory.book({ title, tags: [tag] });

    const first = await anon.books.list({ tag, limit: 2 });
    expect(first.body.data.map((b) => b.title)).toEqual(['b', 'c']);

    await factory.book({ title: 'a', tags: [tag] }); // sorts before everything already seen

    const second = await anon.books.list({ tag, limit: 2, cursor: first.body.page.nextCursor! });
    // with OFFSET this would be ['c', 'd'] (c twice); keyset continues after 'c'
    expect(second.body.data.map((b) => b.title)).toEqual(['d', 'e']);
  });
});

test.describe('pagination: validation', () => {
  for (const limit of ['0', '101', '-1', 'ten', '2.5']) {
    test(`limit=${limit} is 400`, async ({ anon }) => {
      const res = await anon.http.send('GET', '/api/v1/books', { params: { limit } });
      expect(res).toBeProblem(400, 'validation-failed');
    });
  }

  for (const [name, cursor] of [
    ['random text', 'this-is-not-a-cursor'],
    ['base64url of something that is not JSON', Buffer.from('hello world').toString('base64url')],
    ['characters outside base64url', '%%%***'],
  ] as const) {
    test(`a cursor that is ${name} is 400`, async ({ anon }) => {
      expect(await anon.books.list({ cursor })).toBeProblem(400, 'validation-failed');
    });
  }
});

// SPEC "Decisions" 4: every list endpoint may return 400 for a bad limit or cursor, and the contract says so.
const lists = [
  { path: '/api/v1/books', as: 'anon' },
  { path: '/api/v1/authors', as: 'anon' },
  { path: '/api/v1/members', as: 'librarian' },
  { path: '/api/v1/loans', as: 'member' },
  { path: '/api/v2/loans', as: 'member' },
  { path: '/api/v1/reservations', as: 'member' },
] as const;

test.describe('pagination: 400 on every list endpoint', () => {
  for (const list of lists) {
    for (const [name, params] of [
      ['limit=0', { limit: 0 }],
      ['limit=101', { limit: 101 }],
      ['an unparsable cursor', { cursor: 'not-a-cursor!!' }],
    ] as const) {
      test(`GET ${list.path} with ${name} is a documented 400`, async ({ anon, librarian, member }) => {
        const api = { anon, librarian, member }[list.as];
        const res = await api.http.send('GET', list.path, { params });
        expect(res).toBeProblem(400, 'validation-failed');
        expect(res).toBeDocumentedInContract();
      });
    }
  }
});

test.describe('pagination: other lists', () => {
  test('authors page through with no duplicates (first pages)', async ({ anon, factory }) => {
    await factory.author();
    await factory.author();
    const first = await anon.authors.list({ limit: 2 });
    expect(first.body.data).toHaveLength(2);
    expect(first.body.page.nextCursor).not.toBeNull();
    const second = await anon.authors.list({ limit: 2, cursor: first.body.page.nextCursor! });
    expect(second).toHaveStatus(200);
    const ids = [...first.body.data, ...second.body.data].map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('a member\'s loans page newest first', async ({ factory }) => {
    const who = await factory.member({ maxActiveLoans: 5 });
    const loanIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { book } = await factory.book({ copies: 1 });
      loanIds.push((await factory.loan(who, book.id)).id);
    }
    const all = (await walk((cursor) => who.api.loans.list({ limit: 2, cursor }))).flat();
    expect(all.map((l) => l.id)).toEqual([...loanIds].reverse());
  });

  test('members page through as librarian with no duplicates', async ({ librarian, factory }) => {
    await factory.members(3);
    const first = await librarian.members.list({ limit: 2 });
    const second = await librarian.members.list({ limit: 2, cursor: first.body.page.nextCursor! });
    const ids = [...first.body.data, ...second.body.data].map((m) => m.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });
});
