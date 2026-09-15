import { RoleName } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { ROLE_PERMISSIONS, effectivePermissionsFor, type Permission } from '../middleware/rbac.js';

/**
 * The AGENT capability matrix, held in place.
 *
 * ── What an agent is ─────────────────────────────────────────────────────────
 *
 * Somebody who takes calls, writes applications, works their own leads and is
 * paid for it. They are entitled to sixteen pages, and page visibility has
 * never been mutation authority: an agent with a Billing page is not a billing
 * administrator, and an agent with a Rate page is not a rate administrator.
 *
 * ── Why these assertions and not "AGENT has N permissions" ───────────────────
 *
 * A count is satisfied by any N permissions, including the wrong ones. Each
 * case below names a capability and the reason it is or is not an agent's, so a
 * future change either keeps the reason true or fails here with the sentence
 * that explains what it broke.
 *
 * The live escalation this replaces: AGENT held `numbers:write`, and
 * `routes/carrier-routing.ts` gates `PUT /routes/:callType` on exactly that. An
 * agent could reconfigure where their agency's calls were routed. Nothing in
 * the permission map said so, because the map read as "ADMIN, minus a few".
 */

/** Capabilities the brief says an agent must never hold, at any time, ever. */
const FORBIDDEN: Permission[] = [
  'admin:*',
  'users:write',
  'users:delete',
  'roles:write',
  'roles:delete',
  'api_keys:read',
  'api_keys:write',
  'api_keys:delete',
  'numbers:write',
  'numbers:delete',
  'campaigns:write',
  'campaigns:delete',
  'calls:delete',
  'recordings:write',
  'recordings:delete',
  'flows:write',
  'flows:delete',
  'flows:publish',
  'webhooks:write',
  'webhooks:delete',
  'billing:write',
  'payroll:write',
  'payroll:admin',
  'settings:write',
];

/** What an agent needs to do their job. Each one names the page it serves. */
const REQUIRED: Array<[Permission, string]> = [
  ['calls:read', 'Calls, Live Board — their own calls'],
  ['calls:write', 'a disposition and notes on a call they took'],
  ['recordings:read', 'playback of a call they took'],
  ['campaigns:read', 'Campaigns — the ones they are assigned to'],
  ['numbers:read', 'Numbers — the ones they dial from'],
  ['reports:read', 'Reports and CRM Reports, narrowed to their production'],
  ['payroll:read', 'their own hours, earnings and payouts'],
  ['billing:read', 'Rate, Delivery, Settlements, Billing, Quotas & Budget'],
  ['users:read', 'colleague names on rosters beside calls and applications'],
];

describe('the AGENT capability matrix', () => {
  const agent = ROLE_PERMISSIONS[RoleName.AGENT];

  it.each(REQUIRED)('grants %s — %s', permission => {
    expect(agent).toContain(permission);
  });

  it.each(FORBIDDEN)('never grants %s', permission => {
    expect(agent).not.toContain(permission);
  });

  it('is an allowlist, not ADMIN with entries struck out', () => {
    // Every entry is one of the nine above. A tenth would be a capability
    // nobody wrote a reason for, which is how the last twenty got here.
    const allowed = new Set(REQUIRED.map(([p]) => p));
    expect(agent.filter(p => !allowed.has(p))).toEqual([]);
  });

  it('holds strictly fewer capabilities than ADMIN, and none ADMIN lacks', () => {
    const admin = new Set(ROLE_PERMISSIONS[RoleName.ADMIN]);
    expect(agent.filter(p => !admin.has(p))).toEqual([]);
    expect(agent.length).toBeLessThan(ROLE_PERMISSIONS[RoleName.ADMIN].length);
  });

  it('cannot read or reconfigure carrier routing', () => {
    // routes/carrier-routing.ts gates on admin:* / settings:read / settings:write.
    // It used to accept numbers:read and numbers:write as well, which every
    // agent holds for the Numbers page -- so the gate admitted them both ways.
    for (const gate of ['admin:*', 'settings:read', 'settings:write'] as Permission[]) {
      expect(agent).not.toContain(gate);
    }
  });

  it('leaves the Numbers page working', () => {
    // The fix was to stop carrier routing borrowing this, not to take it away:
    // an agent still needs to see the numbers they dial from.
    expect(agent).toContain('numbers:read');
  });
});

