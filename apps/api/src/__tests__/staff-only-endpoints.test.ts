import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  isStaffOnlyEndpoint,
  RUNTIME_EXEMPT_PATHS,
  STAFF_ONLY_AREAS,
  STAFF_ONLY_ROUTES,
} from '../lib/staff-only-endpoints.js';
import { registerStaffOnly, STAFF_ONLY } from '../middleware/staff-only.js';

/**
 * The server half of the agency-portal removal.
 *
 * PR #123 removed twelve screens from the agency portal and stated that it was
 * a navigation boundary, not an authorization one -- the endpoints behind them
 * stayed open, so an OWNER with a session token could still create a campaign
 * with curl. This covers the hook that closed that.
 *
 * Two halves, because two different things can be wrong. `isStaffOnlyEndpoint`
 * is a pure decision over (method, path) and is tested exhaustively, including
 * every near-miss that a careless prefix would swallow. The hook is then
 * exercised on a real Fastify instance for the part the pure function cannot
 * answer: who gets refused, with what status, and who is let through.
 */

describe('isStaffOnlyEndpoint: areas closed to an agency', () => {
  it.each([
    ['GET', '/api/v1/carrier-routing/overview'],
    ['POST', '/api/v1/carrier-routing/gateways/abc/reset-health'],
    ['GET', '/api/v1/flows'],
    ['POST', '/api/v1/flows/validate'],
    ['GET', '/api/v1/aivoice/assistants'],
    ['GET', '/api/v1/fish/voices'],
    ['POST', '/api/v1/recording-analysis/upload'],
    ['GET', '/api/v1/industry-research/runs'],
    ['POST', '/api/v1/music-console/voice/launch'],
    ['GET', '/api/v1/numbers'],
    ['DELETE', '/api/v1/numbers/abc'],
    ['GET', '/api/v1/did-routes'],
    ['POST', '/api/v1/anveo/purchase'],
    ['POST', '/api/v1/bulkvs/purchase'],
    ['GET', '/api/v1/fractel/available'],
  ])('%s %s is staff-only', (method, path) => {
    expect(isStaffOnlyEndpoint(method, path)).toBe(true);
  });
});

/**
 * The reason the marketplace collections are not simply closed.
 *
 * Four screens an agency KEEPS read them: the Calls ledger builds its campaign,
 * publisher and buyer filters from these three lists, Reports fills a campaign
 * dropdown, and Billing reads upfront buyers and one buyer's transactions.
 * Closing the reads would break all four, so if these ever start answering 403
 * the removal has gone further than it was meant to.
 */
describe('the marketplace reads that kept screens depend on', () => {
  it.each([
    ['/api/v1/campaigns', 'the Calls ledger filter and the Reports dropdown'],
    ['/api/v1/campaigns/abc', 'a campaign name on a call row'],
    ['/api/v1/publishers', 'the Calls ledger filter'],
    ['/api/v1/buyers', 'the Calls ledger filter and Billing'],
    ['/api/v1/buyers/abc/transactions', 'Billing'],
    ['/api/v1/buyers/upfront-balances', 'Billing'],
  ])('GET %s stays open (%s)', path => {
    expect(isStaffOnlyEndpoint('GET', path)).toBe(false);
  });
});

describe('the marketplace writes that are staff-only', () => {
  it.each([
    ['POST', '/api/v1/campaigns'],
    ['PATCH', '/api/v1/campaigns/abc'],
    ['DELETE', '/api/v1/campaigns/abc'],
    ['POST', '/api/v1/campaigns/abc/duplicate'],
    ['POST', '/api/v1/campaigns/abc/publishers'],
    ['DELETE', '/api/v1/campaigns/abc/buyers/def'],
    ['POST', '/api/v1/publishers'],
    ['PATCH', '/api/v1/publishers/abc'],
    ['DELETE', '/api/v1/publishers/abc'],
    ['POST', '/api/v1/buyers'],
    ['PATCH', '/api/v1/buyers/abc'],
    ['POST', '/api/v1/buyers/abc/credits'],
  ])('%s %s is staff-only', (method, path) => {
    expect(isStaffOnlyEndpoint(method, path)).toBe(true);
  });
});

