/**
 * The one place the acting tenant is decided.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * Tenant scoping in this API was enforced per-route. Each route file grew its
 * own `getTenantId()`, and `apps/api/src/routes/index.ts` inlined the same two
 * lines about sixty times:
 *
 *     const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
 *     const tenantId = demoTenantId || user?.tenantId;
 *
 * Sixty copies of a rule is sixty chances to write it differently, and they
 * did differ: three sites fell back to the literal string `'default'`, one of
 * them on `/api/v1/reporting/metrics`, which therefore ran its query for an
 * anonymous caller instead of refusing one. `auth.ts` had a seventh variant
 * that inspected the `Host`, `Referer` and `Origin` headers and, failing those,
 * picked the first active tenant row in the database.
 *
 * Every one of those inputs is attacker-controlled. The acting tenant is not a
 * routing detail; it is the entire boundary between two agencies who must never
 * see each other's callers, applications or money. So it is derived here, from
 * the authenticated principal, and nowhere else.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * The acting tenant comes from `request.user`, which is populated only by an
 * authentication path that verified a credential — a JWT, a session, or an API
 * key. Nothing in this module reads a header, a hostname, a path segment, a
 * query parameter or a request body. A request that cannot produce an
 * authenticated tenant gets an explicit error; it never gets a tenant.
 *
 * `X-Demo-Tenant-Id` deliberately has no reader here. It is stripped from every
 * inbound request by `registerApiV1Auth` unless `ALLOW_DEMO_TENANT_AUTH=true`,
 * and when the bypass *is* on it works by populating `request.user` — so it
 * still arrives through the one door below rather than around it.
 *
 * ── Choosing a function ──────────────────────────────────────────────────────
 *
 * `requireTenantId(request)` throws `TenantResolutionError`; use it in service
 * code and anywhere an exception is already the failure channel.
 *
 * `resolveTenant(request, reply)` sends the refusal itself and returns `null`;
 * it suits the `if (!tenantId) return;` shape the route handlers already use.
 * `sendTenantRefusal(request, reply)` is the same refusal for handlers that
 * return their body rather than calling `reply.send()`.
 *
 * `getActingTenantId(request)` just answers the question, returning `null` when
 * there is no answer. Use it when the absence of a tenant is a legitimate state
 * you are about to handle — not as a way to skip the check.
 *
 * ── Two ways to have no tenant ───────────────────────────────────────────────
 *
 * Phase 1b gave NetEnroll staff a cross-agency view: a platform operator who
 * has entered no agency has no acting tenant, and an agency-scoped route
 * refused them with the same 401 an anonymous caller gets. That is honest about
 * the outcome and wrong about the reason, and it locked the owner out of
 * production: the web client treats 401 as "your session is dead", so it
 * cleared the token and redirected to the login page, which loaded the app,
 * which called an agency-scoped route, which answered 401 again. Six requests
 * in one second, and the only way out was deleting the selection row by hand.
 *
 * So the two conditions are now two answers:
 *
 *   401 UNAUTHORIZED     nobody is authenticated. Sign in.
 *   409 NO_ACTING_TENANT somebody is authenticated, holds the platform
 *                        capability, and has entered no agency. Signing in
 *                        again changes nothing; picking an agency does.
 *
 * This reads `request.user.isPlatformAdmin`, which is set by the authentication
 * middleware from a `PlatformAdmin` row. It is NOT a second way to find a
 * tenant — no branch below can return one, and a platform operator with no
 * selection still gets no tenant and still cannot read agency data. It only
 * decides which refusal to send, and only for a principal the server has
 * already authenticated.
 */

import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * The shape this module cares about. Every authentication path in
 * `middleware/auth.ts` and `middleware/api-v1-auth.ts` writes `request.user`
 * with at least this much.
 */
interface AuthenticatedPrincipal {
  tenantId?: string | null;
  userId?: string;
  apiKeyId?: string;
  roles?: string[];
  scopes?: string[];
  /**
   * Set from a `PlatformAdmin` row by the authentication middleware. Read here
   * only to choose between the two refusals below; it never produces a tenant.
   */
  isPlatformAdmin?: boolean;
}

type MaybeAuthenticatedRequest = FastifyRequest & { user?: AuthenticatedPrincipal };

/** The error code and message an unauthenticated request is answered with. */
export const TENANT_REQUIRED = {
  code: 'UNAUTHORIZED',
  message: 'Authentication required',
} as const;

/**
 * The answer for an authenticated platform operator who has entered no agency.
 *
 * 409 rather than 401 or 403: the caller is authenticated (so not 401) and is
 * permitted to reach this data once they choose an agency (so not 403). What is
 * wrong is the state of their session — they are standing in the cross-agency
 * view asking an agency-scoped question — and 409 is the status for a request
 * that conflicts with the current state rather than with the caller's identity.
 *
 * The code is the part clients switch on. `NO_ACTING_TENANT` means: do not
 * clear the session, do not go to the login page, land on the cross-agency view
 * and ask which agency.
 */
