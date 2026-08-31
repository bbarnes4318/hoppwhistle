import { defineConfig } from 'vitest/config';

/**
 * Suites that talk to a real database, which must not run beside each other.
 *
 * Each of these truncates shared tables in `beforeEach` -- `TRUNCATE TABLE
 * "tenants" CASCADE` and friends -- so running two of them at once means one
 * deletes the other's fixtures mid-test. That is not hypothetical: with the
 * default file parallelism, security.test.ts fails on
 * `expected [] to include 'admin@test.local'`, because another suite wiped the
 * users it had just seeded. The failure moves around between runs, which is the
 * worst kind: it reads as a flaky security test rather than as a fixture race.
 */
const DATABASE_BACKED = [
  '**/src/__tests__/security.test.ts',
  '**/src/__tests__/db-push-constraints.test.ts',
  '**/src/services/__tests__/ai-campaign-service.db.test.ts',
  '**/src/services/__tests__/ai-campaign-service.raw-sql.test.ts',
  '**/src/services/__tests__/flow-store.test.ts',
  '**/src/services/__tests__/pay-per-call-integration.test.ts',
  '**/src/services/provisioning/__tests__/provisioning-service.test.ts',
];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',

    // The database-backed suites go to the `forks` pool, which is configured
    // below to use a single process, so they run one after another. Everything
    // else stays on the default `threads` pool and keeps running in parallel --
    // serialising all 39 files to fix 5 of them would be a poor trade.
    poolMatchGlobs: DATABASE_BACKED.map(glob => [glob, 'forks'] as [string, 'forks']),

    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
