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
  isPlatformAdmin?: boolean;
  actingTenantId?: string | null;
  actingTenantName?: string | null;
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
