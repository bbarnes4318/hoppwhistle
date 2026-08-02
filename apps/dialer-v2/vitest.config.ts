import { defineConfig } from 'vitest/config';

/**
 * Default suite: pure components and in-process integration.
 *
 * Live suites (`*.live.test.ts`) are excluded deliberately. They require a real
 * Redis and a real PostgreSQL, and mixing them in here would mean a developer
 * with no services running sees a green run that skipped the tests which
 * actually exercise the production data path. They run under
 * `vitest.live.config.ts` in their own CI job with service containers.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.live.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
