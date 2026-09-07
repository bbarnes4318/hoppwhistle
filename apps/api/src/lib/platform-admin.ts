/**
 * NetEnroll platform staff: the capability, and the acting-tenant switch.
 *
 * ── The capability ───────────────────────────────────────────────────────────
 *
 * A `PlatformAdmin` row is the whole thing. It has no scope, no tenant and no
 * level, because "may this person act across every agency" is a yes-or-no
 * question that has nothing to do with which agency anyone is in.
 *
 * It deliberately is not a `RoleName`. Roles are granted through `UserRole`,
 * which is per-tenant, so every existing check on OWNER or ADMIN means "an
 * administrator of SOME agency". Gating a platform-wide route on OWNER lets in
 * the principal of every agency on the platform.
 *
 * ── The switch ───────────────────────────────────────────────────────────────
 *
 * A platform admin's acting tenant defaults to NONE. That is not a wildcard: an
 * agency-scoped route refuses them exactly as it refuses an anonymous caller,
 * because a query with no tenant is a query we cannot safely answer. What they
 * get instead is the cross-agency view, on routes built for it.
 *
 * To act inside one agency they call `enterActingTenant`, which writes a row
 * and an AuditLog entry. `leaveActingTenant` deletes the row and writes a
 * second entry. Between the two, `middleware/auth.ts` copies the selection onto
 * `request.user.tenantId`, so every existing tenant-scoped query in the
 * codebase scopes to it with no change to the query and no change to
 * `lib/tenant-context.ts`.
 *
 * That last point is the design constraint, not an implementation detail. The
 * helper still reads `request.user` and nothing else. The switch populates the
 * principal; it does not teach the helper a second way to find a tenant. Any
 * other arrangement -- a privileged branch in the helper, a header the helper
 * trusts for some callers -- reopens what Phase 1 closed, and would do it on
 * the accounts with the most access.
 */

import { auditLog } from '../services/audit.js';

import { getPrismaClient } from './prisma.js';

/**
 * The roles a platform operator carries while inside an agency.
 *
 * Entering an agency has to grant something, or the switch is a button that
 * does nothing: the operator gets the agency's data SCOPE from
 * `PlatformActingTenant`, but holds no `UserRole` row inside it, and the
 * role-aware handlers (`getUserProfile`, `buildCallWhere`, the publisher and
 * buyer narrowing) would then show them an empty agency.
 *
 * So while inside, and only while inside, the principal carries ADMIN and
 * OWNER for that one agency. That is the plain meaning of "act inside an
 * agency" for staff who can already see all of them, and it is bounded three
 * ways: one agency at a time, only while the selection row exists, and every
 * entry and exit written to the audit log.
 *
 * These are attached to the principal, not written as `UserRole` rows. Nothing
 * persists, so revoking the capability or leaving the agency takes them away
 * immediately rather than leaving grants behind to be cleaned up.
 */
export const ACTING_TENANT_ROLES = ['ADMIN', 'OWNER'] as const;

/** What the authentication middleware needs to know about a principal. */
export interface PlatformContext {
  isPlatformAdmin: boolean;
  /**
   * The agency the operator has explicitly entered, or null for the
   * cross-agency view. Always null for a non-platform-admin, whose tenant comes
   * from their own user row as it always did.
   */
  actingTenantId: string | null;
  /** The entered agency's display name, for the UI banner. */
  actingTenantName: string | null;
  enteredAt: Date | null;
  /**
   * Roles to merge onto the principal: `ACTING_TENANT_ROLES` while inside an
   * agency, empty otherwise. Empty in the cross-agency view is deliberate --
   * "administrator of every agency at once" is not a state this system has.
   */
  actingRoles: readonly string[];
}

export const NO_PLATFORM_CONTEXT: PlatformContext = {
  isPlatformAdmin: false,
  actingTenantId: null,
  actingTenantName: null,
  enteredAt: null,
  actingRoles: [],
};

/**
 * Load a user's platform capability and current acting-tenant selection.
 *
 * One query, on the authenticated user id, on every authenticated request. It
 * is a primary-key lookup on a table with one row per operator, and there are
 * two operators.
 */
export async function loadPlatformContext(userId: string): Promise<PlatformContext> {
  const prisma = getPrismaClient();

  const admin = await prisma.platformAdmin.findUnique({
    where: { userId },
    select: {
      user: {
        select: {
          platformActingTenant: {
            select: {
              tenantId: true,
              enteredAt: true,
              tenant: { select: { name: true, status: true } },
            },
          },
        },
      },
    },
  });

  if (!admin) return NO_PLATFORM_CONTEXT;

  const selection = admin.user.platformActingTenant;

  // A selection into an agency that has since been suspended is not honoured:
  // the operator drops back to the cross-agency view rather than acting inside
  // a tenant the platform has switched off.
  if (!selection || selection.tenant.status !== 'ACTIVE') {
    return {
      isPlatformAdmin: true,
      actingTenantId: null,
      actingTenantName: null,
      enteredAt: null,
      actingRoles: [],
    };
  }

  return {
    isPlatformAdmin: true,
    actingTenantId: selection.tenantId,
    actingTenantName: selection.tenant.name,
    enteredAt: selection.enteredAt,
    actingRoles: ACTING_TENANT_ROLES,
  };
}