describe('an agency administrator keeps carrier routing', () => {
  it('holds settings:read and settings:write from the map, not from a JSON column', () => {
    // Previously granted only by roles.permissions on the ADMIN row, so whether
    // an administrator could reach carrier routing depended on a migration or a
    // seed having written that column.
    const admin = effectivePermissionsFor(RoleName.ADMIN, null);
    expect(admin).toContain('settings:read');
    expect(admin).toContain('settings:write');
  });

  it('gives an OWNER the same reach through admin:*', () => {
    expect(ROLE_PERMISSIONS[RoleName.OWNER]).toContain('admin:*');
  });

  it.each([RoleName.ANALYST, RoleName.READONLY, RoleName.PUBLISHER, RoleName.BUYER])(
    'does not give %s carrier routing',
    role => {
      const perms = effectivePermissionsFor(role, null);
      for (const gate of ['admin:*', 'settings:read', 'settings:write']) {
        expect(perms).not.toContain(gate);
      }
    }
  );
});

describe('a database row cannot widen a role past its definition', () => {
  it('drops a wildcard the code does not declare', () => {
    // The exact value the quarantined bulk-grant SQL wrote onto the AGENT row.
    const widened = effectivePermissionsFor(RoleName.AGENT, ['calls:*', 'contacts:*']);
    expect(widened).not.toContain('calls:*');
    expect(widened).not.toContain('contacts:*');
    expect(widened).not.toContain('calls:delete');
  });

  it('drops anything that is not a declared permission', () => {
    const widened = effectivePermissionsFor(RoleName.AGENT, [
      'totally:invented',
      '*',
      '',
      null,
      42,
      { users: 'write' },
    ]);
    expect(widened.sort()).toEqual([...ROLE_PERMISSIONS[RoleName.AGENT]].sort());
  });

  it('refuses a forbidden capability even when the row names it exactly', () => {
    // `billing:write` IS a declared permission -- ADMIN holds it -- so the
    // default-deny filter alone would let it through onto an agent. The floor
    // is what stops it.
    const widened = effectivePermissionsFor(RoleName.AGENT, [
      'billing:write',
      'users:write',
      'admin:*',
      'numbers:write',
    ]);
    for (const forbidden of ['billing:write', 'users:write', 'admin:*', 'numbers:write']) {
      expect(widened).not.toContain(forbidden);
    }
  });

  it('still honours a legitimate addition to a role that is not AGENT', () => {
    // The mechanism stays useful: ADMIN's row genuinely carries settings:read
    // and settings:write, and getUserPermissions has always merged them.
    const admin = effectivePermissionsFor(RoleName.ADMIN, ['settings:read', 'settings:write']);
    expect(admin).toContain('settings:read');
    expect(admin).toContain('settings:write');
  });

  it('leaves a role with no row permissions exactly as declared', () => {
    for (const role of Object.values(RoleName)) {
      expect(effectivePermissionsFor(role, null).sort()).toEqual(
        [...ROLE_PERMISSIONS[role]].sort()
      );
    }
  });
});

describe('no role can become another role', () => {
  it('gives OWNER the wildcard and nobody else', () => {
    for (const role of Object.values(RoleName)) {
      const has = ROLE_PERMISSIONS[role].includes('admin:*');
      expect(has, `${role} and admin:*`).toBe(role === RoleName.OWNER);
    }
  });

  it('gives no role the ability to grant roles except ADMIN and OWNER', () => {
    for (const role of Object.values(RoleName)) {
      if (role === RoleName.ADMIN || role === RoleName.OWNER) continue;
      expect(effectivePermissionsFor(role, null), `${role}`).not.toContain('roles:write');
    }
  });
});
