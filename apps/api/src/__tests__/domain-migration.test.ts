import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The three ways the move to agents.netenroll.com silently reverts.
 *
 * 1. A user-facing string still names the old host. It renders fine, links
 *    somewhere real, and nothing errors -- it is just the wrong product name in
 *    front of a customer.
 *
 * 2. The SIP realm moves. Every registered agent extension authenticates
 *    against it. Changing it invalidates every SIP credential on the platform
 *    at once, and the failure surfaces as "no agent can take a call" rather
 *    than as anything resembling its cause.
 *
 * 3. A rebuild goes out with NEXT_PUBLIC_API_URL or NEXT_PUBLIC_WS_URL still
 *    pointing at the old host. Next.js inlines those at build time, so the app
 *    reverts wholesale with no runtime error and no environment variable to
 *    inspect. This is the one that has already happened once on this codebase,
 *    with NEXT_PUBLIC_GOOGLE_CLIENT_ID; the autopsy is at
 *    apps/web/src/app/login/page.tsx:23-37.
 *
 * The first two are asserted by reading the tree. The third is asserted by
 * running the build guard and requiring it to fail.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const RETIRED_HOST = 'hopwhistle.com';
const NEW_HOST = 'agents.netenroll.com';

/**
 * Trees whose strings a person can read: the web app's source and the API's,
 * which renders email bodies, TwiML spoken to callers, and the publisher
 * integration docs.
 */
const USER_FACING_TREES = [
  join(REPO_ROOT, 'apps', 'web', 'src'),
  join(REPO_ROOT, 'apps', 'api', 'src'),
  join(REPO_ROOT, 'apps', 'api', 'prisma'),
];

/**
 * Markdown is in scope because docs/legal/*.md is not documentation. Each of
 * these files is read at build time by a route under apps/web/src/app/legal and
 * rendered as a page customers read and the footer links to -- the terms they
 * agree to and the address they are told to email. They carried support@,
 * legal@, privacy@ and compliance@ on the retired domain, and a scan restricted
 * to .ts/.tsx did not see them.
 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const RENDERED_MARKDOWN = [
  'docs/legal/CALL_RECORDING_DISCLOSURE.md',
  'docs/legal/DATA_RETENTION_POLICY.md',
  'docs/legal/DPA_TEMPLATE.md',
  'docs/legal/PRIVACY_POLICY.md',
  'docs/legal/TERMS_OF_SERVICE.md',
];

/**
 * Files that name the retired host on purpose, each for a reason a rename would
 * break. This list is the point of the test: adding to it must be a deliberate
 * argument, not a way to make a failure go away.
 */
const DELIBERATE = new Map<string, string>([
  [
    'apps/api/src/routes/aivoice.ts',
    'AI Voice (Dograh) is deployed at aivoice.hopwhistle.com and its SSO cookie ' +
      'must be scoped to a parent of that host. Machine-to-machine; see the ' +
      'comment above AIVOICE_URL.',
  ],
  ['apps/api/src/lib/aivoice-jwt.ts', 'Comment describing the AI Voice deployment above.'],
  [
    'apps/web/src/app/(dashboard)/voice-agents/page.tsx',
    'Comment describing the AI Voice deployment above.',
  ],
]);

/**
 * This file, repo-relative. It names the retired host on nearly every line --
 * that is its job -- so it cannot be scanned by itself. Excluded by exact path
 * rather than by excluding `__tests__`, which would take real coverage with it.
 */
const SELF = relative(REPO_ROOT, __filename).split(sep).join('/');

/** Every file under `dir` with a source extension, repo-relative, posix-separated. */
function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (SOURCE_EXTENSIONS.some(ext => entry.endsWith(ext))) {
        found.push(relative(REPO_ROOT, path).split(sep).join('/'));
      }
    }
  };
  walk(dir);
  return found;
}