/**
 * The publisher and buyer portals are separate products for separate roles, and
 * they write under the same two prefixes. Each already scopes itself to the
 * party that owns the record (`requirePublisherAccess`, `checkBuyerAccess`), so
 * these must pass through untouched -- a blanket "writes under /publishers and
 * /buyers are staff's" would have signed every publisher out of its own API
 * keys and frozen every buyer's targeting.
 */
describe('the portals keep writing to their own records', () => {
  it.each([
    ['POST', '/api/v1/publishers/abc/keys'],
    ['DELETE', '/api/v1/publishers/abc/keys/def'],
    ['GET', '/api/v1/publishers/abc/stats'],
    ['GET', '/api/v1/publishers/abc/payouts'],
    ['GET', '/api/v1/publishers/abc/docs'],
    ['POST', '/api/v1/buyers/abc/targets'],
    ['PATCH', '/api/v1/buyers/abc/targets/def'],
    ['DELETE', '/api/v1/buyers/abc/targets/def'],
    ['GET', '/api/v1/buyers/abc/live-status'],
  ])('%s %s is not staff-only', (method, path) => {
    expect(isStaffOnlyEndpoint(method, path)).toBe(false);
  });
});

/**
 * Refusing one of these stops calls being routed. They carry no operator
 * session, they sit under prefixes this table otherwise closes, and the
 * exemption is checked before anything else.
 */
describe('telephony keeps its runtime paths', () => {
  it.each([
    ['POST', '/api/v1/numbers/lookup'],
    ['POST', '/api/v1/flows/execute'],
    ['POST', '/api/v1/flows/events'],
  ])('%s %s is never refused', (method, path) => {
    expect(isStaffOnlyEndpoint(method, path)).toBe(false);
  });

  it('exempts them even though their areas are closed', () => {
    for (const path of RUNTIME_EXEMPT_PATHS) {
      const area = STAFF_ONLY_AREAS.find(a => path.startsWith(`${a.prefix}/`));
      expect(
        area,
        `${path} is not under a closed area, so its exemption is dead weight`
      ).toBeDefined();
    }
  });
});

/**
 * The near-misses. Each shares a prefix with a closed area and belongs to
 * something else entirely; an unanchored `startsWith` or an `includes` would
 * take them all.
 */
describe('prefixes match whole segments', () => {
  it.each([
    ['GET', '/api/v1/freeswitch/carrier-route', 'the switch asking where to send a call'],
    ['POST', '/api/v1/freeswitch/carrier-result', 'the switch reporting the outcome'],
    ['GET', '/api/v1/flowsomething', 'not /flows'],
    ['GET', '/api/v1/numbersearch', 'not /numbers'],
    ['GET', '/api/v1/ai-campaigns', 'not /campaigns'],
    ['POST', '/api/v1/ai-campaigns', 'not /campaigns'],
    ['GET', '/api/v1/insurance-leads', 'the CRM an agency keeps'],
    ['POST', '/api/v1/applications', 'the business an agency writes'],
    ['GET', '/api/v1/delivery/me', "an agent's own day"],
  ])('%s %s is not staff-only (%s)', (method, path) => {
    expect(isStaffOnlyEndpoint(method, path)).toBe(false);
  });
});

