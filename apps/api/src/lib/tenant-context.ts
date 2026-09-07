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
 * `resolveTenant(request, reply)` sends the 401 itself and returns `null`; it
 * suits the `if (!tenantId) return reply.code(401)` shape the route handlers
 * already use.
 *
 * `getActingTenantId(request)` just answers the question, returning `null` when
 * there is no answer. Use it when the absence of a tenant is a legitimate state
 * you are about to handle — not as a way to skip the check.
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
}

type MaybeAuthenticatedRequest = FastifyRequest & { user?: AuthenticatedPrincipal };

/** The error code and message every tenant-less request is answered with. */
export const TENANT_REQUIRED = {
  code: 'UNAUTHORIZED',
  message: 'Authentication required',
} as const;

/**
 * Raised when a request cannot be attributed to a tenant.
 *
 * It is deliberately not a "not found" or a silent empty result: a request with
 * no tenant is a request we cannot safely answer, and saying so is the whole
 * point. `statusCode` is 401 because the fix is always to authenticate as
 * somebody, never to ask again for the same thing.
 */
export class TenantResolutionError extends Error {
  readonly statusCode = 401;
  readonly code = TENANT_REQUIRED.code;

  constructor(message: string = TENANT_REQUIRED.message) {
    super(message);
    this.name = 'TenantResolutionError';
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
    throw new TenantResolutionError();
  }
  return tenantId;
}

/**
 * The acting tenant, or `null` after sending a 401 on the caller's behalf.
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
    void reply.code(401).send({ error: TENANT_REQUIRED });
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
