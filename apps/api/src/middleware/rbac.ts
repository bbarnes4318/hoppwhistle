import type { RoleName } from '@prisma/client';
import { FastifyRequest, FastifyReply } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { describeTenantRefusal, getActingTenantId } from '../lib/tenant-context.js';
import { auditLog } from '../services/audit.js';

/**
 * Every permission this system recognises, as data.
 *
 * A `type` union vanishes at compile time, so the runtime had no way to ask
 * "is this string a permission?" -- and `getUserPermissions()` merges
 * `roles.permissions`, a free-form JSON column, straight into a user's
 * effective set. `KNOWN_PERMISSIONS` derived from the ROLE_PERMISSIONS map
 * instead, which looked equivalent and was not: `settings:read` and
 * `settings:write` are declared here and carried by the ADMIN database row, but
 * no entry in that map names them, so deriving from the map silently dropped
 * them and took carrier routing away from every agency administrator.
 *
 * So the list is the source and the union is derived from it. They cannot
 * drift, and the runtime can answer the question.
 */
export const ALL_PERMISSIONS = [
  // Users & Roles
  'users:read',
  'users:write',
  'users:delete',
  'roles:read',
  'roles:write',
  'roles:delete',
  // API Keys
  'api_keys:read',
  'api_keys:write',
  'api_keys:delete',
  // Numbers
  'numbers:read',
  'numbers:write',
  'numbers:delete',
  // Campaigns
  'campaigns:read',
  'campaigns:write',
  'campaigns:delete',
  // Flows
  'flows:read',
  'flows:write',
  'flows:delete',
  'flows:publish',
  // Calls
  'calls:read',
  'calls:write',
  'calls:delete',
  // Recordings
  'recordings:read',
  'recordings:write',
  'recordings:delete',
  // Webhooks
  'webhooks:read',
  'webhooks:write',
  'webhooks:delete',
  // Billing
  'billing:read',
  'billing:write',
  // Reports
  'reports:read',
  // Payroll
  'payroll:read',
  'payroll:write',
  'payroll:admin',
  // Tenant settings. The ADMIN rows already in the `roles` table grant these
  // two in their permissions JSON, and getUserPermissions() merges that JSON
  // into a user's effective set — but the union never declared them, so no
  // route could name them without a cast.
  'settings:read',
  'settings:write',
  // Admin
  'admin:*',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

// Role-based permission mappings
/**
 * Exported so the capability matrix can be asserted by READING it rather than
 * by driving a route for every cell. `agent-capabilities.test.ts` is the reader.
 */
export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  OWNER: ['admin:*'], // Owner has all permissions
  ADMIN: [
    'users:read',
    'users:write',
    'users:delete',
    'roles:read',
    'roles:write',
    'api_keys:read',
    'api_keys:write',
    'api_keys:delete',
    'numbers:read',
    'numbers:write',
    'numbers:delete',
    'campaigns:read',
    'campaigns:write',
    'campaigns:delete',
    'flows:read',
    'flows:write',
    'flows:delete',
    'flows:publish',
    'calls:read',
    'calls:write',
    'calls:delete',
    'recordings:read',
    'recordings:write',
    'recordings:delete',
    'webhooks:read',
    'webhooks:write',
    'webhooks:delete',
    'billing:read',
    'billing:write',
    'reports:read',
    'payroll:read',
    'payroll:write',
    'payroll:admin',
    /*
     * Tenant settings, including carrier routing.
     *
     * These were declared in ALL_PERMISSIONS and granted only by the ADMIN row's
     * `permissions` JSON, never by this map -- so whether an agency
     * administrator could reach carrier routing depended on a column that a
     * migration, a seed or a person had to have written correctly. It is a
     * capability ADMIN is meant to have; it belongs in the definition, not in
     * data that can be absent.
     */
    'settings:read',
    'settings:write',
  ],
  ANALYST: [
    'calls:read',
    'recordings:read',
    'reports:read',
    'campaigns:read',
    'flows:read',
    'numbers:read',
  ],
  PUBLISHER: [
    'flows:read',
    'flows:write',
    'flows:publish',
    'campaigns:read',
    'campaigns:write',
    'calls:read',
    'recordings:read',
  ],
  BUYER: ['calls:read', 'calls:write', 'recordings:read', 'campaigns:read'],
  /**
   * A read-only observer. No `reports:read`, deliberately.
   *
   * It was listed here, and no route has ever read it: grep `reports:read`
   * across `apps/api/src` and every hit is this file declaring it. What guards
   * the three endpoints `/reports` fetches is a role test, in `routes/index.ts`:
   *
   *   publisher-revenue      ADMIN/OWNER, or PUBLISHER for their own rows
   *   buyer-costs            ADMIN/OWNER, or BUYER for their own rows
   *   campaign-profitability ADMIN/OWNER only
   *
   * Each answers 403 to anyone else, the `/export.csv` pair alongside them too.
   * The proof that `reports:read` was never the gate on revenue and cost data
   * is ANALYST: it holds the permission and is refused by all three anyway.
   *
   * So the entry granted READONLY nothing while it was only a declaration. It
   * stopped being only a declaration when `/api/auth/me` began sending this
   * table to the browser and `use-auth` began rendering from it: a stale grant
   * here now puts a Reports link in a READONLY user's sidebar, pointing at a
   * page whose own guard refuses them. Removing it makes the table say what
   * the routes have always done.
   */
  READONLY: ['calls:read', 'recordings:read', 'campaigns:read', 'flows:read', 'numbers:read'],
  /**
   * One agent on a call floor. Derived from the work, not from ADMIN.
   *
   * ── What this used to be ─────────────────────────────────────────────────
   *
   * Twenty of ADMIN's thirty-four permissions, including `users:write`,
   * `billing:write`, `payroll:write` and four delete verbs. It read as ADMIN
   * with a few entries struck out, which is how it came to include the one
   * that was live: `numbers:write` gates `PUT
   * /api/v1/carrier-routing/routes/:callType` (see `canWrite` in
   * routes/carrier-routing.ts), so every agent on the platform could
   * reconfigure where their agency's calls were routed. The comment above that
   * gate reads "no lesser role gets it". A lesser role did.
   *
   * ── How this list was built ──────────────────────────────────────────────
   *
   * From the sixteen pages an agent is entitled to, one capability at a time,
   * asking what the agent DOES rather than what an administrator has. Every
   * entry below names the work it exists for. An entry with no such sentence
   * does not belong here.
   *
   * ── Reading a capability ─────────────────────────────────────────────────
   *
   * A capability says which verb on which resource. It does NOT say whose rows:
   * that is the handler's job, from the principal, and it is the only place it
   * can be done correctly -- `buildCallWhere` narrows /calls to the agent's own
   * calls while an ADMIN with the identical `calls:read` sees the agency's.
   *
   * So `billing:read` here means "may open a billing view", not "may see the
   * agency's money". What an agent is shown is decided by the handler, and the
   * agent-scoped money endpoints are where that is enforced. Page visibility
   * has never been mutation authority, and it is not scope either.
   */
  AGENT: [
    // The call floor. Read their own calls; write a disposition and notes on a
    // call they took. No delete: it destroys the billing and compliance record.
    'calls:read',
    'calls:write',
    // Play back a call they took. `checkRecordingAccess` narrows an AGENT to
    // recordings of calls they created or took on one of their own numbers.
    // No write, no delete: same compliance record.
    'recordings:read',
    // The campaigns they are assigned to, and the numbers they dial from.
    // READ only -- an agent does not author campaigns or provision DIDs, and
    // `numbers:write` is what let them rewrite carrier routing.
    'campaigns:read',
    'numbers:read',
    // Reports and CRM reports, narrowed to their own production by the handler.
    'reports:read',
    // Their own payroll: hours logged, earnings summary, payout history. The
    // self-service time-entry routes key on `userId`, and the admin payroll
    // surface is gated on requireRole('ADMIN','OWNER') rather than on this.
    'payroll:read',
    // Rate, Delivery, Settlements, Billing and Quotas & Budget -- the five
    // money pages an agent is entitled to, READ only, narrowed to their own
    // production. Every mutation on that surface (company payment methods,
    // invoices, settlement approval, company-wide budgets, global rate tables)
    // needs `billing:write`, which is deliberately absent.
    'billing:read',
    // Colleague names, for the rosters that render beside calls and
    // applications. `users:write` is absent: an agent administers nobody.
    'users:read',
  ],
};

