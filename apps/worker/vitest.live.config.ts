import { defineConfig } from 'vitest/config';

/**
 * Worker live suite: real PostgreSQL.
 *
 * Run by the `dialer-v2 against real Redis and PostgreSQL` job, which provides
 * the container and applies the schema to it.
 *
 * Single-threaded on purpose. These tests assert things about concurrency —
 * that a partial unique index settles a race, that several reapers divide work
 * rather than duplicating it — by running their OWN concurrent operations
 * inside a test. Letting Vitest also run the FILES concurrently would let two
 * unrelated tests contend for the same rows and produce failures that say
 * nothing about the code.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.live.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
