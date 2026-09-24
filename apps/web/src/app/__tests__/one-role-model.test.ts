import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getRedirectPath, homePathForRoles } from '@/lib/roles';

/**
 * There is one role model in this app, and it is the server's.
 *
 * ── The three that were here ─────────────────────────────────────────────────
 *
 *   hooks/useUserRoles.ts   its own fetch, its own state, and a `RoleName`
 *                           union with no AGENT in it -- the one role the call
 *                           centre exists for.
 *   hooks/use-auth.tsx      a second fetch's worth of state and a hand-copied
 *                           permission table that gave AGENT one capability
 *                           where the server gives nine. `/reports` is guarded
 *                           on `reports:read`, which the server grants an agent
 *                           and this copy did not, so the page turned agents
 *                           away from something the API would have served.
 *   lib/roles.ts            a third opinion about where an agent belongs:
 *                           /dashboard here, /call-center in use-auth.tsx. The
 *                           login page used the first and the dashboard page
 *                           the second, so every agent login was a redirect
 *                           followed immediately by another one.
 *
 * ── What this test holds ─────────────────────────────────────────────────────
 *
 * That the home path has one definition, that AGENT exists in the type, and
 * that no permission table comes back into the browser. The last one is a
 * source check rather than a behaviour check on purpose: the failure mode is
 * somebody adding a plausible-looking list of permission strings next to the
 * code that renders from them, and no rendered output distinguishes that from
 * reading the server's.
 */

const SRC = join(__dirname, '..', '..');
const read = (relative: string) => readFileSync(join(SRC, relative), 'utf8');

/**
 * Source with comments removed.
 *
 * These files explain at length what they used to do, and naming the old
 * behaviour in a comment must not read as still doing it -- the first version
 * of this test failed because `useUserRoles.ts` says the words
 * "ran its own GET /api/auth/me" while no longer running one.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the home path has one definition', () => {
  it.each([
    [['OWNER'], '/dashboard'],
    [['ADMIN'], '/dashboard'],
    [['PUBLISHER'], '/publisher/dashboard'],
    [['BUYER'], '/buyer/dashboard'],
    [['AGENT'], '/calls'],
    [['ANALYST'], '/dashboard'],
    [['READONLY'], '/dashboard'],
    [[], '/dashboard'],
  ])('sends %s to %s', (roles, expected) => {
    expect(homePathForRoles(roles)).toBe(expected);
  });

  it('is the same function the login page imports', () => {
    // Both names survive because both had call sites. They must not be two
    // implementations again.
    expect(getRedirectPath).toBe(homePathForRoles);
  });

  it('keeps an administrator out of a section portal', () => {
    // An admin who also carries BUYER for testing should not be trapped there.
    expect(homePathForRoles(['ADMIN', 'BUYER', 'PUBLISHER'])).toBe('/dashboard');
  });

  it('is case-insensitive about what the API sent', () => {
    expect(homePathForRoles(['agent'])).toBe('/calls');
  });

  it('agrees with what use-auth exposes as defaultDashboardPath', () => {
    // The drift was between these two. use-auth now calls this function rather
    // than carrying its own ladder, so the source must show that.
    const useAuth = read('hooks/use-auth.tsx');
    expect(useAuth).toContain('homePathForRoles(userRoles)');
    expect(useAuth).not.toMatch(/defaultDashboardPath = '\/call-center'/);
  });
});

describe('AGENT exists in the frontend role model', () => {
  it('is in the RoleName union', () => {
    const source = read('hooks/useUserRoles.ts');
    const union = source.slice(source.indexOf('export type RoleName'));
    for (const role of ['OWNER', 'ADMIN', 'AGENT', 'ANALYST', 'PUBLISHER', 'BUYER', 'READONLY']) {
      expect(union, `${role} missing from RoleName`).toContain(`'${role}'`);
    }
  });

  it('is ranked in the home-path precedence', () => {
    const source = read('lib/roles.ts');
    expect(source).toContain("'AGENT'");
  });
});

describe('the browser does not carry a permission table', () => {
  it('reads permissions off the session rather than deriving them', () => {
    const source = read('hooks/use-auth.tsx');
    expect(source).toContain('user?.permissions');
    // The name of the function that used to rebuild the table here.
    expect(source).not.toContain('getPermissions');
  });

  it('has no hand-copied capability list anywhere under src', () => {
    /*
     * The shape being looked for is a LIST of permission strings -- an array or
     * a run of `push(...)` arguments, which is what a copy of the server's
     * table looks like. Individual checks (`can('billing:read')`) are not that,
     * and this file's own subject files legitimately make several: the fix was
     * to stop maintaining the table, not to stop naming capabilities.
     *
     * Counting literals would forbid the checks too, which is why the first
     * version of this test failed on the very code it was written to bless.
     */
    const files = [
      'hooks/use-auth.tsx',
      'hooks/useUserRoles.ts',
      'lib/roles.ts',
      'components/auth/role-guard.tsx',
      'components/layout/sidebar.tsx',
    ];

    const PERMISSION = String.raw`'[a-z_]+:(?:read|write|delete|publish|admin|\*)'`;
    // Two permission literals separated only by a comma and whitespace: the
    // start of a list, wherever it appears.
    const LIST = new RegExp(`${PERMISSION}\\s*,\\s*${PERMISSION}`);

    for (const file of files) {
      const executable = stripComments(read(file));
      expect(LIST.test(executable), `${file} carries a list of permission strings`).toBe(false);
    }
  });

  it('only one hook fetches the session', () => {
    // useUserRoles used to run its own GET /api/auth/me. One dashboard load
    // fired ten identical auth requests and exhausted the API's pool. Comments
    // are stripped first: this file explains what it used to do, and saying so
    // must not read as doing it.
    const source = stripComments(read('hooks/useUserRoles.ts'));
    expect(source).not.toContain('/api/auth/me');
    expect(source).toContain("from './use-auth'");
  });
});
