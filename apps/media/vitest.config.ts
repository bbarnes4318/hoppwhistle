import { defineConfig } from 'vitest/config';

/**
 * Test only this package's own sources.
 *
 * `apps/media/transcriber` is its OWN workspace package — `pnpm-workspace.yaml`
 * lists both `apps/*` and `apps/media/*`, and `@callfabric/transcriber` has its
 * own `test` script. With no `include` here, vitest's default glob is rooted at
 * this package and walks into `transcriber/`, so every `pnpm -r test` ran that
 * suite TWICE: once as `@callfabric/transcriber`, once as part of
 * `@callfabric/media`, in two vitest processes running concurrently on the same
 * machine.
 *
 * That is how one CI job came to report the same file both passing and failing
 * (run 35642215163: `✓ (2 tests) 34ms` under transcriber, `1 failed` under
 * media) — and since `pnpm -r test` stops at the first failing package, the
 * duplicate could take the whole workspace gate down over a suite that had
 * already passed seconds earlier.
 *
 * `passWithNoTests` because this package has no tests of its own yet: `src/`
 * holds only `index.ts`, and an empty match otherwise exits 1.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    passWithNoTests: true,
  },
});