describe('no user-facing string contains the retired host', () => {
  it('finds no occurrence outside the deliberate list', () => {
    const offenders: string[] = [];
    const scanned = [...USER_FACING_TREES.flatMap(tree => sourceFiles(tree)), ...RENDERED_MARKDOWN];

    for (const file of scanned) {
      if (file === SELF) continue;
      if (DELIBERATE.has(file)) continue;

      const text = readFileSync(join(REPO_ROOT, file), 'utf8');
      text.split('\n').forEach((line, index) => {
        if (line.includes(RETIRED_HOST)) {
          offenders.push(`${file}:${index + 1}  ${line.trim()}`);
        }
      });
    }

    expect(offenders, `\n${offenders.join('\n')}\n`).toEqual([]);
  });

  it('every legal page rendered into the app is actually scanned', () => {
    // The list above is hand-maintained, and a legal page added later would
    // otherwise ship unscanned. Derive the truth from the routes instead: each
    // page under app/legal names the markdown file it renders.
    const legalRoutes = join(REPO_ROOT, 'apps', 'web', 'src', 'app', 'legal');
    const referenced = new Set<string>();

    for (const file of sourceFiles(legalRoutes)) {
      const text = readFileSync(join(REPO_ROOT, file), 'utf8');
      for (const match of text.matchAll(/docs\/legal\/[A-Z0-9_]+\.md/g)) {
        referenced.add(match[0]);
      }
    }

    expect(referenced.size).toBeGreaterThan(0);
    for (const path of referenced) {
      expect(RENDERED_MARKDOWN, `${path} is rendered as a page but not scanned`).toContain(path);
    }
  });

  it('keeps the deliberate list honest: every entry still names the host', () => {
    // An entry that no longer needs to be here is an entry that will be copied
    // by the next person as precedent. Fail when one goes stale.
    for (const [file, why] of DELIBERATE) {
      const path = join(REPO_ROOT, file);
      expect(existsSync(path), `${file} is on the deliberate list but does not exist`).toBe(true);
      expect(
        readFileSync(path, 'utf8').includes(RETIRED_HOST),
        `${file} no longer names ${RETIRED_HOST}; remove it from the list. Reason on record: ${why}`
      ).toBe(true);
    }
  });
});

describe('the FreeSWITCH SIP realm is unchanged', () => {
  /**
   * Asserted explicitly and by value, not by "does not contain netenroll".
   *
   * The realm is what every agent extension authenticates against. It is
   * `$${domain}` in the directory, substituted from SIP_DOMAIN by the FreeSWITCH
   * entrypoint, and the aliases below are the names that resolve to that same
   * domain. Repointing any of them invalidates every SIP credential at once.
   */
  const directory = join(REPO_ROOT, 'apps', 'freeswitch', 'conf', 'directory', 'default.xml');

  it('the directory domain is still the substituted SIP_DOMAIN', () => {
    const xml = readFileSync(directory, 'utf8');
    expect(xml).toContain('<domain name="$${domain}">');
  });

  it('the directory aliases still name hopwhistle.com', () => {
    const xml = readFileSync(directory, 'utf8');
    expect(xml).toContain('<alias name="hopwhistle.com"/>');
    expect(xml).toContain('<alias name="aivoice.hopwhistle.com"/>');
  });

  it('no alias has been repointed at the new browser host', () => {
    const xml = readFileSync(directory, 'utf8');
    expect(xml).not.toContain(NEW_HOST);
  });

  it('the example environment still ships the old SIP_DOMAIN', () => {
    const env = readFileSync(join(REPO_ROOT, 'infra', 'docker', 'env.example'), 'utf8');
    expect(env).toContain('SIP_DOMAIN=hopwhistle.com');
    expect(env).toContain('NEXT_PUBLIC_SIP_DOMAIN=hopwhistle.com');
  });
});