/**
 * Capabilities no agent may hold, whatever a database row says.
 *
 * `getUserPermissions()` merges `role.permissions` -- a JSON column -- on top
 * of the map above, and the quarantined bulk-grant SQL wrote
 * `'["calls:*","contacts:*"]'` into the AGENT row on at least one database.
 * `calls:*` matches `calls:delete` under `permissionMatches`, so the column can
 * widen a role past its definition here, silently, with no code change.
 *
 * This is the floor under that. It is enforced in `getUserPermissions()` rather
 * than asserted in a test, because the row it guards against already exists
 * somewhere and a test would only prove the map is clean.
 */
const NEVER_FOR_AGENT: readonly Permission[] = [
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

/** The same list, as a set, for the default-deny filter below. */
const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set<string>(ALL_PERMISSIONS);

/**
 * Check if a permission matches a required permission
 * Supports wildcard matching (e.g., 'admin:*' matches 'admin:users:read')
 */
function permissionMatches(required: Permission, userPermission: Permission): boolean {
  if (userPermission === 'admin:*') {
    return true;
  }

  if (userPermission === required) {
    return true;
  }

  // Wildcard matching: 'users:*' matches 'users:read'
  const userParts = userPermission.split(':');
  const requiredParts = required.split(':');

  if (userParts.length !== requiredParts.length) {
    return false;
  }

  for (let i = 0; i < userParts.length; i++) {
    if (userParts[i] === '*' || userParts[i] === requiredParts[i]) {
      continue;
    }
    return false;
  }

  return true;
}

/**
 * A role's effective permissions: the map above, plus whatever its database row
 * adds, minus anything that is not a permission and anything an agent may never
 * hold.
 *
 * ── Why the JSON column is filtered rather than trusted ──────────────────────
 *
 * `roles.permissions` is a free-form JSON array, written by migrations, by
 * seeds, and -- on at least one production database -- by hand. The quarantined
 * bulk-grant SQL put `'["calls:*","contacts:*"]'` on the AGENT row. `calls:*`
 * matches `calls:delete` under `permissionMatches`, so that column silently
 * granted a capability the code does not, and would survive any amount of
 * tightening of the map above.
 *
 * Two rules close that:
 *
 *   1. DEFAULT-DENY. A string that is not a permission this system declares
 *      grants nothing. `contacts:*` is not a typo to be honoured; it is a
 *      string in a JSON column that no route has ever read.
 *   2. AGENT has a floor. `NEVER_FOR_AGENT` is subtracted last, so no row --
 *      present, future, or hand-written -- can give an agent the capabilities
 *      the brief says an agent must never have.
 *
 * Wildcards from the column are held to the same rule: `calls:*` is not a
 * declared permission, so it is dropped. A role that genuinely needs every
 * `calls:` verb lists them, which is also the only spelling a reader can audit.
 */
export function effectivePermissionsFor(
  roleName: RoleName,
  rowPermissions: unknown
): Permission[] {
  const granted = new Set<Permission>(ROLE_PERMISSIONS[roleName] ?? []);

  if (Array.isArray(rowPermissions)) {
    for (const entry of rowPermissions) {
      if (typeof entry === 'string' && KNOWN_PERMISSIONS.has(entry)) {
        granted.add(entry as Permission);
      }
    }
  }

  if (roleName === 'AGENT') {
    for (const forbidden of NEVER_FOR_AGENT) granted.delete(forbidden);
  }

  return Array.from(granted);
}

/**
 * Get user permissions from roles
 */
async function getUserPermissions(tenantId: string, userId: string): Promise<Permission[]> {
  const prisma = getPrismaClient();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: {
        include: {
          role: true,
        },
      },
    },
  });

  if (!user || user.tenantId !== tenantId) {
    return [];
  }

  const permissions = new Set<Permission>();

  /*
   * The union across every role this user holds, each one filtered by
   * `effectivePermissionsFor`. A user holding AGENT *and* ADMIN gets ADMIN's
   * capabilities: the AGENT floor removes what the AGENT role grants, not what
   * another role does, because an account genuinely holding both is an
   * administrator who also takes calls. Which accounts hold both is a data
   * question, and `scripts/authz-report.sh` section 4b is what answers it.
   */
  for (const userRole of user.roles) {
    const roleName = userRole.role.name as RoleName;
    for (const perm of effectivePermissionsFor(roleName, userRole.role.permissions)) {
      permissions.add(perm);
    }
  }

  return Array.from(permissions);
}