export const NO_ACTING_TENANT = {
  code: 'NO_ACTING_TENANT',
  message: 'Select an agency to view this. You are in the cross-agency view.',
} as const;

/** The two shapes a tenant-less request is refused with. */
export interface TenantRefusal {
  statusCode: 401 | 409;
  error: typeof TENANT_REQUIRED | typeof NO_ACTING_TENANT;
}

/**
 * Which refusal this request has earned.
 *
 * Only ever called when `getActingTenantId()` has already returned null, so it
 * decides nothing about scoping — every branch here is a refusal.
 */
export function describeTenantRefusal(request: FastifyRequest): TenantRefusal {
  const principal = (request as MaybeAuthenticatedRequest).user;

  if (principal?.isPlatformAdmin === true) {
    return { statusCode: 409, error: NO_ACTING_TENANT };
  }

  return { statusCode: 401, error: TENANT_REQUIRED };
}

/**
 * Refuse a tenant-less request, and hand back the body to return.
 *
 * Written for the shape the route handlers already use, where the reply code is
 * set with `void reply.code(...)` and the body is returned from the handler:
 *
 *     const tenantId = getActingTenantId(request);
 *     if (!tenantId) return sendTenantRefusal(request, reply);
 *
 * Before this existed each of those sites hardcoded its own 401, which is how
 * the cross-agency view came to be indistinguishable from a dead session in
 * about ninety places at once.
 */
export function sendTenantRefusal(
  request: FastifyRequest,
  reply: FastifyReply
): { error: { code: string; message: string } } {
  const refusal = describeTenantRefusal(request);
  void reply.code(refusal.statusCode);
  return { error: { code: refusal.error.code, message: refusal.error.message } };
}

/**
 * The same refusal, sent through `reply.send()`.
 *
 * For handlers written as `return reply.code(401).send({ ... })` rather than as
 * `void reply.code(401); return body;`. Both spellings exist in the route files
 * and neither is worth rewriting into the other.
 */
export function replyTenantRefusal(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const refusal = describeTenantRefusal(request);
  return reply.code(refusal.statusCode).send({ error: refusal.error });
}

/**
 * Raised when a request cannot be attributed to a tenant.
 *
 * It is deliberately not a "not found" or a silent empty result: a request with
 * no tenant is a request we cannot safely answer, and saying so is the whole
 * point. `statusCode` is 401 when the fix is to authenticate as somebody, and
 * 409 when the caller is already somebody and the fix is to pick an agency —
 * see `describeTenantRefusal`.
 */
export class TenantResolutionError extends Error {
  readonly statusCode: 401 | 409;
  readonly code: string;

  constructor(refusal: TenantRefusal = { statusCode: 401, error: TENANT_REQUIRED }) {
    super(refusal.error.message);
    this.name = 'TenantResolutionError';
    this.statusCode = refusal.statusCode;
    this.code = refusal.error.code;
  }
}

/**
 * The acting tenant for this request, or `null` if it has none.
 *
 * Reads `request.user.tenantId` and nothing else. A blank or whitespace-only
 * value counts as no tenant rather than as a tenant whose id is the empty
 * string — Prisma is happy to run `where: { tenantId: '' }` and return an empty
 * page, which reads in a test as "correctly isolated" when it actually means
 * "the scoping value was junk".
 */
export function getActingTenantId(request: FastifyRequest): string | null {
  const principal = (request as MaybeAuthenticatedRequest).user;
  const tenantId = principal?.tenantId;

  if (typeof tenantId !== 'string') return null;

  const trimmed = tenantId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The acting tenant for this request, or a thrown `TenantResolutionError`.
 */
export function requireTenantId(request: FastifyRequest): string {
  const tenantId = getActingTenantId(request);
  if (!tenantId) {
    throw new TenantResolutionError(describeTenantRefusal(request));
  }
  return tenantId;
}

/**
 * The acting tenant, or `null` after sending the refusal on the caller's behalf.
 *
 * Written for the handler shape already used throughout the route files:
 *
 *     const tenantId = resolveTenant(request, reply);
 *     if (!tenantId) return;
 *
 * The reply is sent before this returns, so the handler must not send another.
 */
export function resolveTenant(request: FastifyRequest, reply: FastifyReply): string | null {
  const tenantId = getActingTenantId(request);

  if (!tenantId) {
    const refusal = describeTenantRefusal(request);
    void reply.code(refusal.statusCode).send({ error: refusal.error });
    return null;
  }

  return tenantId;
}

/**
 * The authenticated user id, or `null` for an API-key principal.
 *
 * Here rather than in each route because the same `request.user` shape is being
 * read, and because audit rows want the operator alongside the tenant.
 */
export function getActingUserId(request: FastifyRequest): string | null {
  const principal = (request as MaybeAuthenticatedRequest).user;
  return principal?.userId ?? null;
}
