/**
 * Who may look at, and who may resolve, an uncertain attempt.
 *
 * ── Why resolving needs more than viewing ────────────────────────────────────
 *
 * Viewing the queue tells you a lead is held. Resolving it can return that lead
 * to the dialable pool, which — once origination is separately enabled — means a
 * second telephone call to somebody who may already have received one. Those are
 * not the same permission, so `ANALYST` may read the queue and may not act on it,
 * and an API key needs a scope it cannot have acquired by accident.
 *
 * Deny by default, both times: an unknown role matches nothing and an absent
 * scope list is empty rather than permissive.
 */

import {
  DIALER_V2_VIEW_ROLES,
  type VerifiedAuthContext,
} from './dialer-v2-auth.js';

/** Roles permitted to read the manual-review queue. Same as the supervisor view. */
export const RECONCILIATION_VIEW_ROLES: readonly string[] = DIALER_V2_VIEW_ROLES;

/**
 * Roles permitted to resolve an attempt.
 *
 * `ANALYST` is deliberately absent. An analyst reads dialer data; deciding that
 * a possibly-live call is over is an operational act with a telephone
 * consequence.
 */
export const RECONCILIATION_RESOLVE_ROLES: readonly string[] = Object.freeze(['OWNER', 'ADMIN']);

export const RECONCILIATION_READ_SCOPE = 'dialer-v2:reconciliation:read';

/**
 * The scope an API key needs to resolve.
 *
 * Distinct from the read scope and from `dialer-v2:read`, so an existing
 * integration key cannot gain the ability to release held leads by inheriting a
 * broader permission somebody granted for reporting.
 */
export const RECONCILIATION_RESOLVE_SCOPE = 'dialer-v2:reconciliation:resolve';

function hasScope(context: VerifiedAuthContext, scope: string): boolean {
  return (context.scopes ?? []).includes(scope);
}

export function mayViewReconciliationQueue(context: VerifiedAuthContext): boolean {
  if (context.source === 'jwt') {
    return context.roles.some(role => RECONCILIATION_VIEW_ROLES.includes(role));
  }
  return hasScope(context, RECONCILIATION_READ_SCOPE);
}

export function mayResolveAttempt(context: VerifiedAuthContext): boolean {
  if (context.source === 'jwt') {
    return context.roles.some(role => RECONCILIATION_RESOLVE_ROLES.includes(role));
  }
  return hasScope(context, RECONCILIATION_RESOLVE_SCOPE);
}

/**
 * The identity recorded against a resolution.
 *
 * An API key has no user, and attributing its action to a person would be a
 * false audit entry. It is recorded as the key it is, by id, and the resolution
 * log carries no email or token either way.
 */
export function actorFor(context: VerifiedAuthContext): { actorId: string; actorLabel: string } {
  if (context.source === 'jwt' && context.userId) {
    return { actorId: context.userId, actorLabel: `user:${context.userId}` };
  }
  return { actorId: `api-key:${context.tenantId}`, actorLabel: 'api key' };
}
