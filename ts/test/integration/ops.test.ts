import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, TestApp } from './support/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await TestApp.start();
});
afterAll(() => t.close());

describe('health, metrics and docs', () => {
  it('live is UP; ready checks the database and Redis', async () => {
    expect((await t.request('GET', '/health/live')).body).toEqual({ status: 'UP' });
    const ready = await t.request('GET', '/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'UP', checks: { db: 'UP', redis: 'UP' } });
  });

  it('exposes the SPEC metric names in Prometheus format', async () => {
    const member = await t.newMember();
    const book = await t.newBook({ copies: 1 });
    const loan = await t.borrow(member.token, book.id);
    await t.request('POST', `/api/v2/loans/${loan.body.id}/return`, { token: member.token });

    const res = await t.request('GET', '/metrics');
    expect(res.header('content-type')).toMatch(/^text\/plain/);
    expect(res.body).toMatch(/^http_server_requests_seconds_bucket\{.*route="\/api\/v2\/loans".*\}/m);
    expect(res.body).toMatch(/^library_loans_borrowed_total [1-9]/m);
    expect(res.body).toMatch(/^library_loans_returned_total [1-9]/m);
    expect(res.body).toMatch(/^library_outbox_backlog \d+/m);
  });

  it('serves the shared contract and Swagger UI', async () => {
    const yaml = await t.request('GET', '/openapi.yaml');
    expect(yaml.status).toBe(200);
    expect(yaml.body).toContain('openapi: 3.1.0');
    const docs = await t.request('GET', '/docs/');
    expect(docs.status).toBe(200);
    expect(docs.header('content-type')).toMatch(/text\/html/);
  });

  it('sets RateLimit headers on API responses, errors included', async () => {
    for (const res of [await t.request('GET', '/api/v1/books?limit=1'), await t.request('GET', '/api/v1/members/me')]) {
      expect(Number(res.header('ratelimit-limit'))).toBe(100000);
      expect(Number(res.header('ratelimit-remaining'))).toBeGreaterThanOrEqual(0);
      expect(Number(res.header('ratelimit-reset'))).toBeLessThanOrEqual(60);
    }
  });
});

describe('rate limiting', () => {
  it('429 rate-limited with Retry-After once the per-minute budget is spent; health is exempt', async () => {
    // Own namespace (SPEC Decisions 23): requests counted by the main instance do not spend this budget.
    const limited = await t.startSibling({ RATE_LIMIT_PER_MINUTE: '3', RATE_LIMIT_NAMESPACE: 'rl-limited' });
    try {
      // Fixed windows: if the minute rolls over mid-burst the budget resets, so retry with a fresh member.
      for (let attempt = 0; attempt < 3; attempt++) {
        const member = await t.newMember();
        for (let i = 0; i < 3; i++) await t.request('GET', '/api/v1/members/me', { token: member.token });
        const burst = [];
        for (let i = 0; i < 4; i++) burst.push(await limited.request('GET', '/api/v1/members/me', { token: member.token }));
        const resets = burst.map((r) => Number(r.header('ratelimit-reset')));
        if (resets.some((reset, i) => i > 0 && reset > resets[i - 1]!)) continue;

        expect(burst.slice(0, 3).map((r) => r.status)).toEqual([200, 200, 200]);
        const blocked = burst[3]!;
        expect(blocked.status).toBe(429);
        expect(blocked.body.code).toBe('rate-limited');
        expect(Number(blocked.header('retry-after'))).toBeGreaterThan(0);
        expect(blocked.header('ratelimit-remaining')).toBe('0');
        expect((await limited.request('GET', '/health/live')).status).toBe(200);
        return;
      }
      throw new Error('the rate-limit window rolled over three times in a row');
    } finally {
      await limited.close();
    }
  });
});

describe('Redis outage', () => {
  it('reads fall back to the database, readiness reports redis DOWN, nothing is rate limited', async () => {
    const noRedis = await t.startSibling({ REDIS_URL: 'redis://127.0.0.1:1/1' });
    try {
      const book = await noRedis.request('GET', `/api/v1/books/${SEED.cleanCodeId}`);
      expect(book.status).toBe(200);
      expect(book.header('x-cache')).toBe('MISS');
      expect(book.header('ratelimit-limit')).toBeUndefined();
      const ready = await noRedis.request('GET', '/health/ready');
      expect(ready.status).toBe(200);
      expect(ready.body.checks).toEqual({ db: 'UP', redis: 'DOWN' });
    } finally {
      await noRedis.close();
    }
  });
});
