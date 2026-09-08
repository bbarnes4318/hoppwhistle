/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * No route may answer a platform admin with no acting tenant with a 401.
 *
 * ── Why this is exhaustive rather than a list ────────────────────────────────
 *
 * Phase 1b: a platform operator who had entered no agency was refused by every
 * agency-scoped route with `401 UNAUTHORIZED` -- the same answer an anonymous
 * caller gets. The web client reads 401 as a dead session, so it cleared the
 * token and navigated to /login, which loaded the app, which called an
 * agency-scoped route, which answered 401. Six requests in one second, and the
 * only way out was deleting a row from the production database by hand.
 *
 * Phase 2 split the two answers -- `409 NO_ACTING_TENANT` means "pick an
 * agency", `401` still means "sign in" -- and converted roughly ninety route
 * sites to the shared helpers in `lib/tenant-context.ts`.
 *
 * It missed some. A production console capture showed
 * `GET /api/v1/agent/webrtc/credentials`, `GET /api/v1/agent/my-numbers` and
 * `PUT /api/v1/agent/status` still answering 401, because `agent-phone.ts` has
 * its own local `requireAgent()` that collapses "no tenant" and "no
 * credential" into one refusal and therefore was never touched by a conversion
 * that worked through the shared helpers.
 *
 * A hand-maintained list of routes to check would have the same failure mode as
 * the conversion did: it only covers what somebody remembered. So this walks
 * the ACTUAL route table of an app registering every plugin the real server
 * registers, and drives each one as a platform admin with no agency selected.
 *
 * A new route that refuses this principal with a 401 fails here on the day it
 * is added, whether or not anybody thought about the login loop.
 *
 * ── What a correct answer looks like ─────────────────────────────────────────
 *
 * Anything except `401`. The specific right answer for an agency-scoped route
 * is `409 NO_ACTING_TENANT`, and that is asserted for the routes known to be
 * agency-scoped. But a platform route answering `200`, a route answering `404`
 * for a made-up id, or a `403` are all fine -- none of them tells the client
 * the session is dead.
 *
 * ── GET only, and why ────────────────────────────────────────────────────────
 *
 * Every GET is swept. Writes are not swept blindly: a route that FAILS this
 * audit is by definition one that did not refuse, so sweeping writes would
 * execute the ones that are broken. The three write routes from the capture are
 * listed explicitly below instead, and any write route can be added there.
 */

const gate = databaseGate();
announceSkip('no route answers a no-acting-tenant platform admin with 401', gate);

const TEST_JWT_SECRET = 'no-acting-tenant-audit-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

/**
 * Routes that are NOT agency-scoped browser surfaces, and are allowed to answer
 * 401 for their own reasons.
 *
 * Each entry needs a reason, because "add it to the skip list" is how an audit
 * like this stops meaning anything.
 */
const NOT_A_BROWSER_SESSION: Array<{ pattern: RegExp; because: string }> = [
  {
    pattern: /^\/api\/v1\/insurance-leads\/inbound\//,
    because: 'API-key ingestion from a partner system. No browser session is involved.',
  },
  {
    pattern: /^\/api\/v1\/prospects\/intake/,
    because: 'API-key ingestion. Same reasoning as the inbound lead endpoint.',
  },
  {
    pattern: /^\/api\/v1\/webhooks\//,
    because: 'Carrier and provider callbacks, authenticated by signature.',
  },
  {
    pattern: /^\/api\/v1\/freeswitch\//,
    because: 'FreeSWITCH internal calls, authenticated by a shared internal key.',
  },
];

/** Write routes from the production capture, swept explicitly. */
const EXPLICIT_WRITES: Array<{ method: 'PUT' | 'POST' | 'DELETE'; url: string; payload?: unknown }> =
  [{ method: 'PUT', url: '/api/v1/agent/status', payload: { status: 'available' } }];

