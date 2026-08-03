import { defineConfig } from 'tsup';

/**
 * Dialer V2 bundling.
 *
 * ── Why `@prisma/client` is external and `@hopwhistle/*` is not ──────────────
 *
 * tsup externalizes whatever the package declares in `dependencies` and bundles
 * everything else. `@prisma/client` was not declared here — it was only reachable
 * because pnpm hoisted another workspace's copy into the root `node_modules` — so
 * tsup classified it as bundleable and esbuild followed it inward:
 *
 *     node_modules/@prisma/client/default.js:2
 *       module.exports = { ...require('.prisma/client/default') }
 *
 * `.prisma/client` is not a package. It is the output directory `prisma generate`
 * writes into, so it does not exist in a clean checkout, and the build failed
 * with `Could not resolve ".prisma/client/default"`. It passed on a developer
 * machine only because an earlier `prisma generate` had left that directory on
 * disk — a build whose success depended on a file no clean environment has.
 *
 * Externalizing is the correct answer here rather than a way around the error:
 * the generated client is determined by the deployment's schema and engine
 * binaries, not by this bundle. Inlining a snapshot would freeze a copy that
 * drifts from the schema at the next migration, and would bake engine paths
 * resolved on a build machine into an image with a different libc.
 *
 * The obligations that come with externalizing are met explicitly:
 *   - `@prisma/client` is a production dependency of this package (package.json),
 *     so it is installed beside the artifact rather than hoisted by luck.
 *   - `prisma generate` runs during image and CI artifact construction, before
 *     this build (Dockerfile, .github/workflows/dialer-v2.yml).
 *   - A missing generated client fails startup and readiness with a named,
 *     credential-free error rather than presenting as "database unreachable"
 *     (src/runtime/postgres.ts).
 *
 * `@hopwhistle/shared` is the opposite case: a workspace package with no
 * published build, so it must be inlined or the artifact cannot resolve it.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'es2022',
  outDir: 'dist',
  noExternal: [/@hopwhistle\/.*/],
  external: [
    '@prisma/client',
    // The generated client, named directly. `@prisma/client` being external
    // already stops esbuild reaching this, but some transitive path into it
    // would otherwise reintroduce the identical clean-checkout failure.
    '.prisma/client',
    /^\.prisma\/client\/.*/,
  ],
});
