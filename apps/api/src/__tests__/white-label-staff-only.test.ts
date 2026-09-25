import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isStaffOnlyEndpoint,
  isWhiteLabelAllowed,
  WHITE_LABEL_ALLOWED,
} from '../lib/staff-only-endpoints.js';
import { PREVIEW_READ_ONLY, registerReadOnlyPreview } from '../middleware/read-only-preview.js';
import { registerStaffOnly, STAFF_ONLY } from '../middleware/staff-only.js';

/**
 * The white-label tier's pass through the staff-only boundary.
 *
 * A white-label agency sells calls as well as taking them, so its OWNER and
 * ADMIN run a call network of their own: exactly WHITE_LABEL_ALLOWED, and
 * nothing else under STAFF_ONLY_AREAS. These cases drive the real hook on a
 * real Fastify instance as each kind of principal:
 *
 *   white-label OWNER / ADMIN   every allowed route, and none of the rest
 *   white-label AGENT           refused on all of them
 *   normal agency OWNER         refused on all of them, as before
 *   staff previewing the tier   still refused every write, by the preview
 */

/** One concrete request per WHITE_LABEL_ALLOWED entry, every method it names. */
const ALLOWED_REQUESTS: Array<[string, string]> = [
  ['POST', '/api/v1/campaigns'],
  ['PATCH', '/api/v1/campaigns/camp-1'],
  ['PUT', '/api/v1/campaigns/camp-1'],
  ['DELETE', '/api/v1/campaigns/camp-1'],
  ['POST', '/api/v1/campaigns/camp-1/duplicate'],
  ['POST', '/api/v1/campaigns/camp-1/publishers'],
  ['POST', '/api/v1/campaigns/camp-1/buyers'],
  ['PATCH', '/api/v1/campaigns/camp-1/buyers/assign-1'],
  ['DELETE', '/api/v1/campaigns/camp-1/buyers/assign-1'],
  ['POST', '/api/v1/publishers'],
  ['PATCH', '/api/v1/publishers/pub-1'],
  ['PUT', '/api/v1/publishers/pub-1'],
  ['DELETE', '/api/v1/publishers/pub-1'],
  ['POST', '/api/v1/buyers'],
  ['PATCH', '/api/v1/buyers/buyer-1'],
  ['PUT', '/api/v1/buyers/buyer-1'],
  ['DELETE', '/api/v1/buyers/buyer-1'],
  ['POST', '/api/v1/buyers/buyer-1/credits'],
  ['GET', '/api/v1/numbers'],
  ['GET', '/api/v1/numbers/num-1'],
  ['PATCH', '/api/v1/numbers/num-1'],
  ['PUT', '/api/v1/numbers/num-1'],
  ['GET', '/api/v1/did-routes'],
  ['POST', '/api/v1/did-routes'],
  ['PATCH', '/api/v1/did-routes/route-1'],
  ['DELETE', '/api/v1/did-routes/route-1'],
];

/** Staff-only for everybody, the white-label tier included. */
const STILL_STAFF_ONLY: Array<[string, string]> = [
  ['POST', '/api/v1/numbers'],
  ['POST', '/api/v1/numbers/existing'],
  ['DELETE', '/api/v1/numbers/num-1'],
  ['GET', '/api/v1/flows'],
  ['POST', '/api/v1/flows'],
  ['GET', '/api/v1/carrier-routing/overview'],
  ['POST', '/api/v1/carrier-routing/gateways'],
  ['GET', '/api/v1/aivoice/assistants'],
  ['POST', '/api/v1/aivoice/session'],
  ['GET', '/api/v1/fish/voices'],
  ['POST', '/api/v1/anveo/purchase'],
  ['POST', '/api/v1/anveo/sync'],
  ['POST', '/api/v1/bulkvs/purchase'],
  ['GET', '/api/v1/fractel/available'],
  ['POST', '/api/v1/recording-analysis/upload'],
  ['GET', '/api/v1/industry-research/runs'],
  ['POST', '/api/v1/music-console/voice/launch'],
];

describe('WHITE_LABEL_ALLOWED: the list, exactly', () => {
  it('is the nine rules asked for, in order', () => {
    expect(WHITE_LABEL_ALLOWED).toEqual([
      { prefix: '/api/v1/campaigns', methods: ['POST', 'PUT', 'PATCH', 'DELETE'] },
      { pattern: '/api/v1/publishers', methods: ['POST'] },
      { pattern: '/api/v1/publishers/:publisherId', methods: ['PATCH', 'PUT', 'DELETE'] },
      { pattern: '/api/v1/buyers', methods: ['POST'] },
      { pattern: '/api/v1/buyers/:buyerId', methods: ['PATCH', 'PUT', 'DELETE'] },
      { pattern: '/api/v1/buyers/:buyerId/credits', methods: ['POST'] },
      { pattern: '/api/v1/numbers', methods: ['GET'] },
      { pattern: '/api/v1/numbers/:numberId', methods: ['GET', 'PATCH', 'PUT'] },
      { prefix: '/api/v1/did-routes' },
    ]);
  });

  it.each(ALLOWED_REQUESTS)('%s %s is staff-only, and on the white-label list', (method, path) => {
    expect(isStaffOnlyEndpoint(method, path)).toBe(true);
    expect(isWhiteLabelAllowed(method, path)).toBe(true);
  });

  it.each(STILL_STAFF_ONLY)('%s %s is staff-only and NOT on the list', (method, path) => {
    expect(isStaffOnlyEndpoint(method, path)).toBe(true);
    expect(isWhiteLabelAllowed(method, path)).toBe(false);
  });

  it('matches whole segments, like the rest of the file', () => {
    expect(isWhiteLabelAllowed('POST', '/api/v1/campaignsx')).toBe(false);
    expect(isWhiteLabelAllowed('GET', '/api/v1/numbers/num-1/history')).toBe(false);
    expect(isWhiteLabelAllowed('GET', '/api/v1/did-routesx')).toBe(false);
    expect(isWhiteLabelAllowed('PATCH', '/api/v1/numbers/num-1?x=1')).toBe(true);
    expect(isWhiteLabelAllowed(undefined, '/api/v1/numbers')).toBe(false);
  });
});

