import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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
    ],
  },
});
