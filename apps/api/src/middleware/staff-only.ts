/**
 * The server half of the agency-portal removal.
 *
 * PR #123 took twelve screens out of an agency principal's portal and said, in
 * the module that drove it, that it was a navigation boundary rather than an
 * authorization one: the screens went, the endpoints behind them did not. An
 * OWNER with a session token could still `POST /api/v1/campaigns`. This hook
 * closes that, from the one table in `lib/staff-only-endpoints.ts` -- which is
 * also where the reasoning about WHICH endpoints lives, including the three
 * telephony paths that must stay open and the two portals that write under the
 * same prefixes.
 *
 * ── Global, and at onRequest ─────────────────────────────────────────────────
 *
 * Registered immediately after `registerApiV1Auth()`, the way
 * `registerReadOnlyPreview` is and for the same two reasons. Hooks in a phase
 * run in registration order, so the /api/v1 principal -- and its
 * `isPlatformAdmin` -- is already built by the time this runs. And refusing at
 * `onRequest` turns a request away before its body is read.
 *
 * Global rather than per-route on purpose. A per-route guard is a promise about
 * the handlers somebody remembered, and this is a surface that gains handlers
 * every phase: the campaign routes it closes had no authorization preHandler of
 * any kind, only an acting-tenant check, which is precisely how they came to be
 * reachable by anyone with a tenant.
 *
 * ── It only turns away someone it can identify ───────────────────────────────
 *
 * No principal means no refusal here. Every handler behind these paths resolves
 * an acting tenant and already turns away a caller who has none, and converting
 * that answer into a 403 would both advertise the path to an anonymous caller
 * and change responses this change has no business changing.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { isStaffOnlyEndpoint, isWhiteLabelAllowed } from '../lib/staff-only-endpoints.js';
import { isWhiteLabelOperator, type WhiteLabelPrincipal } from '../lib/white-label.js';

export const STAFF_ONLY = {
  code: 'STAFF_ONLY',
  message: 'This is a NetEnroll platform screen and is not part of the agency portal.',
} as const;

/**
 * Answer the request if it is not this caller's to make.
 *
 * Returns true when it has answered, so callers can stop. Exported for the
 * authenticator outside /api/v1 to reuse, exactly as `enforceReadOnlyPreview`
 * is, rather than growing a second copy of the decision.
 */
export function enforceStaffOnly(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!isStaffOnlyEndpoint(request.method, request.url)) return false;

  // Unauthenticated: leave it to the refusal it already gets. See the header.
  const principal = request.user as
    | (WhiteLabelPrincipal & { isPlatformAdmin?: boolean })
    | undefined;
  if (!principal) return false;

  // The capability, and only the capability. Not a role: every agency has an
  // OWNER, and the whole point is that an agency's OWNER is not staff.
  if (principal.isPlatformAdmin === true) return false;

  /*
   * The white-label tier: an agency that also sells calls runs its own call
   * network, so its OWNER and ADMIN pass on exactly WHITE_LABEL_ALLOWED. Both
   * halves are needed -- the tier, read from the tenant this principal
   * resolved to, and the role. An AGENT of a white-label agency, and any API
   * key, is refused here like everybody else.
   */
  if (isWhiteLabelOperator(principal) && isWhiteLabelAllowed(request.method, request.url)) {
    return false;
  }

  void reply.code(403).send({ error: STAFF_ONLY });
  return true;
}

export function registerStaffOnly(server: FastifyInstance): void {
  server.addHook('onRequest', async (request, reply) => {
    enforceStaffOnly(request, reply);
  });
}
