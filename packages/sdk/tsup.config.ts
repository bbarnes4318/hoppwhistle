import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: {
    compilerOptions: {
      composite: false,
      incremental: false,
    },
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'es2022',
  outDir: 'dist',
});

