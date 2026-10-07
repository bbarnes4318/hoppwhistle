/**
 * May this request act on this CRM customer (an `InsuranceLead`)?
 *
 * One answer for every route that hangs something off a customer -- the
 * record itself, its tasks, an application written from the CRM, and the
 * quotes run for them -- so "can this agent see Jane Smith" never has two
 * implementations that drift apart.
 *
 * Two questions, both of which must answer yes:
 *
 *   - Ownership (`lib/agent-scope.ts`): an agency principal reaches the
 *     agency's book; an agent reaches the customers assigned to them. The
 *     lookup is tenant-scoped, so another agency's id is simply not found.
 *   - License (`lib/licensed-states.ts`): a state-restricted agent may not
 *     work a customer whose state is outside their license.
 *
 * The two refusals are deliberately different. A customer the caller does not
 * hold is `not_found` -- indistinguishable from one that does not exist, so an
 * agent walking ids learns nothing. A customer they DO hold but are not
 * licensed for is `unlicensed`: its existence is no secret from the person it
 * is assigned to.
 */

import type { FastifyRequest } from 'fastify';

import { mayReachOwnedRow } from './agent-scope.js';
import { permits, resolveStateAuthority } from './licensed-states.js';
import { getPrismaClient } from './prisma.js';

export interface ReachableLead {
  id: string;
  assignedToId: string | null;
  state: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
}

export type LeadAccess =
  | { ok: true; lead: ReachableLead }
  | { ok: false; reason: 'not_found' | 'unlicensed' };

/** The customer, when this request may act on it; otherwise why not. */
export async function findReachableLead(
  request: FastifyRequest,
  tenantId: string,
  leadId: string
): Promise<LeadAccess> {
  const lead = await getPrismaClient().insuranceLead.findFirst({
    where: { id: leadId, tenantId },
    select: {
      id: true,
      assignedToId: true,
      state: true,
      firstName: true,
      lastName: true,
      fullName: true,
    },
  });
  if (!lead || !mayReachOwnedRow(request, lead.assignedToId)) {
    return { ok: false, reason: 'not_found' };
  }
  const authority = await resolveStateAuthority(request, tenantId);
  if (!permits(authority, lead.state)) return { ok: false, reason: 'unlicensed' };
  return { ok: true, lead };
}

/** "Jane Smith", for a quote's prospect name and an activity line. */
export function leadName(
  lead: Pick<ReachableLead, 'firstName' | 'lastName' | 'fullName'>
): string | null {
  return (
    lead.fullName?.trim() ||
    [lead.firstName, lead.lastName]
      .map(part => part?.trim())
      .filter(Boolean)
      .join(' ') ||
    null
  );
}
