/**
 * Test fixtures. Import `test` and `expect` from here, never from @playwright/test directly.
 *
 * Worker scope (once per worker process): tokens for the seeded librarian and members.
 * Test scope: API clients bound to Playwright's `request` (so calls show up in traces) and a data factory.
 *
 *   test('...', async ({ anon, librarian, member, factory }) => { ... })
 *
 * Tests that borrow or reserve always use `factory.member()` (a fresh member with its own loan limit and its
 * own rate-limit bucket); the seeded `member` / `member2` are only used for reads and authorization checks.
 */
import { test as base } from '@playwright/test';
import { LibraryApi } from './client/library-api';
import { login, TestDataFactory } from './data/factory';
import { seed } from './config';
import { expect } from './matchers';

interface WorkerOptions {
  /** Base URL of the implementation under test (set per Playwright project). */
  apiBaseURL: string;
  /** Second instance with CLOCK_OFFSET_SECONDS (time-travel projects only). */
  overdueBaseURL: string | undefined;
}

interface WorkerFixtures {
  tokens: { librarian: string; member: string; member2: string };
}

interface TestFixtures {
  anon: LibraryApi;
  librarian: LibraryApi;
  /** Seeded member@library.test: read-only use. */
  member: LibraryApi;
  /** Seeded member2@library.test: read-only use. */
  member2: LibraryApi;
  factory: TestDataFactory;
  /** Clients for the time-travel instance (OVERDUE_BASE_URL); tests using it are skipped when it is not set. */
  future: { anon: LibraryApi; librarian: LibraryApi; loginAs: (email: string, password: string) => Promise<LibraryApi> };
}

export const test = base.extend<TestFixtures, WorkerOptions & WorkerFixtures>({
  apiBaseURL: ['http://localhost:8081', { scope: 'worker', option: true }],
  overdueBaseURL: [undefined, { scope: 'worker', option: true }],

  tokens: [
    async ({ apiBaseURL, playwright }, use) => {
      const ctx = await playwright.request.newContext({ baseURL: apiBaseURL });
      try {
        const api = new LibraryApi(ctx);
        const [librarian, member, member2] = await Promise.all([
          login(api, seed.librarian.email, seed.librarian.password),
          login(api, seed.member.email, seed.member.password),
          login(api, seed.member2.email, seed.member2.password),
        ]).catch((error: Error) => {
          throw new Error(`Could not log the seeded users in at ${apiBaseURL}. Is the service running and seeded?\n${error.message}`);
        });
        await use({ librarian, member, member2 });
      } finally {
        await ctx.dispose();
      }
    },
    { scope: 'worker' },
  ],

  anon: async ({ request }, use) => use(new LibraryApi(request)),
  librarian: async ({ request, tokens }, use) => use(new LibraryApi(request, tokens.librarian)),
  member: async ({ request, tokens }, use) => use(new LibraryApi(request, tokens.member)),
  member2: async ({ request, tokens }, use) => use(new LibraryApi(request, tokens.member2)),
  factory: async ({ librarian }, use) => use(new TestDataFactory(librarian)),

  future: async ({ overdueBaseURL, playwright }, use, testInfo) => {
    testInfo.skip(!overdueBaseURL, 'OVERDUE_BASE_URL is not set (see api-tests/README.md, "Time travel")');
    const ctx = await playwright.request.newContext({ baseURL: overdueBaseURL });
    const anon = new LibraryApi(ctx);
    // SPEC "Decisions" 8: JWT iat/exp use real time, so tokens from either instance work on both.
    // Logging in on the future instance anyway keeps each test's identity explicit.
    const librarian = anon.as(await login(anon, seed.librarian.email, seed.librarian.password));
    await use({ anon, librarian, loginAs: async (email, password) => anon.as(await login(anon, email, password)) });
    await ctx.dispose();
  },
});

export { expect };
