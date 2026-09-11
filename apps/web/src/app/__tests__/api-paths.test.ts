import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every `apiClient` call asks for a path the server actually serves.
 *
 * ── The bug this exists to stop ──────────────────────────────────────────────
 *
 * `/voice-agents` asked for `/v1/aivoice/session`. The route is registered at
 * `/api/v1/aivoice/session`. One missing prefix, and the AI Voice page was
 * dead — the portal's only window onto 110,723 AI voice calls.
 *
 * It was invisible for three reasons at once, which is why it deserves a test
 * rather than care:
 *
 * 1. **Nothing type-checks a path.** `apiClient.get<{ url: string }>(...)`
 *    takes any string. The wrong path compiles, lints and passes review.
 * 2. **The client prepends `window.location.origin`.** So the request was not
 *    a 404 from the API — it never reached the API. It went to the Next.js
 *    server, which has no such route and answers 404 itself. Nothing appears
 *    in the API log, so looking there shows a healthy API.
 * 3. **`apiClient.get()` never throws.** The page's `catch` could not fire; the
 *    404 landed in `res.error`, was never read, and the page rendered a
 *    generic "not available right now". Exactly the failure the call ledger
 *    had (`calls-ledger.render.test.tsx`).
 *
 * ── Why a source scan ───────────────────────────────────────────────────────
 *
 * A render test only covers pages somebody thought to render, and this is a
 * property of every call site in the app — around 300 of them. So this reads
 * the source and asserts the property directly. It is the same shape as
 * `cross-agency-landing.test.ts`: assert the property of the files, not of one
 * rendered path.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * A path handed to `apiClient` must begin with a prefix the server serves:
 *
 *   /api/v1/…       the agency-scoped API              (routes/index.ts)
 *   /api/auth/…     sign-in and the current user
 *   /admin/api/v1/… NetEnroll's own console, deliberately a separate surface
 *
 * A path built from a variable (`${BASE}/runs`, `${endpoint}?…`) is resolved
 * against that identifier's string assignments in the same file, so those are
 * checked too rather than waved through. If an identifier cannot be resolved
 * the call site is reported — an unresolvable path is the case this test cannot
 * vouch for, and silence about it is how the next one slips in.
 */

const WEB_SRC = join(__dirname, '..', '..');

/** Prefixes the server actually answers on. Adding one is a deliberate act. */
const SERVED_PREFIXES = ['/api/v1/', '/api/auth/', '/admin/api/v1/'];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/** `apiClient.get<T>(\`path\`, …)` — the path literal, however it is quoted. */
const CALL_SITE =
  /apiClient\.(?:get|post|put|patch|delete)\s*(?:<[^(]*?>)?\s*\(\s*(['"`])([^'"`]*)\1/g;

/**
 * What a leading `${identifier}` can be, read from the same file.
 *
 * Three forms cover every base in the app: `const BASE = '/api/v1/…'`, a plain
 * reassignment, and an object property — `${target.endpoint}` resolves through
 * the `endpoint: '/api/v1/reports/…'` entries of the table it indexes. For a
 * dotted name only the last segment is resolved, so this can over-collect
 * across two same-named properties; every candidate must pass, so
 * over-collecting is the safe direction.
 */
function resolveIdentifier(source: string, name: string): string[] {
  const leaf = name.split('.').pop() as string;
  const q = `(['"\`])`;
  const str = `([^'"\`]*)`;

  const assignment = new RegExp(
    `(?:const|let|var)\\s+${leaf}\\s*(?::[^=]+)?=\\s*${q}${str}\\1|` +
      `(?<![.\\w])${leaf}\\s*=\\s*${q}${str}\\3|` +
      `(?:^|[{,\\s])['"]?${leaf}['"]?\\s*:\\s*${q}${str}\\5`,
    'gm'
  );

  const values: string[] = [];
  for (const m of source.matchAll(assignment)) {
    const value = m[2] ?? m[4] ?? m[6];
    if (value !== undefined) values.push(value);
  }
  return values;
}

/**
 * Every concrete path a call site can request. One entry normally; several when
 * the path starts with an identifier that is assigned more than once.
 */
function concretePaths(source: string, raw: string): string[] | null {
  const leading = raw.match(/^\$\{([\w.]+)\}/);
  if (!leading) return [raw];

  const values = resolveIdentifier(source, leading[1]);
  if (values.length === 0) return null;
  return values.map(value => value + raw.slice(leading[0].length));
}

describe('apiClient paths', () => {
  const files = sourceFiles(WEB_SRC);

  it('finds the call sites at all (so a silent pass is impossible)', () => {
    const total = files.reduce(
      (n, file) => n + [...readFileSync(file, 'utf8').matchAll(CALL_SITE)].length,
      0
    );
    // The app had ~300 when this was written. A regex that quietly stops
    // matching would otherwise turn this whole file into a no-op.
    expect(total).toBeGreaterThan(100);
  });

  it('every path begins with a prefix the server serves', () => {
    const wrong: string[] = [];
    const unresolvable: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const where = file.slice(WEB_SRC.length + 1);

      for (const match of source.matchAll(CALL_SITE)) {
        const raw = match[2];
        const paths = concretePaths(source, raw);

        if (paths === null) {
          unresolvable.push(`${where}: ${raw}`);
          continue;
        }

        for (const path of paths) {
          if (!SERVED_PREFIXES.some(prefix => path.startsWith(prefix))) {
            wrong.push(`${where}: ${path}`);
          }
        }
      }
    }

    expect(
      unresolvable,
      'These paths are built from something this test cannot read, so it ' +
        'cannot vouch for them. Check each one reaches a served prefix, then ' +
        'make it resolvable (assign the base to a const in the same file).'
    ).toEqual([]);

    expect(
      wrong,
      'These ask for a path the server does not serve. The client prepends ' +
        `window.location.origin, so the request never reaches the API — the ` +
        'Next.js server 404s it and the API log stays clean. Served prefixes: ' +
        SERVED_PREFIXES.join(', '),
    ).toEqual([]);
  });

  it('the AI Voice SSO call keeps its prefix', () => {
    // The specific regression. The page is the portal's only window onto the
    // AI voice calls, and it failed with no error anywhere when this broke.
    const page = readFileSync(
      join(WEB_SRC, 'app', '(dashboard)', 'voice-agents', 'page.tsx'),
      'utf8'
    );

    expect(page).toContain("apiClient.get<{ url: string }>('/api/v1/aivoice/session')");
    expect(page).not.toContain("'/v1/aivoice/session'");
  });

  it('the AI Voice page reads res.error, because the client never throws', () => {
    // Without this the 404 above was silent: `catch` cannot fire on a client
    // that resolves with `{ error }`, so the page showed a generic message and
    // the real status code appeared only in the browser's network tab.
    const page = readFileSync(
      join(WEB_SRC, 'app', '(dashboard)', 'voice-agents', 'page.tsx'),
      'utf8'
    );

    expect(page).toMatch(/res\.error/);
  });
});
