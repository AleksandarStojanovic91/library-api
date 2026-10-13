import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['test/integration/global-setup.ts'],
          // Files share one Postgres/Redis container pair; run them one at a time so the
          // concurrency tests are not competing with other files for CPU and connections.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 240_000,
        },
      },
    ],
  },
});
