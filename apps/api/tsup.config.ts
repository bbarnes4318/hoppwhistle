import { defineConfig } from 'tsup';

export default defineConfig({
  /*
   * The server, and the CLIs that must be runnable in production. The
   * runner image copies only dist/ and has no tsx, so `tsx src/cli/...` cannot
   * run there; these build to dist/cli/*.js and run as `node dist/cli/<name>.js`
   * (the `*:prod` package scripts).
   */
  entry: {
    index: 'src/index.ts',
    'cli/number-charges-monthly': 'src/cli/number-charges-monthly.ts',
    'cli/statements-close-month': 'src/cli/statements-close-month.ts',
    'cli/link-application-customers': 'src/cli/link-application-customers.ts',
    'cli/vonage-diagnose': 'src/cli/vonage-diagnose.ts',
  },
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
  noExternal: [/@hopwhistle\/.*/],
  external: [
    /*
     * The Stripe SDK stays external, and it has to.
     *
     * `noExternal` above inlines every @hopwhistle/* package, and apps/api now
     * imports the platform's one Stripe integration from
     * @hopwhistle/worker/stripe-service. Inlining that dragged `stripe` in with
     * it -- and `stripe` depends on `qs`, which depends on `side-channel` and
     * `object-inspect`, which are CommonJS and call `require("util")` at import
     * time. esbuild's CJS-to-ESM shim answers that with
     *
     *     Error: Dynamic require of "util" is not supported
     *
     * thrown while the server is starting, after a perfectly green build. The
     * image build passes and the container exits; `.github/workflows/
     * api-image.yml` exists because that exact shape of failure has happened
     * here before.
     *
     * Left external it is a plain `import Stripe from "stripe"` in dist, and
     * `stripe` is a direct dependency of apps/api so Node resolves it from
     * node_modules at runtime rather than from a bundled copy that cannot run.
     */
    'stripe',
    '@opentelemetry/api',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-node',
    '@opentelemetry/sdk-trace-node',
    '@opentelemetry/exporter-jaeger',
    '@opentelemetry/exporter-prometheus',
    'bcryptjs',
  ],
});
