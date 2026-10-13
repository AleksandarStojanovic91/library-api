import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestApp, type HttpResult } from './support/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await TestApp.start();
});
afterAll(() => t.close());

/** Follows nextCursor until it is null and returns every page. */
async function allPages(firstUrl: string, token?: string): Promise<HttpResult[]> {
  const pages: HttpResult[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const page: HttpResult = await t.request('GET', url, { token });
    expect(page.status).toBe(200);
    pages.push(page);
    const cursor: string | null = page.body.page.nextCursor;
    url = cursor ? `${firstUrl}&cursor=${encodeURIComponent(cursor)}` : null;
    if (pages.length > 50) throw new Error('pagination does not terminate');
  }
  return pages;
}

describe('keyset pagination', () => {
  it('pages through books by title without gaps or duplicates', async () => {
    const tag = `page-${randomUUID().slice(0, 8)}`;
    // Equal titles force the id tie-breaker to do its job.
    for (let i = 0; i < 25; i++) await t.newBook({ title: `Paged ${String(i % 7).padStart(2, '0')}`, tags: [tag] });

    const pages = await allPages(`/api/v1/books?tag=${tag}&limit=10`);
    expect(pages.map((p) => p.body.data.length)).toEqual([10, 10, 5]);
    expect(pages.at(-1)?.body.page.nextCursor).toBeNull();
    const rows = pages.flatMap((p) => p.body.data as { id: string; title: string }[]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(25);
    const keys = rows.map((r) => `${r.title.toLowerCase()}|${r.id}`);
    expect(keys).toEqual([...keys].sort());
  });

  it('sorts -publishedYear descending with books without a year last', async () => {
    const tag = `year-${randomUUID().slice(0, 8)}`;
    const years = [1999, 2010, undefined, 2010, 1450, undefined, 2024];
    for (const year of years) await t.newBook({ tags: [tag], ...(year !== undefined && { publishedYear: year }) });

    const pages = await allPages(`/api/v1/books?tag=${tag}&sort=-publishedYear&limit=2`);
    const got = pages.flatMap((p) => p.body.data.map((b: { publishedYear: number | null }) => b.publishedYear));
    expect(got).toEqual([2024, 2010, 2010, 1999, 1450, null, null]);
  });

  it('pages through loans newest first', async () => {
    const member = await t.newMember({ maxActiveLoans: 5 });
    const loanIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const book = await t.newBook({ copies: 1 });
      loanIds.push((await t.borrow(member.token, book.id)).body.id);
    }
    const pages = await allPages('/api/v2/loans?limit=2', member.token);
    const ids = pages.flatMap((p) => p.body.data.map((l: { id: string }) => l.id));
    expect(ids).toEqual([...loanIds].reverse());
  });

  it('rejects bad limits and cursors with 400', async () => {
    for (const query of ['limit=0', 'limit=101', 'limit=abc', 'limit=2.5', 'cursor=not-a-cursor', `cursor=${Buffer.from('{"x":1}').toString('base64url')}`]) {
      const res = await t.request('GET', `/api/v1/books?${query}`);
      expect(res.status, query).toBe(400);
      expect(res.body.code).toBe('validation-failed');
    }
  });

  it('a cursor from one sort order is rejected by another', async () => {
    const first = await t.request('GET', '/api/v1/books?limit=1');
    const cursor = encodeURIComponent(first.body.page.nextCursor);
    expect((await t.request('GET', `/api/v1/books?limit=1&sort=-publishedYear&cursor=${cursor}`)).status).toBe(400);
  });

  it('pages through equally ranked search results', async () => {
    const word = `zyx${randomUUID().slice(0, 6)}`;
    for (let i = 0; i < 5; i++) await t.newBook({ title: `${word} volume` });
    const pages = await allPages(`/api/v1/books?q=${word}&limit=2`);
    expect(new Set(pages.flatMap((p) => p.body.data.map((b: { id: string }) => b.id))).size).toBe(5);
  });
});
