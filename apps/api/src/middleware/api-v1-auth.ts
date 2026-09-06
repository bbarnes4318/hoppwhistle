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

import { FastifyInstance } from 'fastify';

import { isDemoTenantAuthEnabled, warnIfDemoTenantAuthEnabled } from '../lib/demo-auth.js';
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

    // Try JWT first
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        await request.jwtVerify();
        return;
      } catch {
        // JWT failed, try API key / demo tenant fallback
      }
    } else if (queryToken) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const decoded = server.jwt.verify(queryToken);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        request.user = decoded as any;
        return;
      } catch {
        // JWT failed, try API key / demo tenant fallback
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
