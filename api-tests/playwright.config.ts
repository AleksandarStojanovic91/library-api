import { defineConfig } from '@playwright/test';
import { config, implementations, type Implementation } from './src/config';

/**
 * Projects
 *   unit                 offline self-tests of the suite's own helpers (contract validator, ISBN, JWT); no server
 *   java / ts            the shared black-box suite against one implementation
 *   java-time-travel /   overdue fees and reservation expiry; needs a second instance started with
 *   ts-time-travel       CLOCK_OFFSET_SECONDS and OVERDUE_BASE_URL pointing at it, otherwise skipped
 *
 * BASE_URL overrides the URL of the implementation project you run, e.g.
 *   BASE_URL=http://staging:8081 npx playwright test --project=java
 */
const apiProjects = (Object.keys(implementations) as Implementation[]).flatMap((impl) => {
  const apiBaseURL = config.baseUrlOverride ?? implementations[impl];
  return [
    {
      name: impl,
      testDir: './tests/api',
      use: { apiBaseURL, baseURL: apiBaseURL },
    },
    {
      name: `${impl}-time-travel`,
      testDir: './tests/time-travel',
      use: { apiBaseURL, baseURL: apiBaseURL, overdueBaseURL: config.overdueBaseUrl },
    },
  ];
});

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries: a flaky API test is a finding (usually a race in the service), not noise to hide.
  retries: 0,
  workers: process.env.CI ? 4 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: process.env.PW_REPORT_DIR ?? 'playwright-report' }],
    ['junit', { outputFile: `${process.env.PW_REPORT_DIR ?? 'playwright-report'}/junit.xml` }],
  ],
  use: {
    // API calls made through the `request` fixture are recorded in the trace (request + response bodies)
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'unit', testDir: './tests/unit' }, ...apiProjects],
});