describe('isStaffOnlyEndpoint input handling', () => {
  it('ignores a query string and a trailing slash', () => {
    expect(isStaffOnlyEndpoint('GET', '/api/v1/numbers?limit=500')).toBe(true);
    expect(isStaffOnlyEndpoint('GET', '/api/v1/numbers/')).toBe(true);
    expect(isStaffOnlyEndpoint('POST', '/api/v1/numbers/lookup?x=1')).toBe(false);
  });

  it('is not case-sensitive about the method', () => {
    expect(isStaffOnlyEndpoint('post', '/api/v1/campaigns')).toBe(true);
  });

  // Deciding to refuse on a value we do not have is the wrong direction.
  it('answers false for nothing at all', () => {
    expect(isStaffOnlyEndpoint(undefined, '/api/v1/campaigns')).toBe(false);
    expect(isStaffOnlyEndpoint('POST', undefined)).toBe(false);
    expect(isStaffOnlyEndpoint('POST', '')).toBe(false);
  });

  it('declares no route pattern that a prefix already covers', () => {
    for (const route of STAFF_ONLY_ROUTES) {
      const covered = STAFF_ONLY_AREAS.some(
        area =>
          (route.pattern === area.prefix || route.pattern.startsWith(`${area.prefix}/`)) &&
          (!area.methods || route.methods.every(m => area.methods!.includes(m)))
      );
      expect(covered, `${route.pattern} is already closed by an area rule`).toBe(false);
    }
  });
});

/**
 * The hook, on a real instance. The pure function above cannot say who is
 * refused; this can.
 */
describe('the staff-only hook', () => {
  let app: FastifyInstance;
  let principal: Record<string, unknown> | undefined;

  beforeEach(async () => {
    app = Fastify();
    principal = undefined;

    // Stands in for registerApiV1Auth, which this hook is registered after and
    // depends on only for `request.user`.
    app.addHook('onRequest', async request => {
      if (principal) (request as { user?: unknown }).user = principal;
      await Promise.resolve();
    });
    registerStaffOnly(app);

    app.post('/api/v1/campaigns', () => Promise.resolve({ created: true }));
    app.get('/api/v1/campaigns', () => Promise.resolve({ data: [] }));
    app.post('/api/v1/numbers/lookup', () => Promise.resolve({ flowId: 'simple' }));
    app.post('/api/v1/buyers/abc/targets', () => Promise.resolve({ ok: true }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('refuses an agency principal with 403 and a named code', async () => {
    principal = { userId: 'u1', tenantId: 't1', roles: ['OWNER', 'ADMIN'] };
    const res = await app.inject({ method: 'POST', url: '/api/v1/campaigns' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: STAFF_ONLY.code, message: STAFF_ONLY.message } });
  });

  it('refuses an agency API key the same way', async () => {
    principal = { apiKeyId: 'k1', tenantId: 't1' };
    const res = await app.inject({ method: 'POST', url: '/api/v1/campaigns' });
    expect(res.statusCode).toBe(403);
  });

  // The capability, not a role. OWNER is the role every agency principal holds,
  // and it is exactly the one this boundary exists to stop.
  it('lets NetEnroll staff through', async () => {
    principal = { userId: 'u2', tenantId: 't1', roles: [], isPlatformAdmin: true };
    const res = await app.inject({ method: 'POST', url: '/api/v1/campaigns' });
    expect(res.statusCode).toBe(200);
  });

  it('leaves the read an agency still needs alone', async () => {
    principal = { userId: 'u1', tenantId: 't1', roles: ['OWNER'] };
    const res = await app.inject({ method: 'GET', url: '/api/v1/campaigns' });
    expect(res.statusCode).toBe(200);
  });

  it("does not touch a buyer's own targets", async () => {
    principal = { userId: 'u3', tenantId: 't1', roles: ['BUYER'] };
    const res = await app.inject({ method: 'POST', url: '/api/v1/buyers/abc/targets' });
    expect(res.statusCode).toBe(200);
  });

  // The dialplan has no session. Refusing it stops calls.
  it('lets the unauthenticated telephony lookup through', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/numbers/lookup' });
    expect(res.statusCode).toBe(200);
  });

  /*
   * An anonymous caller is left to the refusal it already gets. Every handler
   * behind these paths resolves an acting tenant and turns away a caller who
   * has none; answering 403 here instead would tell an unauthenticated caller
   * the path exists.
   */
  it('does not convert an anonymous request into a 403', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/campaigns' });
    expect(res.statusCode).not.toBe(403);
  });
});
