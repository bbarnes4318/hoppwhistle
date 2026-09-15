import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The login sequence the brief calls unacceptable, and why it happened.
 *
 * ── The sequence ─────────────────────────────────────────────────────────────
 *
 *   sign in -> briefly see an administrator's application -> later be reduced
 *   to a single Dashboard entry
 *
 * ── The mechanism ────────────────────────────────────────────────────────────
 *
 * `user === null` meant three different things: still asking, nobody is signed
 * in, and the request failed. Everything downstream dispatched on flags derived
 * from `user`, so all three rendered the same thing -- the sidebar's catch-all,
 * one Dashboard link, which is exactly what an account with no roles renders.
 *
 * A 429 was enough. The rate limiter keys on `request.ip`, which is nginx for
 * every request because Fastify runs without `trustProxy`, so the platform
 * shares one 100-per-minute bucket. When it trips, `/api/auth/me` answers 429,
 * and somebody who was working a second ago is looking at a one-item nav that
 * is indistinguishable from having had their access revoked.
 *
 * ── Why this reads source ────────────────────────────────────────────────────
 *
 * The property is about which states exist and what each renders. A rendered
 * snapshot of one state cannot show that a second state is no longer collapsed
 * into it -- that is precisely the bug: two states that looked identical. So
 * these assert the distinctions exist in the code that makes them.
 */

const SRC = join(__dirname, '..', '..');
const read = (relative: string) => readFileSync(join(SRC, relative), 'utf8');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the session has named states, not a nullable user', () => {
  const useAuth = read('hooks/use-auth.tsx');

  it.each(['resolving', 'authenticated', 'anonymous', 'failed'])('declares the %s state', state => {
    expect(useAuth).toContain(`'${state}'`);
  });

  it('separates "the server answered with no roles" from "no answer yet"', () => {
    expect(useAuth).toContain('hasResolvedNoRole');
    expect(stripComments(useAuth)).toContain(
      "status === 'authenticated' && userRoles.length === 0"
    );
  });

  it('does not treat a 5xx or a 429 as being signed out', () => {
    const body = stripComments(useAuth);
    // The only place the token is cleared is a 401 -- a credential the server
    // actually rejected.
    const clearSites = body.split('clearSessionToken()').length - 1;
    expect(clearSites).toBe(1);
    expect(body).toMatch(/res\.status === 401[\s\S]{0,400}clearSessionToken\(\)/);
  });
});

describe('nothing renders a navigation before the session resolves', () => {
  const sidebar = stripComments(read('components/layout/sidebar.tsx'));

  it('renders no nav groups for an unresolved or role-less session', () => {
    /*
     * The catch-all used to be `[{ items: [PLATFORM_NAV[0].items[0]] }]` -- one
     * Dashboard link, returned for all three of the collapsed states.
     *
     * Only the CATCH-ALL is checked, not the whole file: the READONLY branch
     * legitimately builds a nav starting from that same Dashboard entry, and
     * forbidding the expression outright would have failed on code that is
     * correct. The catch-all is what follows the last role branch.
     */
    const dispatch = sidebar.slice(sidebar.indexOf('const groups'), sidebar.indexOf('}, ['));
    const catchAll = dispatch.slice(dispatch.lastIndexOf('}'));
    expect(catchAll).not.toContain('PLATFORM_NAV');
    expect(catchAll).toContain('return [];');
  });

  it('has a distinct treatment for each of the three states', () => {
    expect(sidebar).toContain('ResolvingNotice');
    expect(sidebar).toContain('UnreachableNotice');
    expect(sidebar).toContain('NoRoleNotice');
  });

  it('checks the platform nav first, so staff never get an agency nav', () => {
    // `hasFullAccess` is ADMIN-or-OWNER and staff inside an agency carry both.
    const dispatch = sidebar.slice(sidebar.indexOf('const groups'));
    expect(dispatch.indexOf('isPlatformAdmin')).toBeLessThan(dispatch.indexOf('hasFullAccess'));
  });
});

describe('a failed request does not send anyone to the login page', () => {
  it.each([
    ['app/(dashboard)/layout.tsx', 'replace'],
    ['components/auth/role-guard.tsx', 'push'],
  ])('%s redirects only on an explicit anonymous status', (file, method) => {
    const body = stripComments(read(file));
    /*
     * Case-insensitive: the layout destructures `status` as `authStatus`
     * because it already has a `platform.loading` beside it. What matters is
     * that the redirect is driven by the named state, not by a falsy user.
     */
    expect(body.toLowerCase()).toContain("status === 'anonymous'");
    // The shape that caused it: a bare falsy-user check driving the redirect.
    expect(body).not.toMatch(new RegExp(`if \\(!user\\) \\{\\s*router\\.${method}\\('/login'\\)`));
  });
});

describe('the session is renewed rather than left to lapse', () => {
  const useAuth = stripComments(read('hooks/use-auth.tsx'));

  it('renews through the endpoint that re-signs from the principal', () => {
    expect(useAuth).toContain('/api/auth/refresh');
    expect(useAuth).toContain('persistSessionToken');
  });

  it('renews on a window rather than on every render', () => {
    expect(useAuth).toContain('RENEW_WITHIN_MS');
    expect(useAuth).toContain('RENEW_CHECK_INTERVAL_MS');
  });

  it('does not sign anybody out when renewal fails', () => {
    // Still valid for up to another day; the next check tries again. Clearing
    // the token here would turn a transient failure into a forced login.
    const renewal = useAuth.slice(useAuth.indexOf('const renewIfDue'));
    expect(renewal).not.toContain('clearSessionToken');
  });
});
