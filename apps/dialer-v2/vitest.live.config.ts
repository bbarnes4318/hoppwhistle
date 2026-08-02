import { defineConfig } from 'vitest/config';

/**
 * Live suite: real Redis, real PostgreSQL.
 *
 * Run by the `dialer-v2-live` CI job, which provides both as service containers
 * and sets DIALER_V2_REQUIRE_LIVE_SERVICES=true so an unreachable service fails
 * the job instead of skipping quietly.
 *
 * Single-threaded: these tests share one keyspace and one database, and real
 * TTL expiry cannot be faked apart.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.live.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
