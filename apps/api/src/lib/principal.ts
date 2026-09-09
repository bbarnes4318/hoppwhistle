/**
 * Where a request's roles and publisher/buyer links come from.
 *
 * ── The defect this exists for ───────────────────────────────────────────────
 *
 * `request.user` on a /api/v1 route was the JWT payload verbatim, and the three
 * `reply.jwtSign(...)` sites in `routes/auth.ts` mint exactly
 * `{ tenantId, userId, email }` -- no `roles`, no `publisherId`. Every check
 * written as `user.roles.includes('PUBLISHER')` therefore read `[]`, and
 * `requirePublisherAccess()` returned false for every publisher on every route
 * that called it: the publisher dashboard, earnings, API keys and integration
 * docs all answered 403, for everyone, always.
 *
 * ── Why resolution and not a bigger token ────────────────────────────────────
 *
 * Putting `roles` and `publisherId` in the token is the cheaper read, but it
 * makes a 7-day bearer token carry authorization state: revoking a role, or
 * moving a user off a publisher, would not take effect until it expired, and
 * every sign site (plus any future refresh path) would have to agree on the
 * claim set forever. Authorization that cannot be revoked is not authorization.
 *
 * So the token says only WHO is asking, and this says what they may do. It is
 * the same decision `lib/dialer-v2-auth.ts` already made for the same reason,
 * and the same one `middleware/auth.ts` and `routes/index.ts#getUserProfile`
 * make by hand -- this is the single definition those now share.
 *
 * The cost is one indexed lookup per authenticated request, joined to
 * `user_roles`, on the primary key of a row the request is about to read
 * anyway. `loadPlatformContext()` beside it already spends one.
 */

import { getPrismaClient } from './prisma.js';

/** What a principal is allowed to be, resolved from the database. */
export interface PrincipalAuthorization {
  /** `UserRole` rows, by role name. Never the token's `roles` claim. */
  roles: string[];
  /** `User.publisherId`, falling back to the legacy `metadata.publisherId`. */
  publisherId: string | null;
  buyerId: string | null;
}

/** A principal with no grants: what an unknown user resolves to. */
export const NO_AUTHORIZATION: PrincipalAuthorization = {
  roles: [],
  publisherId: null,
  buyerId: null,
};

/**
 * The shape this reads out of a `User`. Structural rather than a Prisma type so
 * that a caller which already loaded the row for its own reasons -- as
 * `authenticateJWT` does, to check status and tenant -- can hand it straight
 * over instead of querying twice.
 */
export interface UserAuthorizationRecord {
  buyerId: string | null;
  publisherId: string | null;
  metadata: unknown;
  roles: Array<{ role: { name: string } }>;
}

/** Derive a principal's grants from a loaded `User` row. One definition. */
export function authorizationFromUser(user: UserAuthorizationRecord): PrincipalAuthorization {
  const legacyPublisherId = (user.metadata as { publisherId?: string } | null)?.publisherId ?? null;

  return {
    roles: user.roles.map(userRole => userRole.role.name),
    publisherId: user.publisherId || legacyPublisherId || null,
    buyerId: user.buyerId || null,
  };
}

/**
 * Load a user's grants.
 *
 * A user id that does not resolve gets `NO_AUTHORIZATION` -- no roles, no
 * publisher -- which every check in the codebase reads as "denied". A database
 * failure is NOT caught here: it propagates, because answering the request with
 * an empty role set would look to the caller like a revoked role rather than an
 * outage, and would hand a publisher the same silent 403 this file exists to
 * remove.
 */
export async function loadUserAuthorization(userId: string): Promise<PrincipalAuthorization> {
  const prisma = getPrismaClient();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      buyerId: true,
      publisherId: true,
      metadata: true,
      roles: { select: { role: { select: { name: true } } } },
    },
  });

  if (!user) return NO_AUTHORIZATION;

  return authorizationFromUser(user);
}

/** The fields this writes onto `request.user`. */
export interface HydratablePrincipal {
  userId?: string;
  roles?: string[];
  publisherId?: string | null;
  buyerId?: string | null;
}

/**
 * Attach a principal's resolved grants to it, in place.
 *
 * The database REPLACES whatever the token said rather than merging with it.
 * Some tokens this codebase signs itself do carry a `roles` claim -- the
 * recording-URL token in `routes/index.ts` is one -- and a claim is a snapshot
 * of a grant at signing time, not the grant. Merging would let the older of the
 * two win.
 *
 * A principal with no `userId` (an API-key or machine token) is left alone:
 * there is no user row to resolve it against.
 */
export async function hydratePrincipal(principal: HydratablePrincipal | undefined): Promise<void> {
  if (!principal?.userId) return;

  const authorization = await loadUserAuthorization(principal.userId);

  principal.roles = authorization.roles;
  principal.publisherId = authorization.publisherId;
  principal.buyerId = authorization.buyerId;
}