describe('the staff-only hook, for the white-label tier', () => {
  let app: FastifyInstance;
  let principal: Record<string, unknown> | undefined;

  const WL_OWNER = { userId: 'u1', tenantId: 't-wl', roles: ['OWNER'], tenantWhiteLabel: true };
  const WL_ADMIN = { userId: 'u2', tenantId: 't-wl', roles: ['ADMIN'], tenantWhiteLabel: true };
  const WL_AGENT = { userId: 'u3', tenantId: 't-wl', roles: ['AGENT'], tenantWhiteLabel: true };
  const WL_KEY = { apiKeyId: 'k1', tenantId: 't-wl', tenantWhiteLabel: true };
  const NORMAL_OWNER = {
    userId: 'u4',
    tenantId: 't-normal',
    roles: ['OWNER', 'ADMIN'],
    tenantWhiteLabel: false,
  };

  beforeEach(async () => {
    app = Fastify();
    principal = undefined;
    app.addHook('onRequest', async request => {
      if (principal) (request as { user?: unknown }).user = principal;
    });
    registerReadOnlyPreview(app);
    registerStaffOnly(app);

    const ok = async () => ({ ok: true });
    for (const [method, path] of [...ALLOWED_REQUESTS, ...STILL_STAFF_ONLY]) {
      app.route({ method: method as 'GET', url: path, handler: ok });
    }
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const send = (method: string, url: string) => app.inject({ method: method as 'GET', url });

  it.each(ALLOWED_REQUESTS)('lets a white-label OWNER make %s %s', async (method, path) => {
    principal = WL_OWNER;
    expect((await send(method, path)).statusCode).toBe(200);
  });

  it.each(ALLOWED_REQUESTS)('lets a white-label ADMIN make %s %s', async (method, path) => {
    principal = WL_ADMIN;
    expect((await send(method, path)).statusCode).toBe(200);
  });

  it.each(STILL_STAFF_ONLY)('refuses a white-label OWNER %s %s', async (method, path) => {
    principal = WL_OWNER;
    const res = await send(method, path);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: STAFF_ONLY.code, message: STAFF_ONLY.message } });
  });

  it.each(ALLOWED_REQUESTS)('refuses a white-label AGENT %s %s', async (method, path) => {
    principal = WL_AGENT;
    expect((await send(method, path)).statusCode).toBe(403);
  });

  it.each(ALLOWED_REQUESTS)(
    "refuses a white-label agency's API key %s %s",
    async (method, path) => {
      principal = WL_KEY;
      expect((await send(method, path)).statusCode).toBe(403);
    }
  );

  it.each(ALLOWED_REQUESTS)(
    'refuses a normal agency OWNER %s %s, as before',
    async (method, path) => {
      principal = NORMAL_OWNER;
      expect((await send(method, path)).statusCode).toBe(403);
    }
  );

  it('does not take the tier from a role alone, nor the role from the tier alone', async () => {
    principal = { userId: 'u5', tenantId: 't-wl', roles: ['OWNER'] };
    expect((await send('POST', '/api/v1/campaigns')).statusCode).toBe(403);
    principal = { userId: 'u6', tenantId: 't-wl', roles: [], tenantWhiteLabel: true };
    expect((await send('POST', '/api/v1/campaigns')).statusCode).toBe(403);
  });

  it('still lets staff through everything', async () => {
    principal = { userId: 'op', tenantId: 't-wl', roles: [], isPlatformAdmin: true };
    for (const [method, path] of [...ALLOWED_REQUESTS, ...STILL_STAFF_ONLY]) {
      expect((await send(method, path)).statusCode, `${method} ${path}`).toBe(200);
    }
  });

  it('keeps refusing every write while staff preview a white-label agency', async () => {
    principal = {
      userId: 'op',
      tenantId: 't-wl',
      roles: ['OWNER'],
      tenantWhiteLabel: true,
      isPlatformAdmin: true,
      previewRole: 'OWNER',
      isReadOnlyPreview: true,
    };
    for (const [method, path] of ALLOWED_REQUESTS.filter(([method]) => method !== 'GET')) {
      const res = await send(method, path);
      expect(res.statusCode, `${method} ${path}`).toBe(403);
      expect(res.json().error.code).toBe(PREVIEW_READ_ONLY.code);
    }
    expect((await send('GET', '/api/v1/numbers')).statusCode).toBe(200);
  });
});
