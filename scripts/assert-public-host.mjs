#!/usr/bin/env node
/**
 * Fails the web build when NEXT_PUBLIC_API_URL or NEXT_PUBLIC_WS_URL still
 * points at a retired host.
 *
 * Next.js inlines NEXT_PUBLIC_* at BUILD time. A value that is not passed
 * through the Docker build arg never reaches the app, however it is set at
 * runtime -- and a value that IS passed is welded into the bundle until the
 * next rebuild. That makes the failure mode silent in both directions: a
 * rebuild that forgets the new host reverts the whole app to the old one with
 * no error anywhere, and no amount of `docker exec printenv` will show it,
 * because the running container's environment is not what the browser got.
 *
 * This has already happened once on this codebase, with
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID: nothing set it, the login page read an empty
 * client id, and the Google buttons vanished on the next rebuild. The autopsy
 * is at apps/web/src/app/login/page.tsx:15-30.
 *
 * Two modes, both run from apps/web/Dockerfile:
 *
 *   node scripts/assert-public-host.mjs --env
 *       Before `next build`. Checks the values that are about to be inlined.
 *
 *   node scripts/assert-public-host.mjs --built apps/web/.next
 *       After `next build`. Checks the bundle Next actually emitted, which is
 *       the only thing that proves the values landed. The variables having been
 *       set is not evidence; the bytes in the bundle are.
 *
 * To move to a new host, change the compose defaults in
 * infra/docker/docker-compose.dev.yml and add the old one to RETIRED_HOSTS.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Hosts the app must no longer be built against. A retired host may still
 * resolve, still hold a valid certificate and still serve the old bundle --
 * which is exactly why a build pointed at one cannot be caught by hand.
 */
const RETIRED_HOSTS = ['hopwhistle.com'];

/** The build-time variables Next.js inlines and this script therefore guards. */
const GUARDED = ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_WS_URL'];

/**
 * Variables whose value must actually appear in the built bundle.
 *
 * Not the same set as GUARDED, and the difference is not laziness. Next.js only
 * inlines a variable into code it bundles, so a value can only be *required* to
 * be present when something the app actually renders reads it.
 *
 * NEXT_PUBLIC_API_URL qualifies: apps/web/src/lib/get-api-url.ts, lib/api.ts,
 * the login page and a dozen others read it, and it lands in 39 build outputs.
 *
 * NEXT_PUBLIC_WS_URL does not. Its only reader in apps/web/src is
 * components/dashboard/live-stats.tsx, and nothing imports that file -- so the
 * value reaches zero build outputs and requiring it would fail every correct
 * build. Measured, not assumed. The softphone builds its own signalling URL
 * from window.location.hostname (phone-provider.tsx), which is why nothing
 * missed it.
 *
 * This costs nothing against the failure that matters. A bundle pointed at the
 * retired host can only say so as `wss://hopwhistle.com`, and the absence scan
 * below catches that wherever it appears. Presence is the weaker, secondary
 * signal; absence is the guard.
 *
 * domain-migration.test.ts asserts that NEXT_PUBLIC_WS_URL still has no live
 * consumer. Wire live-stats.tsx into a page and that test fails, telling you to
 * move NEXT_PUBLIC_WS_URL into this set rather than leaving the exemption to rot.
 */
const REQUIRE_PRESENT = new Set(['NEXT_PUBLIC_API_URL']);

function die(lines) {
  console.error('');
  console.error('  BUILD REFUSED');
  console.error('');
  for (const line of lines) console.error(`  ${line}`);
  console.error('');
  process.exit(1);
}

/** True when `url`'s host is a retired host, or a subdomain of one. */
function isRetired(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // Not a parseable URL. Fall back to a substring match so a malformed value
    // carrying the old host is still caught rather than waved through.
    const lowered = String(url).toLowerCase();
    return RETIRED_HOSTS.some(retired => lowered.includes(retired));
  }
  return RETIRED_HOSTS.some(retired => host === retired || host.endsWith(`.${retired}`));
}

function checkEnv() {
  const problems = [];

  for (const name of GUARDED) {
    const value = process.env[name];

    if (!value || value.trim() === '') {
      problems.push(
        `${name} is empty. Next.js would inline an empty string and the app`,
        `  would fall back to localhost in every browser that loads it.`
      );
      continue;
    }

    if (isRetired(value)) {
      problems.push(
        `${name}=${value}`,
        `  points at a retired host. Nothing about this build would fail at`,
        `  runtime -- the app would just quietly serve the old host again.`
      );
    }
  }

  if (problems.length > 0) {
    die([
      ...problems,
      '',
      'Pass the current values as build args:',
      '',
      '  NEXT_PUBLIC_API_URL=https://agents.netenroll.com \\',
      '  NEXT_PUBLIC_WS_URL=wss://agents.netenroll.com \\',
      '    scripts/deploy.sh --build api web',
      '',
      'The defaults live in infra/docker/docker-compose.dev.yml.',
    ]);
  }

  for (const name of GUARDED) {
    console.log(`assert-public-host: ${name}=${process.env[name]} ok`);
  }
}

