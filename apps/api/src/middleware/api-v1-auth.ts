/**
 * The authentication hook for every /api/v1/* route.
 *
 * Extracted from buildServer() so it can be exercised by tests. It is the only
 * thing standing between an anonymous request and the whole v1 surface, and
 * while it lived inline in a 400-line server bootstrap the only way to test it
 * was to boot the entire application -- FreeSWITCH sockets, ClickHouse, Redis
 * and all -- which is why the suite that was supposed to cover it tested the
 * ORM instead.
 *
 * Nothing about the behaviour changed in the move. `registerApiV1Auth(server)`
 * is called from buildServer() exactly where the inline hook used to sit, and
 * the security tests register it on a bare Fastify instance alongside the route
 * plugin under test, so they assert against this implementation rather than a
 * reimplementation of it that could drift.
 */

import { createHash } from 'crypto';

import { FastifyInstance, FastifyRequest } from 'fastify';

import { isDemoTenantAuthEnabled, warnIfDemoTenantAuthEnabled } from '../lib/demo-auth.js';
import { loadPlatformContext } from '../lib/platform-admin.js';
import { hydratePrincipal } from '../lib/principal.js';
import { getPrismaClient } from '../lib/prisma.js';

export function registerApiV1Auth(server: FastifyInstance): void {
  // Global API key authentication for /api/v1/* routes

  // One source for this policy -- see lib/demo-auth.ts. It used to be decided
  // here and again inside the automation routes' own tenant resolver, and the
  // two drifted: gating this one left /api/automation/* accepting the header.
  const DEMO_TENANT_AUTH_ENABLED = isDemoTenantAuthEnabled();
  warnIfDemoTenantAuthEnabled();

  server.addHook('onRequest', async (request, _reply) => {
    // With demo auth disabled the demo inputs carry no meaning anywhere, so
    // drop them before anything else looks at them.
    //
    // This runs for EVERY request, ahead of the /api/v1 gate below. It used to
    // sit after it, which meant the routes registered outside /api/v1 -- the
    // /api/automation/* aliases, /api/bot/*, the retention and call-center
    // handlers -- still received the header and still read it. Stripping it
    // here makes every reader in the codebase fall back to the tenant the
    // caller actually authenticated as, whether or not it was ever converted
    // to `requireTenantId`.
    //
    // It also has to happen before the JWT branch further down, which returns
    // as soon as a token verifies: a request that authenticated perfectly well
    // as one tenant could otherwise still name another and be served its data.
    if (!DEMO_TENANT_AUTH_ENABLED) {
      delete request.headers['x-demo-tenant-id'];
      const query = request.query as { demoTenantId?: string } | undefined;
      if (query && query.demoTenantId !== undefined) {
        delete query.demoTenantId;
      }
    }

    // Only authenticate /api/v1/* routes
    if (!request.url.startsWith('/api/v1/')) {
      return;
    }

    const authHeader = request.headers.authorization;
    const queryToken = (request.query as { token?: string } | undefined)?.token;

    // Try JWT first.
    //
    // `resolvePrincipal` deliberately sits OUTSIDE these catches. They mean
    // "this token is not valid, try another credential", and a database failure
    // while resolving the caller's roles is not that: swallowing it would serve
    // the request with an empty role set, which reads to a publisher as a
    // revoked role and produces exactly the silent 403 this resolution exists
    // to remove. A resolution failure is a failed request.
    if (authHeader && authHeader.startsWith('Bearer ')) {
      let verified = false;
      try {
        await request.jwtVerify();
        verified = true;
      } catch {
        // JWT failed, try API key / demo tenant fallback
      }

      if (verified) {
        await resolvePrincipal(request);
        return;
      }
    } else if (queryToken) {
      let decoded: unknown;
      let verified = false;
      try {
        decoded = server.jwt.verify(queryToken);
        verified = true;
      } catch {
        // JWT failed, try API key / demo tenant fallback
      }

      if (verified) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        request.user = decoded as any;
        await resolvePrincipal(request);
        return;
      }
    }

    // Demo-tenant fallback, off unless an environment explicitly opts in.
    //
    // This branch used to run unconditionally, and it is an authentication
    // bypass: an `X-Demo-Tenant-Id` header (or ?demoTenantId=) with no
    // credential of any kind was answered as ADMIN and OWNER of the named
    // tenant. `GET /api/v1/users` returned 401 without the header and the full
    // user list with it. Nothing about the caller was ever checked.
    //
    // The demo toggle in the web app is the legitimate user of this, so the
    // path is kept and gated rather than deleted: set ALLOW_DEMO_TENANT_AUTH
    // to 'true' in an environment that is genuinely a demo, and nowhere else.
    if (DEMO_TENANT_AUTH_ENABLED) {
      const demoTenantId =
        (request.headers['x-demo-tenant-id'] as string | undefined) ||
        (request.query as { demoTenantId?: string } | undefined)?.demoTenantId;

      if (demoTenantId) {
        request.user = {
          tenantId: demoTenantId,
          roles: ['ADMIN', 'OWNER'],
        };
        return;
      }
    }

    const apiKey = request.headers['x-api-key'] as string;

    // Try API key
    if (apiKey) {
      try {
        const prisma = getPrismaClient();
        const keyHash = createHash('sha256').update(apiKey).digest('hex');
        const dbApiKey = await prisma.apiKey.findUnique({
          where: { keyHash },
          include: { tenant: true },
        });

        if (
          dbApiKey &&
          dbApiKey.status === 'ACTIVE' &&
          (!dbApiKey.expiresAt || dbApiKey.expiresAt > new Date()) &&
          dbApiKey.tenant.status === 'ACTIVE'
        ) {
          const scopes =
            dbApiKey.scopes && Array.isArray(dbApiKey.scopes) ? (dbApiKey.scopes as string[]) : [];
          request.user = {
            tenantId: dbApiKey.tenantId,
            apiKeyId: dbApiKey.id,
            scopes,
          };

          // Update last used timestamp (don't await)
          void prisma.apiKey
            .update({
              where: { id: dbApiKey.id },
              data: { lastUsedAt: new Date() },
            })
            .catch(() => {});
        }
      } catch {
        // API key auth failed
      }
    }
  });
}