describe('audit suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `audit suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)(
  'no route answers a no-acting-tenant platform admin with 401',
  () => {
    let app: FastifyInstance;
    let operatorToken: string;
    let getRoutes: Array<{ url: string }> = [];

    beforeAll(async () => {
      const prisma = getPrismaClient();

      app = Fastify({ logger: false });
      await app.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
      await app.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
      registerApiV1Auth(app);

      /*
       * Every agency-facing plugin the real server registers. Kept in the same
       * order as `src/index.ts` so a diff between the two is readable; webhook,
       * websocket and mock surfaces are left out because they are not browser
       * routes and several of them bind sockets.
       */
      const routes = await import('../routes/index.js');
      const plugins = [
        routes.registerNumberRoutes,
        routes.registerCampaignRoutes,
        routes.registerPublisherRoutes,
        routes.registerCallRoutes,
        routes.registerUserRoutes,
        routes.registerReportingRoutes,
        routes.registerBillingRoutes,
        routes.registerAdminTenantRoutes,
        (await import('../routes/quotas.js')).registerQuotaRoutes,
        (await import('../routes/platform.js')).registerPlatformRoutes,
        (await import('../routes/rating.js')).registerRatingRoutes,
        (await import('../routes/delivery-billing.js')).registerDeliveryBillingRoutes,
        (await import('../routes/live-metrics.js')).registerLiveMetricsRoutes,
        (await import('../routes/recordings.js')).registerRecordingManagementRoutes,
        (await import('../routes/transcripts.js')).registerTranscriptRoutes,
        (await import('../routes/compliance.js')).registerComplianceRoutes,
        (await import('../routes/recording-analysis.js')).registerRecordingAnalysisRoutes,
        (await import('../routes/agent-phone.js')).registerAgentPhoneRoutes,
        (await import('../routes/call-center.js')).registerCallCenterRoutes,
        (await import('../routes/retention.js')).registerRetentionRoutes,
        (await import('../routes/buyer-billing.js')).registerBuyerBillingRoutes,
        (await import('../routes/payroll.js')).registerPayrollRoutes,
        (await import('../routes/carrier-routing.js')).registerCarrierRoutingRoutes,
        (await import('../routes/insurance-leads.js')).registerInsuranceLeadRoutes,
        (await import('../routes/flows.js')).registerFlowManagementRoutes,
      ];

      // Collected from Fastify's own onRoute hook: the real table, not a list
      // somebody typed.
      const seen: Array<{ url: string; method: string }> = [];
      app.addHook('onRoute', route => {
        const methods = Array.isArray(route.method) ? route.method : [route.method];
        for (const method of methods) seen.push({ url: route.url, method });
      });

      for (const plugin of plugins) {
        await app.register(plugin as never);
      }
      await app.ready();

      getRoutes = seen
        .filter(route => route.method === 'GET')
        .filter(route => route.url.startsWith('/api/'))
        .filter(route => !NOT_A_BROWSER_SESSION.some(skip => skip.pattern.test(route.url)))
        // De-duplicate: several plugins register the same path shape.
        .filter((route, index, all) => all.findIndex(r => r.url === route.url) === index);

      // A platform operator with a capability and NO agency selected.
      const operator = await prisma.user.create({
        data: {
          email: `audit-operator-${Date.now()}@netenroll.test`,
          status: 'ACTIVE',
          tenantId: null,
        },
      });
      await grantPlatformAdmin(operator.id, { note: 'no-acting-tenant audit' });
      operatorToken = app.jwt.sign({
        userId: operator.id,
        tenantId: null,
        email: 'audit@netenroll.test',
      });
    }, 120_000);

    afterAll(async () => {
      await app?.close();
    });

    /** `:id` style segments filled with something syntactically valid. */
    function concrete(url: string): string {
      return url.replace(/:[^/]+/g, '00000000-0000-4000-8000-0000000000aa');
    }

    it('sweeps a meaningful number of routes, so a broken sweep cannot pass silently', () => {
      // An audit that collected nothing would otherwise be a green test that
      // checks nothing at all -- which is the failure mode that let the
      // switcher crash through.
      expect(getRoutes.length).toBeGreaterThan(50);
    });

    it('answers every GET with something other than 401', async () => {
      const offenders: string[] = [];

      for (const route of getRoutes) {
        const response = await app.inject({
          method: 'GET',
          url: concrete(route.url),
          headers: { authorization: `Bearer ${operatorToken}` },
        });

        if (response.statusCode !== 401) continue;

        let code = '(unparseable body)';
        try {
          code = (response.json() as any)?.error?.code ?? '(no code)';
        } catch {
          /* a 401 with a non-JSON body is still a 401 */
        }
        offenders.push(`GET ${route.url} -> 401 ${code}`);
      }

      expect(
        offenders,
        'These answer a platform admin with no agency selected the same way they answer an ' +
          'anonymous caller. The web client reads 401 as a dead session and signs them out, ' +
          'which is the Phase 1b login loop. Use resolveTenant/sendTenantRefusal so the ' +
          'refusal is 409 NO_ACTING_TENANT.\n' +
          offenders.join('\n')
      ).toEqual([]);
    }, 180_000);

    it('answers the write routes from the production capture with something other than 401', async () => {
      const offenders: string[] = [];

      for (const route of EXPLICIT_WRITES) {
        const response = await app.inject({
          method: route.method,
          url: route.url,
          headers: { authorization: `Bearer ${operatorToken}` },
          payload: route.payload as never,
        });
        if (response.statusCode === 401) {
          offenders.push(`${route.method} ${route.url} -> 401`);
        }
      }

      expect(offenders).toEqual([]);
    });

    it('answers the three routes from the capture with 409 NO_ACTING_TENANT specifically', async () => {
      /*
       * The three named in the report. Not just "not 401" -- these are
       * agency-scoped, so the correct answer is the one the client can act on.
       */
      const reported = [
        { method: 'GET' as const, url: '/api/v1/agent/webrtc/credentials' },
        { method: 'GET' as const, url: '/api/v1/agent/my-numbers' },
        { method: 'PUT' as const, url: '/api/v1/agent/status' },
      ];

      for (const route of reported) {
        const response = await app.inject({
          method: route.method,
          url: route.url,
          headers: { authorization: `Bearer ${operatorToken}` },
          payload: route.method === 'PUT' ? ({ status: 'available' } as never) : undefined,
        });

        expect(response.statusCode, `${route.method} ${route.url}`).toBe(409);
        expect((response.json() as any).error.code, `${route.method} ${route.url}`).toBe(
          'NO_ACTING_TENANT'
        );
      }
    });

    it('still answers an anonymous caller with 401, on the same routes', async () => {
      /*
       * The other half. Splitting the two conditions must not have made
       * everything a 409: a caller with no credential at all is not somebody
       * who needs to pick an agency, and the client SHOULD sign them out.
       */
      for (const url of [
        '/api/v1/agent/webrtc/credentials',
        '/api/v1/agent/my-numbers',
        '/api/v1/calls',
      ]) {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode, url).toBe(401);
      }
    });
  }
);
