/**
 * Fixed-window rate limiting per client (token subject, or IP when anonymous).
 *
 * The header checks run everywhere (the API client also checks the three headers on every /api response).
 * The 429 test needs an instance with a small limit (the default 120/min), so it only runs with
 * RATE_LIMIT_TEST=1. CI runs it against the time-travel instance, which keeps the default limit; the main
 * instances get RATE_LIMIT_PER_MINUTE=100000 from docker-compose.test.yml so the parallel suite never hits it.
 */
import { config } from '../../src/config';
import type { ApiResult } from '../../src/client/http';
import { expect, test } from '../../src/fixtures';

const num = (res: ApiResult<unknown>, name: string) => Number(res.header(name));

test.describe('rate limiting', () => {
  test('RateLimit-* headers are present and consistent', async ({ factory }) => {
    const who = await factory.member();
    const res = await who.api.members.me();
    const limit = num(res, 'ratelimit-limit');
    const remaining = num(res, 'ratelimit-remaining');
    const reset = num(res, 'ratelimit-reset');
    expect(limit).toBeGreaterThan(0);
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(remaining).toBeLessThan(limit);
    expect(reset).toBeGreaterThanOrEqual(0);
    expect(reset).toBeLessThanOrEqual(60);
  });

  test('each request uses one unit of the caller\'s own budget', async ({ factory }) => {
    const who = await factory.member(); // a fresh subject: nobody else spends this budget
    for (let attempt = 0; attempt < 3; attempt++) {
      const first = await who.api.members.me();
      const second = await who.api.members.me();
      if (num(second, 'ratelimit-reset') > num(first, 'ratelimit-reset')) continue; // window rolled over, retry
      expect(num(second, 'ratelimit-remaining')).toBe(num(first, 'ratelimit-remaining') - 1);
      return;
    }
    throw new Error('the window rolled over three times in a row');
  });

  test('over the limit: 429 rate-limited with Retry-After and Remaining 0 @rate-limit-429', async ({ factory }) => {
    test.skip(!config.rateLimitTest, 'set RATE_LIMIT_TEST=1 and point BASE_URL at an instance with a small RATE_LIMIT_PER_MINUTE');
    test.setTimeout(120_000);
    const who = await factory.member();
    const probe = await who.api.members.me();
    const limit = num(probe, 'ratelimit-limit');
    test.skip(limit > 1000, `limit is ${limit}/min; this test needs a small limit`);

    let limited: ApiResult<unknown> | undefined;
    for (let i = 0; i <= limit + 1 && !limited; i++) {
      const res = await who.api.members.me();
      if (res.status === 429) limited = res;
    }

    expect(limited, 'no 429 after exceeding the limit').toBeDefined();
    expect(limited!).toBeProblem(429, 'rate-limited');
    expect(limited!).toBeDocumentedInContract(); // SPEC "Decisions" 4: 429 is in the contract for every /api operation
    expect(num(limited!, 'retry-after')).toBeGreaterThanOrEqual(0);
    expect(num(limited!, 'retry-after')).toBeLessThanOrEqual(60);
    expect(num(limited!, 'ratelimit-remaining')).toBe(0);

    // the same budget applies to every /api route, public ones included (the token identifies the client)
    if (num(limited!, 'retry-after') > 2) {
      // (skipped when the window is about to roll over, which would make the next request legitimately pass)
      const other = await who.api.books.list({ limit: 1 });
      expect(other).toBeProblem(429, 'rate-limited');
      expect(other).toBeDocumentedInContract();
    }

    // health and metrics are exempt
    expect(await who.api.ops.live()).toHaveStatus(200);
    expect(await who.api.ops.metrics()).toHaveStatus(200);
  });
});
