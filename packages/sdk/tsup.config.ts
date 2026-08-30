import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // `types` points into dist, and with dts off that file was never emitted,
  // so every TypeScript consumer of the SDK silently got no types at all.
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'es2022',
  outDir: 'dist',
});
