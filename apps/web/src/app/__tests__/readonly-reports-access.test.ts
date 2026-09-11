import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getPermissions } from '@/hooks/use-auth';

/**
 * A page's `allowedRoles` and the client permission list say one rule between
 * them, and neither file can see the other.
 *
 * ── The defect this exists for ───────────────────────────────────────────────
 *
 * `/reports` guarded itself with `allowedRoles={['ADMIN', 'OWNER', 'READONLY',
 * 'ANALYST']}` and `allowedPermissions={['reports:read']}`. `getPermissions`
 * never granted READONLY `reports:read`. `RoleGuard` requires BOTH -- it
 * computes `isStaffBypass || hasFullAccess || (hasRole && hasPermission)` -- so
 * a READONLY user was redirected away from a page whose own source named them
 * as welcome.
 *
 * `canViewReports` carried the matching half of the confusion:
 *
 *   (userRoles.includes('READONLY') && permissions.includes('reports:read'))
 *
 * a clause that could not be true in any session, because the permission it
 * tests is never in the list. `canViewRecordings` had the identical dead clause
 * against `recordings:read`. Both read as though they granted something.
 *
 * ── Which way it was resolved, and on what evidence ─────────────────────────
 *
 * READONLY does not see financial reports.
 *
 * `apps/api/src/middleware/rbac.ts` does grant READONLY `reports:read` in its
 * table, and `docs/SECURITY.md` restates that table -- but NO route on the API
 * reads that permission: its only occurrences under `apps/api/src` are the
 * declaration itself. The three endpoints `/reports` actually fetches are
 * guarded by role, in `apps/api/src/routes/index.ts`:
 *
 *   /api/v1/reports/publisher-revenue        ADMIN/OWNER, or PUBLISHER's own
 *   /api/v1/reports/buyer-costs              ADMIN/OWNER, or BUYER's own
 *   /api/v1/reports/campaign-profitability   ADMIN/OWNER only
 *
 * each answering 403 to everyone else, their `/export.csv` twins likewise. The
 * decisive case is ANALYST: it holds `reports:read` in both tables and is
 * refused by all three anyway. `reports:read` was therefore never the gate on
 * revenue and cost data, and granting it to READONLY would have bought them a
 * page that 403s on every tab rather than any access at all.
 *
 * ── Why assert it here rather than by rendering ─────────────────────────────
 *
 * Rendering `/reports` as a READONLY user proves that one page. The rule is not
 * about one page: it is that a role named in ANY guard's `allowedRoles` must be
 * granted that guard's `allowedPermissions`, or the guard's two halves disagree
 * and the source lies about which way. That property is asserted below by
 * CALLING `getPermissions`, which is why it was lifted to module scope -- the
 * same move `platform-routes.ts` made for the cross-agency exemption list, and
 * for the same reason: a list asserted by calling it beats one matched with a
 * regex.
 */

const WEB_SRC = join(__dirname, '..', '..');
const REPORTS_PAGE = join(WEB_SRC, 'app', '(dashboard)', 'reports', 'page.tsx');
const USE_AUTH = join(WEB_SRC, 'hooks', 'use-auth.tsx');
const ROLE_GUARD = join(WEB_SRC, 'components', 'auth', 'role-guard.tsx');

/** `RoleGuard`'s own matching, including the `admin:*` wildcard it honours. */
function grants(permissions: string[], required: string): boolean {
  return permissions.includes('admin:*') || permissions.includes(required);
}

/** The string-array contents of a `prop={[...]}` on a JSX element. */
function jsxStringArray(source: string, prop: string): string[] {
  const match = source.match(new RegExp(`${prop}=\\{\\[([^\\]]*)\\]\\}`));
  if (!match) throw new Error(`${prop} not found — has the reports guard been rewritten?`);
  return Array.from(match[1].matchAll(/'([^']+)'/g)).map(m => m[1]);
}

describe('the reports guard and the client permission list', () => {
  const reportsSource = readFileSync(REPORTS_PAGE, 'utf8');
  const useAuthSource = readFileSync(USE_AUTH, 'utf8');
  const roleGuardSource = readFileSync(ROLE_GUARD, 'utf8');

  it('still requires a role AND a permission, which is what ties the two files', () => {
    /*
     * The premise of every assertion below. If this ever becomes `||`, a role
     * listed without its permission starts granting access instead of being
     * quietly refused, and the reasoning here has to be redone rather than
     * merely re-run.
     */
    expect(
      roleGuardSource,
      'RoleGuard no longer ANDs role and permission; re-derive who reaches /reports'
    ).toMatch(/hasRole && hasPermission/);
  });

  it('grants every role named on /reports the permission that page demands', () => {
    const allowedRoles = jsxStringArray(reportsSource, 'allowedRoles');
    const allowedPermissions = jsxStringArray(reportsSource, 'allowedPermissions');

    expect(allowedRoles.length).toBeGreaterThan(0);
    expect(allowedPermissions).toContain('reports:read');

    for (const role of allowedRoles) {
      const permissions = getPermissions([role]);
      for (const required of allowedPermissions) {
        expect(
          grants(permissions, required),
          `/reports lists ${role} in allowedRoles but getPermissions() never grants it ` +
            `${required}, so RoleGuard refuses them. Either grant the permission or ` +
            `drop the role — listing it alone only makes the page read as if it let ` +
            `${role} in.`
        ).toBe(true);
      }
    }
  });

  it('keeps READONLY off the financial reports page, at both expressions', () => {
    /*
     * The direction, pinned in one place. The API refuses READONLY on all three
     * report endpoints (see the header), so putting the role back in either
     * expression alone would produce a page full of 403s, and putting it back
     * in both would be a policy change the API has not made.
     */
    expect(
      jsxStringArray(reportsSource, 'allowedRoles'),
      'READONLY is back in the /reports guard; the API still answers it 403'
    ).not.toContain('READONLY');

    expect(
      getPermissions(['READONLY']),
      'READONLY is granted reports:read client-side; no API route honours it'
    ).not.toContain('reports:read');

    const canViewReports = useAuthSource.slice(
      useAuthSource.indexOf('const canViewReports ='),
      useAuthSource.indexOf('const canViewBilling')
    );
    expect(
      canViewReports.includes('READONLY'),
      'canViewReports names READONLY again — the sidebar would offer a link to a page the guard refuses'
    ).toBe(false);
  });

  it('leaves no capability testing a permission its own role never receives', () => {
    /*
     * The general form of the defect, so the next one fails here rather than
     * reading as a grant for however long nobody checks. A clause shaped
     *
     *   userRoles.includes('X') && permissions.includes('y:z')
     *
     * is dead unless `getPermissions(['X'])` can actually produce `y:z`. Both
     * per-account recording flags are passed as granted, so a clause that is
     * live for some publisher or buyer counts as live.
     */
    const clauses = Array.from(
      useAuthSource.matchAll(
        /userRoles\.includes\('([A-Z_]+)'\)\s*&&\s*permissions\.includes\('([a-z_]+:[a-z*]+)'\)/g
      )
    );

    for (const [, role, required] of clauses) {
      const permissions = getPermissions([role], { publisher: true, buyer: true });
      expect(
        grants(permissions, required),
        `a capability in use-auth.tsx tests (${role} && ${required}), but getPermissions() ` +
          `never grants ${required} to ${role}. The clause is always false: either grant ` +
          `the permission or delete the clause, which currently reads as though it allowed something.`
      ).toBe(true);
    }
  });
});
