import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A page's `allowedRoles` and the permission list say one rule between them,
 * and neither file can see the other.
 *
 * ── The defect this exists for ───────────────────────────────────────────────
 *
 * `/reports` guarded itself with `allowedRoles={['ADMIN', 'OWNER', 'READONLY',
 * 'ANALYST']}` and `allowedPermissions={['reports:read']}`. READONLY was never
 * granted `reports:read`. `RoleGuard` requires BOTH -- it computes
 * `isStaffBypass || hasFullAccess || (hasRole && hasPermission)` -- so a
 * READONLY user was redirected away from a page whose own source named them as
 * welcome. `canViewReports` carried the matching half, a clause reading
 * `(READONLY && permissions.includes('reports:read'))` that could not be true
 * in any session.
 *
 * ── Which way it was resolved, and on what evidence ─────────────────────────
 *
 * READONLY does not see financial reports.
 *
 * NO route on the API reads `reports:read`: grep it across `apps/api/src` and
 * every hit is `middleware/rbac.ts` declaring it. The three endpoints the page
 * fetches are guarded by role, in `apps/api/src/routes/index.ts`:
 *
 *   /api/v1/reports/publisher-revenue        ADMIN/OWNER, or PUBLISHER's own
 *   /api/v1/reports/buyer-costs              ADMIN/OWNER, or BUYER's own
 *   /api/v1/reports/campaign-profitability   ADMIN/OWNER only
 *
 * each answering 403 to everyone else, their `/export.csv` twins likewise. The
 * decisive case is ANALYST: it holds `reports:read` and is refused by all three
 * anyway. `reports:read` was therefore never the gate on revenue and cost data,
 * and granting it to READONLY buys them a page that 403s on every tab.
 *
 * ── Why the assertions point at the server ──────────────────────────────────
 *
 * They used to point at a permission table in `use-auth.tsx`. That table is
 * gone: `/api/auth/me` now sends the list and the browser renders from it, so
 * `ROLE_PERMISSIONS` on the server is the one place the rule is written. That
 * move is what made a stale grant load-bearing -- while the READONLY row's
 * `reports:read` was only a declaration it changed nothing, and the moment the
 * browser started reading the table it put a Reports link in a READONLY
 * sidebar aimed at a page that refuses them. So the row is what this pins.
 *
 * Reading the server's source rather than importing it is deliberate:
 * `rbac.ts` pulls in Fastify and the Prisma client, neither of which belongs in
 * a web test process. `__tests__/one-role-model.test.ts` reads its subject
 * files the same way for the same reason.
 */

const WEB_SRC = join(__dirname, '..', '..');
const REPORTS_PAGE = join(WEB_SRC, 'app', '(dashboard)', 'reports', 'page.tsx');
const USE_AUTH = join(WEB_SRC, 'hooks', 'use-auth.tsx');
const ROLE_GUARD = join(WEB_SRC, 'components', 'auth', 'role-guard.tsx');
const RBAC = join(WEB_SRC, '..', '..', 'api', 'src', 'middleware', 'rbac.ts');

/** Comments carry permission literals too, and they are not grants. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** `ROLE_PERMISSIONS` from the server, as a map this file can actually query. */
function serverRolePermissions(): Record<string, string[]> {
  const source = readFileSync(RBAC, 'utf8');
  const start = source.indexOf('export const ROLE_PERMISSIONS');
  if (start === -1) throw new Error('ROLE_PERMISSIONS not found — has rbac.ts been restructured?');

  const body = stripComments(source.slice(start, source.indexOf('\n};', start)));
  const table: Record<string, string[]> = {};

  for (const [, role, list] of body.matchAll(/\b([A-Z][A-Z_]*)\s*:\s*\[([^\]]*)\]/g)) {
    table[role] = Array.from(list.matchAll(/'([^']+)'/g)).map(m => m[1]);
  }

  // A parse that silently returned {} would make every assertion below vacuous.
  for (const role of ['OWNER', 'ADMIN', 'ANALYST', 'PUBLISHER', 'BUYER', 'READONLY', 'AGENT']) {
    expect(table[role], `${role} missing from the parsed ROLE_PERMISSIONS`).toBeDefined();
  }
  return table;
}

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

describe('the reports guard and the permission table', () => {
  const reportsSource = readFileSync(REPORTS_PAGE, 'utf8');
  const useAuthSource = readFileSync(USE_AUTH, 'utf8');
  const roleGuardSource = readFileSync(ROLE_GUARD, 'utf8');
  const rolePermissions = serverRolePermissions();

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

  it('renders the capability from the server list rather than from role names', () => {
    /*
     * The other premise: `canViewReports` has to be the server's answer for the
     * ROLE_PERMISSIONS assertions to describe what a user actually sees. A role
     * ladder here would be a second copy of the rule -- the thing
     * `one-role-model.test.ts` exists to keep out.
     */
    const canViewReports = useAuthSource.slice(
      useAuthSource.indexOf('const canViewReports ='),
      useAuthSource.indexOf('const canViewBilling')
    );
    expect(canViewReports).toContain("can('reports:read')");
    expect(
      canViewReports,
      'canViewReports tests role names again; it should render the server list'
    ).not.toContain('userRoles.includes');
  });

  it('grants every role named on /reports the permission that page demands', () => {
    const allowedRoles = jsxStringArray(reportsSource, 'allowedRoles');
    const allowedPermissions = jsxStringArray(reportsSource, 'allowedPermissions');

    expect(allowedRoles.length).toBeGreaterThan(0);
    expect(allowedPermissions).toContain('reports:read');

    for (const role of allowedRoles) {
      const permissions = rolePermissions[role] ?? [];
      for (const required of allowedPermissions) {
        expect(
          grants(permissions, required),
          `/reports lists ${role} in allowedRoles but ROLE_PERMISSIONS never grants it ` +
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
     * expression alone produces a page full of 403s, and putting it back in
     * both would be a policy change the routes have not made.
     */
    expect(
      jsxStringArray(reportsSource, 'allowedRoles'),
      'READONLY is back in the /reports guard; the API still answers it 403'
    ).not.toContain('READONLY');

    expect(
      rolePermissions.READONLY,
      'READONLY is granted reports:read again — no API route honours it, and the ' +
        'browser now renders this table, so it puts a Reports link in their sidebar ' +
        'pointing at a page whose guard refuses them'
    ).not.toContain('reports:read');
  });

  it('leaves no capability testing a permission its own role never receives', () => {
    /*
     * The general form of the defect, so the next one fails here rather than
     * reading as a grant for however long nobody checks. A clause shaped
     *
     *   userRoles.includes('X') && permissions.includes('y:z')
     *
     * is dead unless the server actually grants `y:z` to `X`.
     */
    const clauses = Array.from(
      useAuthSource.matchAll(
        /userRoles\.includes\('([A-Z_]+)'\)\s*&&\s*permissions\.includes\('([a-z_]+:[a-z*]+)'\)/g
      )
    );

    for (const [, role, required] of clauses) {
      expect(
        grants(rolePermissions[role] ?? [], required),
        `a capability in use-auth.tsx tests (${role} && ${required}), but the server ` +
          `never grants ${required} to ${role}. The clause is always false: either grant ` +
          `the permission or delete the clause, which currently reads as though it allowed something.`
      ).toBe(true);
    }
  });
});