/** Whether this user holds the capability, without loading the selection. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const row = await prisma.platformAdmin.findUnique({
    where: { userId },
    select: { id: true },
  });
  return row !== null;
}

export interface OperatorContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export class PlatformSwitchError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'PlatformSwitchError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Enter an agency, as a platform operator.
 *
 * Writes the selection row and exactly one `platform.tenant.entered` AuditLog
 * entry naming the operator, the tenant and the time. Entering a second agency
 * while already inside one leaves the first (one audit row) and enters the
 * second (one more), so the trail reads as a sequence of visits rather than a
 * jump.
 */
export async function enterActingTenant(
  userId: string,
  tenantId: string,
  context: OperatorContext = {}
): Promise<{ tenantId: string; tenantName: string; enteredAt: Date }> {
  const prisma = getPrismaClient();

  if (!(await isPlatformAdmin(userId))) {
    throw new PlatformSwitchError(
      'FORBIDDEN',
      'Only NetEnroll platform staff can act inside an agency',
      403
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, status: true },
  });

  if (!tenant) {
    throw new PlatformSwitchError('NOT_FOUND', 'Agency not found', 404);
  }

  if (tenant.status !== 'ACTIVE') {
    throw new PlatformSwitchError('TENANT_INACTIVE', 'That agency is not active', 409);
  }

  // Already inside a different agency: leave it first, so the audit trail has a
  // closing row for the visit that is ending.
  const existing = await prisma.platformActingTenant.findUnique({ where: { userId } });
  if (existing && existing.tenantId !== tenantId) {
    await leaveActingTenant(userId, context);
  }

  const enteredAt = new Date();
  await prisma.platformActingTenant.upsert({
    where: { userId },
    create: { userId, tenantId, enteredAt },
    update: { tenantId, enteredAt },
  });

  await writePlatformAudit({
    tenantId,
    userId,
    action: 'platform.tenant.entered',
    entityId: tenantId,
    context,
  });

  return { tenantId, tenantName: tenant.name, enteredAt };
}

/**
 * Leave the agency currently entered, returning to the cross-agency view.
 *
 * Writes exactly one `platform.tenant.left` AuditLog entry, and only when there
 * was something to leave: calling this twice does not produce two rows, because
 * a second "left" with no matching "entered" is a lie about what happened.
 */
export async function leaveActingTenant(
  userId: string,
  context: OperatorContext = {}
): Promise<{ leftTenantId: string | null }> {
  const prisma = getPrismaClient();

  const existing = await prisma.platformActingTenant.findUnique({ where: { userId } });
  if (!existing) return { leftTenantId: null };

  await prisma.platformActingTenant.delete({ where: { userId } });

  await writePlatformAudit({
    tenantId: existing.tenantId,
    userId,
    action: 'platform.tenant.left',
    entityId: existing.tenantId,
    context,
  });

  return { leftTenantId: existing.tenantId };
}

/**
 * The audit row for a switch.
 *
 * This used to write through Prisma directly, bypassing `services/audit.ts`,
 * because `auditLog()` caught and discarded its own failures -- and the whole
 * point of these rows is that a NetEnroll operator entering an agency is
 * recorded. A row that might vanish is not a record.
 *
 * `auditLog()` no longer swallows, so the bypass is gone and these go through
 * the same path as everything else. If the row cannot be written, the switch
 * fails and the operator is told, rather than quietly entering the agency
 * unlogged.
 */
async function writePlatformAudit(params: {
  tenantId: string;
  userId: string;
  action: string;
  entityId: string;
  context: OperatorContext;
}): Promise<void> {
  await auditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: params.action,
    entityType: 'Tenant',
    entityId: params.entityId,
    resource: '/api/v1/platform/acting-tenant',
    method: params.action === 'platform.tenant.entered' ? 'POST' : 'DELETE',
    ipAddress: params.context.ipAddress,
    userAgent: params.context.userAgent,
    requestId: params.context.requestId,
    success: true,
  });
}

/**
 * Grant the capability. Used by the provisioning command and by tests.
 *
 * Idempotent: re-running the provisioning command must not fail, and must not
 * silently create a second grant.
 */
export async function grantPlatformAdmin(
  userId: string,
  options: { grantedBy?: string; note?: string } = {}
): Promise<{ created: boolean }> {
  const prisma = getPrismaClient();

  const existing = await prisma.platformAdmin.findUnique({ where: { userId } });
  if (existing) return { created: false };

  await prisma.platformAdmin.create({
    data: { userId, grantedBy: options.grantedBy ?? null, note: options.note ?? null },
  });

  return { created: true };
}

/** Revoke the capability, and drop any agency the operator was inside. */
export async function revokePlatformAdmin(userId: string): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.platformActingTenant.deleteMany({ where: { userId } });
  await prisma.platformAdmin.deleteMany({ where: { userId } });
}
