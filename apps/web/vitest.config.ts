import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Scoped deliberately: apps/web has 141 pre-existing type errors across
    // unrelated components, so a whole-app suite would be red for reasons this
    // work did not cause. This covers the Dialer V2 supervisor page only.
    include: [
      'src/app/**/dialer-v2-shadow/**/*.test.ts',
      // Guards the CSV template's columns against the buyer's spec files.
      'src/components/leads/__tests__/**/*.test.ts',
    ],
  },
});
