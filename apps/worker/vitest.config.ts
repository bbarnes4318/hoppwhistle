import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The live suites need a real PostgreSQL and are routed to their own config
    // and their own CI job. Excluding them here is a routing decision, not a way
    // to hide failures — `vitest.live.config.ts` includes exactly this pattern,
    // and the dialer-v2 workflow asserts both configs still reference it.
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.live.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
