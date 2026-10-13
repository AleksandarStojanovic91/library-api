/**
 * Request ids, health probes, Prometheus metrics, and the served contract / Swagger UI.
 */
import fs from 'node:fs';
import YAML from 'yaml';
import { config, MISSING_ID, seed } from '../../src/config';
import { expect, test } from '../../src/fixtures';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test.describe('X-Request-Id', () => {
  test('a valid client id is echoed on success and on errors (and in problem.requestId)', async ({ anon }) => {
    const id = 'trace-me_0123456789';
    const ok = await anon.books.get(seed.books.cleanCode.id, { requestId: id });
    expect(ok.header('x-request-id')).toBe(id);

    const err = await anon.books.get(MISSING_ID, { requestId: id });
    expect(err.header('x-request-id')).toBe(id);
    expect(err.problem.requestId).toBe(id);
  });

  test('without a client id the service generates a UUID', async ({ anon }) => {
    const res = await anon.books.list({ limit: 1 }, { requestId: null });
    expect(res.header('x-request-id')).toMatch(UUID);
  });

  for (const [name, bad] of [
    ['too short (7 chars)', 'abc1234'],
    ['too long (101 chars)', 'a'.repeat(101)],
    ['with forbidden characters', 'bad id; drop table'],
  ] as const) {
    test(`an invalid client id ${name} is replaced by a generated UUID`, async ({ anon }) => {
      const res = await anon.books.list({ limit: 1 }, { requestId: bad });
      expect(res.header('x-request-id')).toMatch(UUID);
    });
  }

  test('ids at the length limits (8 and 100 chars) are accepted', async ({ anon }) => {
    for (const id of ['a'.repeat(8), 'b'.repeat(100)]) {
      expect((await anon.books.list({ limit: 1 }, { requestId: id })).header('x-request-id')).toBe(id);
    }
  });

  test('every response gets a different generated id', async ({ anon }) => {
    const ids = await Promise.all(Array.from({ length: 5 }, async () => (await anon.ops.live()).requestId));
    expect(new Set(ids).size).toBe(5);
  });
});

test.describe('health', () => {
  test('/health/live is UP without auth', async ({ anon }) => {
    const res = await anon.ops.live();
    expect(res).toHaveStatus(200);
    expect(res.body.status).toBe('UP');
  });

  test('/health/ready checks the database and Redis', async ({ anon }) => {
    const res = await anon.ops.ready();
    expect(res).toHaveStatus(200);
    expect(res.body.status).toBe('UP');
    expect(res.body.checks?.redis).toBe('UP');
    expect(Object.keys(res.body.checks ?? {}).length).toBeGreaterThanOrEqual(2);
    expect(Object.values(res.body.checks ?? {}).every((v) => v === 'UP')).toBe(true);
  });
});

test.describe('metrics', () => {
  const sample = (text: string, name: string) =>
    text
      .split('\n')
      .filter((l) => l.startsWith(name) && !l.startsWith('#'))
      .reduce((sum, l) => sum + Number(l.trim().split(/\s+/).pop()), 0);

  test('/metrics exposes the HTTP histogram and the library metrics in Prometheus text format', async ({ anon }) => {
    await anon.books.list({ limit: 1 }); // make sure at least one request was measured
    const res = await anon.ops.metrics();
    expect(res).toHaveStatus(200);
    expect(res.header('content-type')).toMatch(/^text\/plain/);
    for (const name of ['http_server_requests', 'library_loans_borrowed_total', 'library_loans_returned_total', 'library_outbox_backlog']) {
      expect(res.text, `metric ${name}`).toMatch(new RegExp(`^${name}`, 'm'));
    }
    expect(res.text).toMatch(/^http_server_requests\w*_bucket\{/m);
  });

  test('library_loans_borrowed_total and _returned_total go up when a loan is made and returned', async ({ anon, factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    const before = (await anon.ops.metrics()).text;

    const loan = await factory.loan(who, book.id);
    await who.api.loans.return(loan.id);

    const after = (await anon.ops.metrics()).text;
    // other workers may borrow at the same time, so "at least one more"
    expect(sample(after, 'library_loans_borrowed_total')).toBeGreaterThanOrEqual(sample(before, 'library_loans_borrowed_total') + 1);
    expect(sample(after, 'library_loans_returned_total')).toBeGreaterThanOrEqual(sample(before, 'library_loans_returned_total') + 1);
  });
});

test.describe('API docs', () => {
  test('/openapi.yaml serves exactly the shared contract', async ({ anon }) => {
    const res = await anon.ops.openapi();
    expect(res).toHaveStatus(200);
    const served = YAML.parse(res.text);
    const repo = YAML.parse(fs.readFileSync(config.contractPath, 'utf8'));
    expect(served).toEqual(repo);
  });

  test('/docs serves Swagger UI', async ({ anon }) => {
    const res = await anon.ops.docs();
    expect(res).toHaveStatus(200);
    expect(res.header('content-type')).toMatch(/text\/html/);
    expect(res.text.toLowerCase()).toContain('swagger');
  });
});
