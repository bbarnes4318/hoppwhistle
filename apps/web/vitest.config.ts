import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  /*
   * The `@/` alias, as `tsconfig.json` and Next both resolve it.
   *
   * The pure-logic tests import by relative path and never needed this. A test
   * that renders a page does: the page and everything under it import through
   * `@/`, and without this vitest cannot resolve the first one it meets.
   */
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  // The automatic JSX runtime, so a rendering test does not have to import
  // React to write JSX -- the same transform Next applies to the app itself.
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'node',
    /*
     * A DOM for the files that render.
     *
     * Everything else stays on `node` -- most of this suite is pure logic and
     * does not need one. `environmentMatchGlobs` gives jsdom only to the
     * rendering tests, which is what lets the platform-landing test mount the
     * real layout and the real pages.
     *
     * ── jsdom is PINNED to 26.x, and the reason is CI's Node ─────────────────
     *
     * jsdom 27 and later require Node 22.22 or newer, through an undici that
     * calls `markAsUncloneable` from `node:worker_threads`. `.github/workflows`
     * runs Node 20, where that does not exist, so importing jsdom throws before
     * a single test in this file runs.
     *
     * That failure is worse than it looks. Vitest reports it as an unhandled
     * error rather than as a failed file: the run said "14 passed" with the
     * rendering file simply absent, and only the error count made it red. A
     * dependency bump here can therefore delete this coverage while the summary
     * still reads green. Bump jsdom only together with NODE_VERSION in the
     * workflows, and check the file count afterwards.
     */
    environmentMatchGlobs: [['src/app/__tests__/*.render.test.tsx', 'jsdom']],
    // Scoped deliberately: apps/web has 141 pre-existing type errors across
    // unrelated components, so a whole-app suite would be red for reasons this
    // work did not cause.
    //
    // Every test file in apps/web must appear here. A file that exists and is
    // not listed does not run, and nothing says so -- which is what happened to
    // the industry-research pair below for as long as this list has existed.
    // They pass, and the type-error rationale never applied to them: vitest
    // does not typecheck.
    include: [
      'src/app/**/dialer-v2-shadow/**/*.test.ts',
      // Guards the CSV template's columns against the buyer's spec files.
      'src/components/leads/__tests__/**/*.test.ts',
      // The buyer pages' pure logic: dispute evidence, bar scale, date range.
      'src/app/**/buyer/_lib/*.test.ts',
      // Report helpers and story assembly for the industry-research feature.
      'src/features/industry-research/ui/__tests__/**/*.test.ts',
      // Keeps the login page's Google client id equal to the API's. A mismatch
      // removes the sign-in buttons with no error anywhere.
      'src/app/login/__tests__/**/*.test.ts',
      // The login loop: a platform admin with no acting tenant must not be
      // treated as signed out. This one cost production access.
      'src/lib/__tests__/**/*.test.ts',
      // The delivery portal's polling: a floor of 45 agents leaves this open
      // all day, and a hidden tab must cost nothing.
      'src/hooks/__tests__/**/*.test.ts',
      // The error boundary that keeps one broken component from unmounting the
      // whole application, as the agency switcher did.
      'src/components/__tests__/**/*.test.tsx',
      // The strip above every page: which figures each reading gets, that an
      // agency not enrolled in billing is shown no money at all, and that the
      // rate in force and the rate tomorrow is tracking toward stay apart.
      'src/components/layout/__tests__/**/*.test.ts',
      // Every page under the dashboard offers the cross-agency prompt rather
      // than rendering broken for an operator with no agency selected.
      'src/app/__tests__/**/*.test.ts',
      // The platform-wide screens, RENDERED as a platform admin with no acting
      // tenant: no "Choose an agency" prompt, and no agency-scoped request.
      // Three phases running, a defect reached production that one load of
      // these pages would have caught and this suite could not.
      'src/app/__tests__/**/*.render.test.tsx',
      // The colour contract: light by default, the brand green at 4.5:1 as
      // text, and the call-state signals untouched and distinct from it.
      'src/app/__tests__/theme-tokens.test.ts',
    ],
  },
});