/**
 * Get API key scopes
 */
async function getApiKeyScopes(tenantId: string, apiKeyId: string): Promise<Permission[]> {
  const prisma = getPrismaClient();

  const apiKey = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
  });

  if (!apiKey || apiKey.tenantId !== tenantId || apiKey.status !== 'ACTIVE') {
    return [];
  }

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return [];
  }

  if (apiKey.scopes && Array.isArray(apiKey.scopes)) {
    return apiKey.scopes as Permission[];
  }

  return [];
}

/**
 * Check if user has required permission.
 *
 * ── Platform staff ───────────────────────────────────────────────────────────
 *
 * A NetEnroll operator inside an agency holds no `UserRole` row there -- the
 * capability lives outside the tenant dimension by design, and entering an
 * agency writes no grants. So every route gated on a per-tenant permission
 * refused them, which made the acting-tenant switch a button that opened half
 * the product. Phase 1b recorded that as a known limitation and left the policy
 * decision open; the decision is that platform admins have full access
 * everywhere, so the check is widened here.
 *
 * The widening keys off the `PlatformAdmin` capability and NOTHING else. Not a
 * role -- roles are per-tenant and every agency has an OWNER. Not a header,
 * query parameter or body field -- those are exactly what Phase 1 removed, and
 * re-adding one for the most privileged accounts is the worst possible place to
 * start. `isPlatformAdmin` is written onto the principal by
 * `middleware/auth.ts` from a row keyed on the authenticated user id, and a
 * user with no row sees no change from any of this.
 *
 * It is still bounded by the acting tenant: an operator in the cross-agency
 * view has no tenant, so the queries behind these routes have nothing to scope
 * to, and `lib/tenant-context.ts` refuses them there. Granting the permission
 * without a tenant would not widen what they can read -- it would only turn a
 * clear refusal into an empty page -- so this returns false and
 * `requirePermission` below answers with NO_ACTING_TENANT instead.
 */
