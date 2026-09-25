/**
 * Checks for the foreign references an agency could otherwise write into its
 * own rows, on the marketplace routes the white-label tier opens.
 *
 * ── Why these exist ──────────────────────────────────────────────────────────
 *
 * The campaign, number and DID-route handlers were written for NetEnroll staff
 * alone. Each resolves the acting tenant and finds the row it is changing with
 * `{ id, tenantId }`, but several body fields that POINT somewhere were
 * written as given: a user to assign a number to, a flow or caller-ID pool for
 * a campaign, an extension to ring. Staff, working inside an agency on the
 * platform's behalf, may point those wherever the platform needs them, and
 * keep doing so. An agency may not: opening these routes to a white-label
 * agency's OWNER would otherwise let one agency ring another agency's agents,
 * run on another agency's flow, or claim a DID another agency is taking calls
 * on.
 *
 * So each check below applies to a principal WITHOUT the platform capability
 * (`isPlatformPrincipal`), and staff behaviour is unchanged.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';

/** NetEnroll staff. Not a role; the capability `api-v1-auth` wrote. */
export function isPlatformPrincipal(request: FastifyRequest): boolean {
  return (request.user as { isPlatformAdmin?: boolean } | undefined)?.isPlatformAdmin === true;
}

/**
 * The tokens of a ring destination that name an extension this tenant does
 * not own.
 *
 * A destination is one number or extension, or several joined by `,` (ring
 * all) or `|` (in turn). A token with ten or more digits is a phone number and
 * belongs to nobody. Anything shorter that is all digits is an extension, and
 * extensions are unique across the whole platform
 * (`AgentSipCredential.extension`), so an extension that is not one of this
 * tenant's agents' is somebody else's -- or nobody's.
 */
export async function extensionsOutsideTenant(
  prisma: Pick<PrismaClient, 'agentSipCredential'>,
  tenantId: string,
  destination: string
): Promise<string[]> {
  const extensions = destination
    .split(/[,|]/)
    .map(token => token.trim())
    .filter(token => /^\d+$/.test(token) && token.length < 10);
  if (extensions.length === 0) return [];

  const owned = await prisma.agentSipCredential.findMany({
    where: { tenantId, extension: { in: extensions } },
    select: { extension: true },
  });
  const mine = new Set(owned.map(row => row.extension));
  return [...new Set(extensions.filter(extension => !mine.has(extension)))];
}

/**
 * Whether another tenant has an ACTIVE route for this DID.
 *
 * `DidRoute` is unique per (tenant, DID) only, and the dialplan's lookup takes
 * the first ACTIVE route for a DID without asking whose it is. Two agencies
 * active on one DID means the call goes to whichever the database returns.
 */
export async function didActiveElsewhere(
  prisma: Pick<PrismaClient, 'didRoute'>,
  tenantId: string,
  did: string
): Promise<boolean> {
  const other = await prisma.didRoute.findFirst({
    where: { did, status: 'ACTIVE', tenantId: { not: tenantId } },
    select: { id: true },
  });
  return other !== null;
}