/**
 * Directories under .next that are not build output.
 *
 * `cache` is webpack's incremental build cache. It carries strings from
 * PREVIOUS builds -- on a warm cache it still held the retired host long after
 * the source stopped mentioning it -- and none of it is copied into the runtime
 * image, which takes only .next/standalone and .next/static. Scanning it would
 * fail builds over bytes no browser can ever receive.
 */
const NOT_OUTPUT = new Set(['cache']);

/** Every file under `dir`, recursively, skipping what is not build output. */
function* walk(dir, depth = 0) {
  for (const entry of readdirSync(dir)) {
    // Only at the top level: a `cache` directory nested inside real output
    // would be output.
    if (depth === 0 && NOT_OUTPUT.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path, depth + 1);
    } else {
      yield path;
    }
  }
}

/**
 * Text-bearing build output. Next writes the inlined values into JS chunks and
 * into the prerendered HTML; the rest (source maps, fonts, images, the trace)
 * is noise that only slows the scan and, in the case of source maps, carries
 * the original `process.env.X` expression rather than its replacement.
 */
const SCANNED_EXTENSIONS = ['.js', '.mjs', '.cjs', '.html', '.json'];

function checkBuilt(buildDir) {
  const wanted = GUARDED.map(name => ({ name, value: process.env[name] }));
  const seen = new Set();
  const offenders = new Map();

  let scanned = 0;
  for (const path of walk(buildDir)) {
    if (path.endsWith('.map')) continue;
    if (!SCANNED_EXTENSIONS.some(ext => path.endsWith(ext))) continue;

    const text = readFileSync(path, 'utf8');
    scanned += 1;

    for (const { name, value } of wanted) {
      if (value && text.includes(value)) seen.add(name);
    }

    for (const retired of RETIRED_HOSTS) {
      // Qualified by a scheme or by `@`, never bare. A bare hostname would fail
      // a build over a comment or an unrelated identifier; these two prefixes
      // are the forms a customer can actually act on -- an endpoint the app
      // calls, and an address someone emails.
      //
      // `@` is here because the first real occurrence this caught was neither
      // an endpoint nor in a component: the legal pages render
      // docs/legal/*.md at build time, and those carry support@, legal@,
      // privacy@ and compliance@ on the retired domain. A scheme-only scan
      // walked straight past them.
      for (const prefix of ['https://', 'http://', 'wss://', 'ws://', '@']) {
        if (text.includes(`${prefix}${retired}`)) {
          const key = `${prefix}${retired}`;
          if (!offenders.has(key)) offenders.set(key, []);
          if (offenders.get(key).length < 5) offenders.get(key).push(path);
        }
      }
    }
  }

  if (offenders.size > 0) {
    die([
      'The built bundle contains a retired host:',
      '',
      ...[...offenders.entries()].flatMap(([key, paths]) => [
        `  ${key}`,
        ...paths.map(p => `      ${p}`),
      ]),
      '',
      'Something still hardcodes it. Find it with:',
      '',
      `  grep -rn '${RETIRED_HOSTS[0]}' apps/web/src apps/api/src`,
    ]);
  }

  const missing = wanted.filter(({ name }) => REQUIRE_PRESENT.has(name) && !seen.has(name));
  if (missing.length > 0) {
    die([
      'The built bundle does not contain the values that were set:',
      '',
      ...missing.map(({ name, value }) => `  ${name}=${value} is nowhere in ${buildDir}`),
      '',
      'The variable was set for the build and did not reach the bundle, which',
      'is the whole failure this check exists to catch. Confirm apps/web/Dockerfile',
      'still declares the matching ARG and ENV lines before the build step.',
    ]);
  }

  const present = GUARDED.filter(name => seen.has(name));
  const absent = GUARDED.filter(name => !seen.has(name));

  console.log(
    `assert-public-host: ${scanned} built ${scanned === 1 ? 'file' : 'files'} scanned, ` +
      `no retired host`
  );
  if (present.length > 0) console.log(`assert-public-host: in the bundle: ${present.join(', ')}`);
  // Named rather than passed over in silence: an absence that is expected today
  // becomes a regression the day something starts reading the variable, and the
  // build log is where anyone debugging this will look first.
  for (const name of absent) {
    console.log(
      `assert-public-host: ${name} is not in the bundle -- expected, ` +
        `nothing the app renders reads it (see REQUIRE_PRESENT)`
    );
  }
}

const [mode, arg] = process.argv.slice(2);

if (mode === '--env' || mode === undefined) {
  checkEnv();
} else if (mode === '--built') {
  if (!arg) die(['--built needs a directory, e.g. --built apps/web/.next']);
  checkEnv();
  checkBuilt(arg);
} else {
  die([`Unknown mode "${mode}". Use --env or --built <dir>.`]);
}