export async function checkPermission(
  request: FastifyRequest,
  requiredPermission: Permission
): Promise<boolean> {
  const user = request.user;
  if (!user) {
    return false;
  }

  // Permissions are per-tenant: they are read from role rows inside one agency.
  // An operator in the cross-agency view has no acting tenant and so holds no
  // per-tenant permission. Refusing here rather than looking permissions up
  // under `undefined` keeps that explicit.
  if (!user.tenantId) {
    return false;
  }

  // NetEnroll staff, inside an agency. See the note above: the capability, and
  // only the capability.
  if (user.isPlatformAdmin === true) {
    return true;
  }

  // API key authentication
  if (user.apiKeyId) {
    const scopes = await getApiKeyScopes(user.tenantId, user.apiKeyId);
    return scopes.some(scope => permissionMatches(requiredPermission, scope as Permission));
  }

  // JWT/user authentication
  if (user.userId) {
    const permissions = await getUserPermissions(user.tenantId, user.userId);
    return permissions.some(perm => permissionMatches(requiredPermission, perm));
  }

  return false;
}

/**
 * Refuse a platform operator who has not entered an agency, distinctly.
 *
 * Returns true when it has answered the request. Every per-tenant gate below
 * calls this before deciding anything, so "you are in the cross-agency view"
 * never reaches a client as 401 (your session is dead) or 403 (you may not
 * have this). See `lib/tenant-context.ts` for why those two answers cost the
 * owner access to production.
 */
function refuseWithoutActingTenant(request: FastifyRequest, reply: FastifyReply): boolean {
  if (getActingTenantId(request)) return false;

  const refusal = describeTenantRefusal(request);
  if (refusal.statusCode !== 409) return false;

  void reply.code(refusal.statusCode).send({ error: refusal.error });
  return true;
}

/**
 * Authorization middleware factory
 */