/**
 * Turn a verified token into a principal that can actually be authorized.
 *
 * `request.jwtVerify()` leaves `request.user` as the token payload verbatim,
 * and this platform's login tokens carry `{ tenantId, userId, email }` and
 * nothing else. Every role- and publisher-aware check downstream reads
 * `user.roles` and `user.publisherId`, so without this step they all read
 * undefined: `requirePublisherAccess()` denied every publisher their own
 * dashboard, earnings, API keys and docs, on every route that called it.
 *
 * Resolving here rather than at each call site means one place decides what a
 * request may do, and a role revoked in the database takes effect on the next
 * request instead of when a 7-day token expires. See `lib/principal.ts`.
 *
 * Order matters: the database grants land first, then the acting-tenant roles
 * are merged on top of them, so a platform operator inside an agency keeps both
 * their own roles and the agency's.
 */
async function resolvePrincipal(request: FastifyRequest): Promise<void> {
  await hydratePrincipal(request.user);
  await applyPlatformContext(request);
}

/**
 * Overlay NetEnroll staff state onto a principal this hook just built from a
 * JWT.
 *
 * The token carries the tenant the operator had at login and knows nothing
 * about the agency they entered afterwards. For platform staff the entered
 * agency REPLACES it: the `PlatformActingTenant` row is the authority, the token only
 * says who is asking, and a stale tenant in a long-lived token must never
 * decide whose data is served.
 *
 * For everyone else this is a no-op beyond one indexed lookup that misses.
 */
async function applyPlatformContext(request: FastifyRequest): Promise<void> {
  const principal = request.user as
    | {
        userId?: string;
        tenantId?: string;
        roles?: string[];
        isPlatformAdmin?: boolean;
        actingTenantId?: string | null;
        actingTenantName?: string | null;
      }
    | undefined;

  if (!principal?.userId) return;

  const platform = await loadPlatformContext(principal.userId);
  if (!platform.isPlatformAdmin) return;

  principal.isPlatformAdmin = true;
  principal.actingTenantId = platform.actingTenantId;
  principal.actingTenantName = platform.actingTenantName;
  principal.tenantId = platform.actingTenantId ?? undefined;

  // Inside an agency, carry that agency's administrator roles; in the
  // cross-agency view, carry none. See ACTING_TENANT_ROLES.
  const existing = principal.roles ?? [];
  principal.roles = [...existing, ...platform.actingRoles.filter(r => !existing.includes(r))];
}
