/**
 * Reading platform-staff state off a request.
 *
 * Deliberately a separate module from `tenant-context.ts`. That file answers
 * one question -- "which agency is this request acting as?" -- and Phase 1's
 * whole point was that it answers it from `request.user` and nothing else. This
 * file answers a different question, "is this NetEnroll staff?", and keeping
 * them apart is what stops the second question growing a privileged branch
 * inside the first.
 *
 * Both read the same populated principal. Neither reads the wire.
 */

import { FastifyReply, FastifyRequest } from 'fastify';

interface PlatformPrincipal {
  userId?: string;
  tenantId?: string | null;
  roles?: string[];
  isPlatformAdmin?: boolean;
  actingTenantId?: string | null;
  actingTenantName?: string | null;
  previewRole?: string | null;
  isReadOnlyPreview?: boolean;
}

type MaybeAuthenticatedRequest = FastifyRequest & { user?: PlatformPrincipal };

export const PLATFORM_ADMIN_REQUIRED = {
  code: 'FORBIDDEN',
  message: 'This is a NetEnroll platform operation',
} as const;

/**
 * Whether this request is NetEnroll staff.
 *
 * Reads the flag the authentication middleware set from a `PlatformAdmin` row.
 * A request that never authenticated has no flag and is not staff; an API key
 * is never staff, because the capability is granted to people.
 */
export function isPlatformAdminRequest(request: FastifyRequest): boolean {
  return (request as MaybeAuthenticatedRequest).user?.isPlatformAdmin === true;
}

/**
 * The agency a platform operator has explicitly entered, or null.
 *
 * This is reporting state, for the UI banner and for audit rows. It is NOT the
 * way to scope a query: the selection has already been copied onto
 * `request.user.tenantId`, so `getActingTenantId()` from `tenant-context.ts`
 * remains the one way a handler learns its tenant.
 */
export function getPlatformActingTenant(
  request: FastifyRequest
): { tenantId: string; tenantName: string | null } | null {
  const principal = (request as MaybeAuthenticatedRequest).user;
  if (!principal?.isPlatformAdmin || !principal.actingTenantId) return null;
  return {
    tenantId: principal.actingTenantId,
    tenantName: principal.actingTenantName ?? null,
  };
}

export const AGENCY_PRINCIPAL_REQUIRED = {
  code: 'FORBIDDEN',
  message: "This is an agency principal's view. Ask an administrator or the owner of this agency.",
} as const;

/**
 * The agency role this operator is previewing, or null.
 *
 * Reporting state, for `GET /api/v1/platform/context` and the banner the web app
 * renders from it. The enforcement is not here: the principal already carries
 * exactly the previewed role, and the read-only refusal is the global hook in
 * `middleware/read-only-preview.ts`.
 */
export function getPreviewRole(request: FastifyRequest): string | null {
  const principal = (request as MaybeAuthenticatedRequest).user;
  if (!principal?.isPlatformAdmin) return null;
  return principal.previewRole ?? null;
}

/** Whether this request is refused every write. See `getPreviewRole`. */
export function isReadOnlyPreviewRequest(request: FastifyRequest): boolean {
  return (request as MaybeAuthenticatedRequest).user?.isReadOnlyPreview === true;
}

/**
 * Fastify preHandler: refuse anyone who is not an administrator or the owner of
 * the agency this request acts as.
 *
 * ── Why the agency money routes needed this ──────────────────────────────────
 *
 * `/api/v1/delivery/*` and `/api/v1/rating/*` were `preHandler: [authenticate]`
 * and nothing else. They are correctly tenant-scoped -- no route on either
 * surface takes a parameter naming an agency -- so the only thing missing was a
 * role check, and "missing" meant any AGENT holding a token in the tenant could
 * read the agency's rate, its balance, its overrun, what it will be charged
 * tonight and every settled day it has ever had. Worse, the mandate endpoints
 * are writes: an agent could attach the bank account the nightly ACH debit is
 * taken from.
 *
 * An agency's price and its bank details are the principal's business. An agent
 * has exactly one money-shaped endpoint, `GET /api/v1/delivery/me`, which loads
 * no rate, balance, overrun or charge at all and is deliberately NOT gated here.
 *
 * ── Why ADMIN/OWNER and not a permission ────────────────────────────────────
 *
 * The permission set has no name for "may see what this agency is charged", and
 * inventing one would mean a migration and a grant for every existing admin to
 * keep them working. ADMIN and OWNER are what the pages behind these routes
 * already mean by "the principal", and a platform operator inside an agency
 * carries both (see ACTING_TENANT_ROLES) so support work is unaffected -- except
 * while previewing as AGENT, where being refused is the point.
 *
 * 401 when nobody is authenticated, 403 when somebody is but holds neither role.
 */
export async function requireAgencyPrincipal(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await Promise.resolve();

  const principal = (request as MaybeAuthenticatedRequest).user;

  if (!principal?.userId) {
    void reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
    return;
  }

  /*
   * A platform operator who has entered no agency falls THROUGH, not out.
   *
   * They hold no roles at all in the cross-agency view -- deliberately, see
   * ACTING_TENANT_ROLES -- so a plain role check would answer 403 "this is the
   * principal's view". That is the wrong thing to tell them and the wrong thing
   * to tell the client: the established refusal for "you have not picked an
   * agency" is the handler's own 409 NO_ACTING_TENANT, which the web app reads
   * and acts on by offering the agency picker. A 403 there would be a dead end.
   *
   * Nothing is served either way. `resolveTenant()` in the handler refuses them
   * before a single query runs; this only decides which refusal they get.
   */
  if (principal.isPlatformAdmin === true && !principal.actingTenantId) return;

  const roles = principal.roles ?? [];
  if (!roles.includes('ADMIN') && !roles.includes('OWNER')) {
    void reply.code(403).send({ error: AGENCY_PRINCIPAL_REQUIRED });
    return;
  }
}

/**
 * Fastify preHandler: refuse anyone who is not NetEnroll staff.
 *
 * For routes that operate on the platform rather than on one agency -- the
 * shared dialer, another tenant's quota, the cross-agency views. Those were
 * gated on ADMIN/OWNER, which are per-tenant roles: "an administrator of some
 * agency" is not "NetEnroll".
 *
 * 401 when nobody is authenticated, 403 when somebody is but is not staff, so
 * the two failures stay distinguishable to a client and in the logs.
 */
export async function requirePlatformAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await Promise.resolve();

  const principal = (request as MaybeAuthenticatedRequest).user;

  if (!principal?.userId) {
    void reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
    return;
  }

  if (principal.isPlatformAdmin !== true) {
    void reply.code(403).send({ error: PLATFORM_ADMIN_REQUIRED });
    return;
  }
}