export function requirePermission(requiredPermission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;

    if (!user) {
      reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    // A platform operator in the cross-agency view is not "denied": they have
    // not chosen an agency yet. Saying 403 here would be as misleading as the
    // 401 that used to come out of tenant resolution, and the web client would
    // bounce them to a page that cannot help.
    if (refuseWithoutActingTenant(request, reply)) return;

    const hasPermission = await checkPermission(request, requiredPermission);

    if (!hasPermission) {
      // Audit failed authorization attempt. A denial by a principal with no
      // acting tenant -- a NetEnroll operator in the cross-agency view, say --
      // is recorded with a null tenant rather than skipped.
      await auditLog({
        tenantId: user.tenantId ?? null,
        userId: user.userId,
        apiKeyId: user.apiKeyId,
        action: 'authorization.denied',
        entityType: 'Permission',
        resource: request.url,
        method: request.method,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: false,
        error: `Permission denied: ${requiredPermission}`,
      });

      reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Permission denied: ${requiredPermission}`,
        },
      });
      return;
    }
  };
}

/**
 * Require one of multiple permissions
 */
export function requireAnyPermission(...permissions: Permission[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;

    if (!user) {
      reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    if (refuseWithoutActingTenant(request, reply)) return;

    for (const permission of permissions) {
      const hasPermission = await checkPermission(request, permission);
      if (hasPermission) {
        return; // User has at least one required permission
      }
    }

    // Audit failed authorization attempt -- see the note in requirePermission.
    await auditLog({
      tenantId: user.tenantId ?? null,
      userId: user.userId,
      apiKeyId: user.apiKeyId,
      action: 'authorization.denied',
      entityType: 'Permission',
      resource: request.url,
      method: request.method,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: false,
      error: `Permission denied: requires one of [${permissions.join(', ')}]`,
    });

    reply.code(403).send({
      error: {
        code: 'FORBIDDEN',
        message: `Permission denied: requires one of [${permissions.join(', ')}]`,
      },
    });
  };
}

/**
 * Require specific role
 */
export function requireRole(...roles: RoleName[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;

    if (!user || !user.userId) {
      reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User authentication required',
        },
      });
      return;
    }

    if (refuseWithoutActingTenant(request, reply)) return;

    // NetEnroll staff inside an agency. Same rule as checkPermission: the
    // capability alone, never a role. Without this the comparison two lines
    // below rejects them outright -- an operator's own `User.tenantId` is null
    // while their acting tenant is the agency they entered, so
    // `userWithRoles.tenantId !== user.tenantId` is true for every platform
    // admin who has entered anywhere.
    if (user.isPlatformAdmin === true && user.tenantId) {
      return;
    }

    const prisma = getPrismaClient();
    const userWithRoles = await prisma.user.findUnique({
      where: { id: user.userId },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!userWithRoles || userWithRoles.tenantId !== user.tenantId) {
      reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'User not found',
        },
      });
      return;
    }

    const userRoles = userWithRoles.roles.map(ur => ur.role.name);
    const hasRole = roles.some(role => userRoles.includes(role as string));

    if (!hasRole) {
      await auditLog({
        tenantId: user.tenantId ?? null,
        userId: user.userId,
        action: 'authorization.denied',
        entityType: 'Role',
        resource: request.url,
        method: request.method,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: false,
        error: `Role denied: requires one of [${roles.join(', ')}]`,
      });

      reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Role denied: requires one of [${roles.join(', ')}]`,
        },
      });
      return;
    }
  };
}

/**
 * What the three helpers below read off a request.
 *
 * `roles` and `publisherId` are NOT in the JWT: `routes/auth.ts` signs
 * `{ tenantId, userId, email }` and nothing more. They are resolved from
 * `UserRole` and `User.publisherId` on every authenticated request, by
 * `hydratePrincipal()` in `lib/principal.ts` -- called from the /api/v1 auth
 * hook and from `authenticateJWT`. See that file for why the token stays small.
 *
 * The contract is one-directional and fails closed: a principal that was never
 * hydrated has no roles, and every branch here then denies. That is what these
 * functions did for EVERY publisher before the resolution existed, so a future
 * auth path that forgets to hydrate produces a visible 403 rather than a silent
 * grant.
 */
export interface ScopedPrincipal {
  roles?: string[];
  publisherId?: string | null;
}

/**
 * Check if the user has the PUBLISHER role
 */
export function isPublisherUser(user: ScopedPrincipal | null | undefined): boolean {
  return !!user?.roles?.includes('PUBLISHER');
}

/**
 * Enforce that the user has access to a specific publisherId.
 * Admin/Owner users always have access.
 * Publisher users only have access if they belong to that publisherId.
 *
 * ADMIN and OWNER are PER-TENANT roles, so the `true` they get here means "an
 * administrator of some agency", not "an administrator of the agency that owns
 * this publisher". Callers must still scope their query by the acting tenant --
 * this decides role, never tenancy.
 */
export function requirePublisherAccess(
  user: ScopedPrincipal | null | undefined,
  publisherId: string
): boolean {
  if (!user) return false;
  const userRoles = user.roles || [];
  if (userRoles.includes('ADMIN') || userRoles.includes('OWNER')) return true;
  if (userRoles.includes('PUBLISHER')) {
    // A publisher reaches their own publisher's data and nothing else. An empty
    // link must never match an empty parameter, hence the explicit truthiness.
    return !!user.publisherId && user.publisherId === publisherId;
  }
  return false;
}

/**
 * Builds a Prisma scoping where clause based on user roles.
 *
 * The `{}` an administrator gets narrows nothing, including by tenant: merge it
 * into a where clause that already carries the acting tenant, never use it as
 * the whole clause.
 */
export function buildPublisherScopedWhere(user: ScopedPrincipal | null | undefined) {
  if (!user) return { publisherId: 'none' };
  const userRoles = user.roles || [];
  if (userRoles.includes('ADMIN') || userRoles.includes('OWNER')) return {};
  if (userRoles.includes('PUBLISHER')) {
    return { publisherId: user.publisherId || 'none' };
  }
  return { publisherId: 'none' };
}

