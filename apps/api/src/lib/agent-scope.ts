/**
 * Whose rows a request may see, inside one agency.
 *
 * ── The second dimension ─────────────────────────────────────────────────────
 *
 * `lib/tenant-context.ts` answers "which agency is this request acting as", and
 * that boundary is between customers: it is absolute and it is enforced on
 * every query. This answers a different question inside that boundary -- "which
 * of this agency's rows belong to the person asking" -- and it is a narrowing,
 * not a wall. An agency principal sees the agency; an agent sees their own
 * work.
 *
 * The two must not be confused. Tenant scope is never optional and never
 * decided by a role. Agent scope is decided by role, applies only to resources
 * that HAVE an owner, and is always applied on top of a tenant filter, never
 * instead of one.
 *
 * ── Why this is an overwrite, never a check ──────────────────────────────────
 *
 * Every function here derives the owner id from the authenticated principal and
 * discards whatever the request said. A handler that instead validated a
 * client-supplied `agentId` -- "is this id allowed?" -- has to get the
 * comparison right at every call site, and gets it wrong once. Overwriting has
 * no comparison to get wrong: there is no value a caller can put in a query
 * string or a body that widens what comes back.
 *
 * ── The impossible id ────────────────────────────────────────────────────────
 *
 * A principal with no user id -- an API key, a machine token -- is narrowed to
 * `NO_OWNER`, a string no row can carry. It comes back with nothing rather than
 * with the agency, because "this caller owns no rows" is the honest answer for
 * a credential that is not a person, and an empty filter would have been the
 * agency's entire book.
 */

import { FastifyRequest } from 'fastify';

/**
 * The roles that see an agency's whole book.
 *
 * Not a capability check. `billing:read` says an agent may open a billing view;
 * this says whose figures are in it, and that is a question about standing in
 * the agency rather than about a verb on a resource.
 *
 * A platform operator inside an agency carries both of these (see
 * ACTING_TENANT_ROLES), so they see what the agency's principal sees, which is
 * the point of entering. An operator PREVIEWING as AGENT carries exactly
 * ['AGENT'] and is narrowed like one -- to their own user id, which owns
 * nothing in that agency. That is the honest rendering of "what does an agent
 * see": a preview that showed them the agency's book would be showing them the
 * screen they already had.
 */
export const AGENCY_PRINCIPAL_ROLES = ['ADMIN', 'OWNER'] as const;

/**
 * An owner id no row can have.
 *
 * A space rather than an empty string: `where: { assignedToId: '' }` is a
 * filter Prisma will happily run, and an empty string is also what several
 * undefined-ish values coerce to, so a bug that produced one would read as a
 * deliberate "no rows" instead of as a mistake.
 */
export const NO_OWNER = ' ';

interface ScopedPrincipal {
  userId?: string;
  roles?: string[];
}

function principalOf(request: FastifyRequest): ScopedPrincipal | undefined {
  return (request as FastifyRequest & { user?: ScopedPrincipal }).user;
}

/** Whether this request sees the whole agency rather than one person's rows. */
export function isAgencyPrincipal(request: FastifyRequest): boolean {
  const roles = principalOf(request)?.roles ?? [];
  return roles.some(role => (AGENCY_PRINCIPAL_ROLES as readonly string[]).includes(role));
}

/**
 * The owner id to filter on, or `null` for a principal who sees the agency.
 *
 * The shape is deliberately "null means do not narrow" rather than "undefined
 * means do not narrow": a caller that forgets to handle the case gets a filter
 * on `null`, which matches only unassigned rows, rather than a filter that
 * silently disappears and returns the agency.
 *
 *     const ownerId = agentScopeFor(request);
 *     where: { tenantId, ...(ownerId ? { assignedToId: ownerId } : {}) }
 */
export function agentScopeFor(request: FastifyRequest): string | null {
  if (isAgencyPrincipal(request)) return null;
  return principalOf(request)?.userId ?? NO_OWNER;
}

/**
 * Whether this request may reach a row owned by `ownerId`.
 *
 * For the by-id routes, where the row is fetched (tenant-scoped) and then has
 * to be allowed or refused. An agency principal may reach any row in the
 * agency; everyone else may reach the rows they own.
 *
 * An unassigned row -- `ownerId` null -- is the agency's, not nobody's, so an
 * agent may not reach it. A lead nobody has picked up is still the agency's
 * lead, and letting every agent read the unassigned pile would be most of the
 * book.
 */
export function mayReachOwnedRow(request: FastifyRequest, ownerId: string | null): boolean {
  if (isAgencyPrincipal(request)) return true;
  const userId = principalOf(request)?.userId;
  return !!userId && !!ownerId && ownerId === userId;
}
