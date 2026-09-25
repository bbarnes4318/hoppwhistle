/**
 * The white-label tier: an agency that also sells calls.
 *
 * ── What it is ───────────────────────────────────────────────────────────────
 *
 * `Tenant.whiteLabel`, set by NetEnroll staff only (the branding route in
 * `routes/platform.ts`, audited). A white-label agency's OWNER and ADMIN run
 * their own call network -- publishers, buyers, campaigns, numbers, payouts --
 * and their own downline agencies, on top of everything a normal agency has.
 *
 * ── Where it is decided ──────────────────────────────────────────────────────
 *
 * On the principal, at authentication, from the tenant the principal already
 * resolved to: `principal.tenantWhiteLabel`. Never from the wire. A platform
 * admin gets the value of the agency they have ENTERED, and none in the
 * cross-agency view. Both authenticators write it
 * (`middleware/api-v1-auth.ts` and `middleware/auth.ts`), so a route behind
 * the `authenticate` preHandler -- which rebuilds `request.user` -- reads the
 * same answer as the global /api/v1 hook.
 *
 * The flag names the TENANT. What the person may do is the flag AND a role:
 * `isWhiteLabelOperator` below. An AGENT of a white-label agency is an agent.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

import { logger } from './logger.js';
import { getPrismaClient } from './prisma.js';
import { getActingTenantId, sendTenantRefusal } from './tenant-context.js';

/** The roles that run a white-label agency's call network. */
export const WHITE_LABEL_ROLES: readonly string[] = ['OWNER', 'ADMIN'];

/** What this module reads off `request.user`. */
export interface WhiteLabelPrincipal {
  roles?: string[];
  tenantWhiteLabel?: boolean;
  isPlatformAdmin?: boolean;
}

export const WHITE_LABEL_ONLY = {
  code: 'WHITE_LABEL_ONLY',
  message: 'This screen is part of the white-label tier.',
} as const;

/**
 * Whether ONE tenant is on the white-label tier.
 *
 * Fails closed: an unknown tenant, no tenant, or a read that throws all answer
 * false. The flag only ever GRANTS access, so the safe reading of "could not
 * tell" is the tenant's ordinary, narrower portal -- never a refused request
 * for somebody who was only ever going to be a normal agency, and never an
 * open door.
 */
export async function loadTenantWhiteLabel(tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) return false;
  try {
    const tenant = await getPrismaClient().tenant.findUnique({
      where: { id: tenantId },
      select: { whiteLabel: true },
    });
    return tenant?.whiteLabel === true;
  } catch (error) {
    logger.warn({
      msg: 'white-label: could not read the tenant flag; treating as off',
      tenantId,
      error,
    });
    return false;
  }
}

/** A white-label tenant's OWNER or ADMIN. The flag alone is not enough. */
export function isWhiteLabelOperator(principal: WhiteLabelPrincipal | undefined | null): boolean {
  if (!principal || principal.tenantWhiteLabel !== true) return false;
  return (principal.roles ?? []).some(role => WHITE_LABEL_ROLES.includes(role));
}

/**
 * preHandler for the white-label screens' own routes: Sales, Payouts and the
 * Agency Network.
 *
 * Lets through a white-label OWNER/ADMIN, and a platform admin acting inside an
 * agency. Everybody else -- a normal agency's owner, a white-label agency's
 * agent -- gets 403. A platform admin with no agency entered gets the usual
 * 409, because what is wrong is their session, not their capability.
 *
 * It names no tenant. The handler still resolves the acting tenant itself, the
 * one way every route does.
 */
export async function requireWhiteLabelOperator(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await Promise.resolve();
  const principal = request.user as WhiteLabelPrincipal | undefined;

  if (principal?.isPlatformAdmin === true) {
    if (!getActingTenantId(request)) {
      const body = sendTenantRefusal(request, reply);
      void reply.send(body);
    }
    return;
  }

  if (!isWhiteLabelOperator(principal)) {
    void reply.code(403).send({ error: WHITE_LABEL_ONLY });
    return;
  }

  if (!getActingTenantId(request)) {
    const body = sendTenantRefusal(request, reply);
    void reply.send(body);
  }
}
