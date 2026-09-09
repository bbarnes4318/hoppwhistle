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
  '**/src/__tests__/tenant-isolation.test.ts',
  '**/src/__tests__/platform-admin.test.ts',
  '**/src/__tests__/rating-engine.test.ts',
  '**/src/__tests__/settlement.test.ts',
  '**/src/__tests__/delivery-gating-paths.test.ts',
  '**/src/__tests__/settlement-cli-flags.test.ts',
  '**/src/__tests__/portal.test.ts',
  '**/src/__tests__/phase5-platform.test.ts',
  '**/src/__tests__/api-response-contract.test.ts',
  '**/src/__tests__/no-acting-tenant-audit.test.ts',
  '**/src/__tests__/platform-capability-closure.test.ts',
  '**/src/__tests__/publisher-portal-access.test.ts',
  '**/src/__tests__/audit-log.test.ts',
  '**/src/__tests__/db-push-constraints.test.ts',
  // Creates two tenants and their webhook keys, so another suite's
  // `TRUNCATE "tenants" CASCADE` would delete them mid-test.
  '**/src/__tests__/lead-inject-stream.test.ts',
  // Same: it seeds two agencies and truncates `roles`, and beside
  // settlement.test.ts on the default pool the two delete each other's
  // fixtures -- eleven failures whose text points at Prisma rather than at the
  // race that caused them.
  '**/src/__tests__/quota-summary.test.ts',
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