describe('a build pointing at the retired host fails', () => {
  const guard = join(REPO_ROOT, 'scripts', 'assert-public-host.mjs');

  /** Runs the guard with the given env and returns its exit status. */
  function runGuard(env: Record<string, string>): { status: number; output: string } {
    try {
      const output = execFileSync(process.execPath, [guard, '--env'], {
        env: { ...process.env, ...env },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, output };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return {
        status: failure.status ?? 1,
        output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
      };
    }
  }

  it('the guard exists and is wired into the web image build', () => {
    expect(existsSync(guard)).toBe(true);
    const dockerfile = readFileSync(join(REPO_ROOT, 'apps', 'web', 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('assert-public-host.mjs --env');
    expect(dockerfile).toContain('assert-public-host.mjs --built');
  });

  it('passes when both point at the new host', () => {
    const result = runGuard({
      NEXT_PUBLIC_API_URL: `https://${NEW_HOST}`,
      NEXT_PUBLIC_WS_URL: `wss://${NEW_HOST}`,
    });
    expect(result.output).toContain('ok');
    expect(result.status).toBe(0);
  });

  it('fails when NEXT_PUBLIC_API_URL points at the retired host', () => {
    const result = runGuard({
      NEXT_PUBLIC_API_URL: `https://${RETIRED_HOST}`,
      NEXT_PUBLIC_WS_URL: `wss://${NEW_HOST}`,
    });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('NEXT_PUBLIC_API_URL');
  });

  it('fails when NEXT_PUBLIC_WS_URL points at the retired host', () => {
    const result = runGuard({
      NEXT_PUBLIC_API_URL: `https://${NEW_HOST}`,
      NEXT_PUBLIC_WS_URL: `wss://${RETIRED_HOST}`,
    });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('NEXT_PUBLIC_WS_URL');
  });

  it('fails on a subdomain of the retired host', () => {
    // app.hopwhistle.com is not hopwhistle.com, and a host check written as an
    // equality test would wave it through.
    const result = runGuard({
      NEXT_PUBLIC_API_URL: `https://app.${RETIRED_HOST}`,
      NEXT_PUBLIC_WS_URL: `wss://${NEW_HOST}`,
    });
    expect(result.status).not.toBe(0);
  });

  it('fails when a value is missing entirely', () => {
    // An unset NEXT_PUBLIC_* is inlined as an empty string, which sends every
    // browser to localhost. Silent in exactly the same way.
    const result = runGuard({
      NEXT_PUBLIC_API_URL: `https://${NEW_HOST}`,
      NEXT_PUBLIC_WS_URL: '',
    });
    expect(result.status).not.toBe(0);
  });

  it('NEXT_PUBLIC_WS_URL still has no live consumer', () => {
    // The guard cannot require NEXT_PUBLIC_WS_URL to appear in the built bundle,
    // because Next.js only inlines a variable into code it bundles and the sole
    // reader of this one -- components/dashboard/live-stats.tsx -- is imported
    // nowhere. Requiring it would fail every correct build.
    //
    // That exemption is only sound while it stays true. Import live-stats into a
    // page and this test fails, which is the prompt to move NEXT_PUBLIC_WS_URL
    // into REQUIRE_PRESENT in scripts/assert-public-host.mjs.
    const webSrc = join(REPO_ROOT, 'apps', 'web', 'src');
    const readers = sourceFiles(webSrc).filter(file =>
      readFileSync(join(REPO_ROOT, file), 'utf8').includes('process.env.NEXT_PUBLIC_WS_URL')
    );

    expect(readers).toEqual(['apps/web/src/components/dashboard/live-stats.tsx']);

    const importers = sourceFiles(webSrc).filter(
      file =>
        file !== readers[0] &&
        /from\s+['"][^'"]*\/live-stats['"]/.test(readFileSync(join(REPO_ROOT, file), 'utf8'))
    );
    expect(
      importers,
      'live-stats.tsx is now imported, so NEXT_PUBLIC_WS_URL reaches the bundle: ' +
        'move it into REQUIRE_PRESENT in scripts/assert-public-host.mjs'
    ).toEqual([]);
  });

  it('the compose defaults it reads do not point at the retired host', () => {
    const compose = readFileSync(
      join(REPO_ROOT, 'infra', 'docker', 'docker-compose.dev.yml'),
      'utf8'
    );
    const defaults = compose.split('\n').filter(line => /NEXT_PUBLIC_(API|WS)_URL:/.test(line));

    expect(defaults.length).toBeGreaterThan(0);
    for (const line of defaults) {
      expect(line, line.trim()).toContain(NEW_HOST);
      expect(line, line.trim()).not.toContain(RETIRED_HOST);
    }
  });
});
