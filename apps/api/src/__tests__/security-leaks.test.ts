/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { signRecordingToken } from '../lib/recording-token.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import type { JwtPayload } from '../types/fastify.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Security and data leaks: fix pass 3.
 *
 *   1. Recording links carried a 7-day login token, and `?token=` was a login
 *      on every /api/v1 route. Now no link carries a credential, and `?token=`
 *      is a 15-minute, one-recording pass accepted by one route.
 *   2. Any agent could rewrite any call's disposition; an agent's call list
 *      and detail showed the buyer, publisher and destination, and matched
 *      calls by the agency's DID.
 *   3. A buyer could read the agency's invoices, reprice its own targets, and
 *      refile a denied dispute; the Accept button 404'd.
 *   5. Any agent could delete the agency's leads.
 *
 * (4, ping/post attribution, is `ping-post-publisher-attribution.test.ts`.)
 */

const gate = databaseGate();
announceSkip('Security: data leaks', gate);

const TEST_JWT_SECRET = 'security-leaks-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Security: data leaks suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `security leaks suite cannot run: ${gate.reason}`).toBe(true);
  });
});

interface User {
  id: string;
  email: string;
  roles: string[];
}

describe.skipIf(!gate.available)('Security: data leaks', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  /** The auth hook alone, in front of routes that echo who it decided the caller is. */
  let probe: FastifyInstance;

  let tenantId: string;
  let owner: User;
  let dana: User;
  let ruben: User;
  let buyerUser: User;
  let otherBuyerUser: User;
  let publisherUser: User;
  let buyerId: string;
  let targetId: string;
  let ownCampaignId: string;
  let otherCampaignId: string;
  /** Answered by Dana, sold to the buyer, with a recording. */
  let danaCallId: string;
  let recordingId: string;
  /** Answered by Ruben, on the DID assigned to Dana. */
  let rubenCallId: string;
  let leadId: string;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    const routes = await import('../routes/index.js');
    await instance.register(routes.registerCallRoutes);
    await instance.register(routes.registerCampaignRoutes);
    await instance.register(routes.registerBillingRoutes);
    const { registerBuyerBillingRoutes } = await import('../routes/buyer-billing.js');
    await instance.register(registerBuyerBillingRoutes);
    const { registerRecordingManagementRoutes } = await import('../routes/recordings.js');
    await instance.register(registerRecordingManagementRoutes);
    const { registerInsuranceLeadRoutes } = await import('../routes/insurance-leads.js');
    await instance.register(registerInsuranceLeadRoutes);
    await instance.ready();
    return instance;
  }

  async function buildProbe(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    const echo = (request: any) => ({ user: request.user ?? null });
    instance.get('/api/v1/calls', echo);
    instance.get('/api/v1/recordings/:recordingId/stream', echo);
    instance.post('/api/v1/recordings/:recordingId/stream', echo);
    instance.get('/api/v1/recordings/:recordingId', echo);
    await instance.ready();
    return instance;
  }

  const loginToken = (u: User) =>
    app.jwt.sign({ tenantId, userId: u.id, email: u.email, roles: u.roles } as JwtPayload);
  const as = (u: User) => ({ authorization: `Bearer ${loginToken(u)}` });

  beforeAll(async () => {
    prisma = getPrismaClient();
    app = await buildApp();
    probe = await buildProbe();

    for (const table of [
      'insurance_leads',
      'recordings',
      'calls',
      'buyer_endpoints',
      'campaigns',
      'phone_numbers',
      'user_roles',
      'users',
      'buyers',
      'publishers',
      'roles',
      'tenants',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }

    const roleIds: Record<string, string> = {};
    for (const name of [
      RoleName.OWNER,
      RoleName.ADMIN,
      RoleName.AGENT,
      RoleName.BUYER,
      RoleName.PUBLISHER,
    ]) {
      const role = await prisma.role.create({ data: { name, permissions: [] } });
      roleIds[name] = role.id;
    }

    const slug = `leaks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: 'Leaks Insurance', slug, status: 'ACTIVE' },
    });
    tenantId = tenant.id;

    const publisher = await prisma.publisher.create({
      data: { tenantId, name: 'Pub One', code: `pub-${slug}` },
    });
    const buyer = await prisma.buyer.create({
      data: {
        tenantId,
        name: 'Buyer One',
        code: `buy-${slug}`,
        canPauseTargets: false,
        canSetCaps: true,
        canDisputeConversions: true,
      },
    });
    buyerId = buyer.id;
    const otherBuyer = await prisma.buyer.create({
      data: { tenantId, name: 'Buyer Two', code: `buy2-${slug}` },
    });

    const mkUser = async (
      name: string,
      role: RoleName,
      extra: { buyerId?: string; publisherId?: string } = {}
    ): Promise<User> => {
      const user = await prisma.user.create({
        data: {
          tenantId,
          email: `${name}@${slug}.local`,
          status: 'ACTIVE',
          ...extra,
          roles: { create: { roleId: roleIds[role] } },
        },
      });
      return { id: user.id, email: user.email, roles: [role] };
    };

    owner = await mkUser('owner', RoleName.OWNER);
    dana = await mkUser('dana', RoleName.AGENT);
    ruben = await mkUser('ruben', RoleName.AGENT);
    buyerUser = await mkUser('buyer', RoleName.BUYER, { buyerId: buyer.id });
    otherBuyerUser = await mkUser('buyer2', RoleName.BUYER, { buyerId: otherBuyer.id });
    publisherUser = await mkUser('pub', RoleName.PUBLISHER, { publisherId: publisher.id });

    // The DID is assigned to Dana. It used to put every call on it in her list.
    await prisma.phoneNumber.create({
      data: { tenantId, number: '+15557770000', userId: dana.id },
    });

    const ownCampaign = await prisma.campaign.create({
      data: { tenantId, publisherId: publisher.id, name: 'Sold to buyer one' },
    });
    ownCampaignId = ownCampaign.id;
    const otherCampaign = await prisma.campaign.create({
      data: { tenantId, publisherId: publisher.id, name: 'Never sold to buyer one' },
    });
    otherCampaignId = otherCampaign.id;

    const target = await prisma.buyerEndpoint.create({
      data: { buyerId: buyer.id, name: 'Floor A', type: 'PSTN', destination: '+15559990000' },
    });
    targetId = target.id;

    const danaCall = await prisma.call.create({
      data: {
        tenantId,
        callSid: `sid-dana-${slug}`,
        callerId: '+15551230000',
        did: '+15557770000',
        toNumber: '+15559990000',
        targetNumber: '+15559990000',
        status: 'COMPLETED',
        direction: 'INBOUND',
        answeredByUserId: dana.id,
        buyerId: buyer.id,
        buyerName: 'Buyer One',
        publisherId: publisher.id,
        publisherName: 'Pub One',
        campaignId: ownCampaign.id,
        buyerChargeStatus: 'CHARGED',
      },
    });
    danaCallId = danaCall.id;
    const recording = await prisma.recording.create({
      data: { callId: danaCall.id, url: 'recordings/2026/01/01/x.wav', storageKey: 'x.wav' },
    });
    recordingId = recording.id;

    const rubenCall = await prisma.call.create({
      data: {
        tenantId,
        callSid: `sid-ruben-${slug}`,
        callerId: '+15551239999',
        did: '+15557770000',
        toNumber: '+15557770000',
        status: 'COMPLETED',
        direction: 'INBOUND',
        answeredByUserId: ruben.id,
      },
    });
    rubenCallId = rubenCall.id;

    const lead = await prisma.insuranceLead.create({
      data: {
        tenantId,
        vertical: 'FE',
        firstName: 'Keep',
        lastName: 'Me',
        phone: '5550001111',
        state: 'TN',
        assignedToId: dana.id,
      },
    });
    leadId = lead.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await probe?.close();
    await prisma?.$disconnect();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. Recording links
  // ══════════════════════════════════════════════════════════════════════════
  describe('recording links carry no login', () => {
    it('writes no token into the recording URLs on the calls list', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/calls', headers: as(owner) });
      expect(res.statusCode).toBe(200);
      const row = res.json().data.find((r: any) => r.id === danaCallId);
      expect(row.recordingUrl).toContain(`/api/v1/recordings/${recordingId}/stream`);
      expect(res.body).not.toContain('token=');
    });

    it('writes no token into the CSV, and links the call instead of the audio', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/calls/export.csv',
        headers: as(owner),
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('token=');
      expect(res.body).not.toContain('/stream');
      const appUrl = (process.env.APP_URL ?? 'https://agents.netenroll.com').replace(/\/+$/, '');
      expect(res.body).toContain(`${appUrl}/calls?call=${danaCallId}`);
    });

    it('refuses a login token in ?token= on /api/v1/calls', async () => {
      const probed = await probe.inject({
        method: 'GET',
        url: `/api/v1/calls?token=${loginToken(owner)}`,
      });
      expect(probed.json().user).toBeNull();

      const real = await app.inject({
        method: 'GET',
        url: `/api/v1/calls?token=${loginToken(owner)}`,
      });
      expect(real.statusCode).toBeGreaterThanOrEqual(400);
      expect(real.body).not.toContain(danaCallId);
    });

    it('refuses a login token in ?token= even on the stream route', async () => {
      const res = await probe.inject({
        method: 'GET',
        url: `/api/v1/recordings/${recordingId}/stream?token=${loginToken(owner)}`,
      });
      expect(res.json().user).toBeNull();
    });

    it('mints a 15-minute pass that authenticates its own stream', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/recordings/${recordingId}/url`,
        headers: as(owner),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().expiresIn).toBe(15 * 60);
      const url = new URL(res.json().url);
      expect(url.pathname).toBe(`/api/v1/recordings/${recordingId}/stream`);

      const streamed = await probe.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
      expect(streamed.json().user?.userId).toBe(owner.id);
      expect(streamed.json().user?.tenantId).toBe(tenantId);
    });

    it('accepts the pass nowhere but its own stream, and only on GET', async () => {
      const pass = signRecordingToken(app, {
        tenantId,
        userId: owner.id,
        email: owner.email,
        recordingId,
      });

      const elsewhere = [
        { method: 'GET' as const, url: `/api/v1/calls?token=${pass}` },
        { method: 'GET' as const, url: `/api/v1/recordings/${recordingId}?token=${pass}` },
        { method: 'GET' as const, url: `/api/v1/recordings/another-id/stream?token=${pass}` },
        { method: 'POST' as const, url: `/api/v1/recordings/${recordingId}/stream?token=${pass}` },
      ];
      for (const { method, url } of elsewhere) {
        const res = await probe.inject({ method, url });
        expect(res.json().user, `${method} ${url}`).toBeNull();
      }

      // Nor is it a login in the Authorization header: it is not signed with
      // the login key at all.
      const bearer = await probe.inject({
        method: 'GET',
        url: '/api/v1/calls',
        headers: { authorization: `Bearer ${pass}` },
      });
      expect(bearer.json().user).toBeNull();
    });

    describe('expiry', () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it('stops working after 15 minutes', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const pass = signRecordingToken(app, {
          tenantId,
          userId: owner.id,
          email: owner.email,
          recordingId,
        });
        const url = `/api/v1/recordings/${recordingId}/stream?token=${pass}`;

        vi.setSystemTime(Date.now() + 14 * 60 * 1000);
        expect((await probe.inject({ method: 'GET', url })).json().user?.userId).toBe(owner.id);

        vi.setSystemTime(Date.now() + 2 * 60 * 1000);
        expect((await probe.inject({ method: 'GET', url })).json().user).toBeNull();
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Call writes and agent visibility
  // ══════════════════════════════════════════════════════════════════════════
  describe('call writes and agent visibility', () => {
    const disposition = (headers: Record<string, string>, callId: string) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/calls/${callId}/disposition`,
        headers,
        payload: { disposition: 'NOT_INTERESTED' },
      });

    it("refuses an agent writing up a colleague's call", async () => {
      const res = await disposition(as(dana), rubenCallId);
      expect(res.statusCode).toBe(403);
    });

    it('refuses a buyer and a publisher, even on their own traffic', async () => {
      expect((await disposition(as(buyerUser), danaCallId)).statusCode).toBe(403);
      expect((await disposition(as(publisherUser), danaCallId)).statusCode).toBe(403);
    });

    it('lets an agent write up the call they answered, and the owner any call', async () => {
      expect((await disposition(as(dana), danaCallId)).statusCode).toBe(200);
      expect((await disposition(as(owner), rubenCallId)).statusCode).toBe(200);
    });

    it('gives an agent their call without the buyer, publisher or destination', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/calls', headers: as(dana) });
      expect(res.statusCode).toBe(200);
      const rows = res.json().data;
      const row = rows.find((r: any) => r.id === danaCallId);
      expect(row).toBeDefined();
      expect(row.buyerName).toBeNull();
      expect(row.publisherName).toBeNull();
      expect(row.targetNumber).toBeNull();
      expect(row.toNumber).toBeNull();
    });

    it("no longer shows an agent a colleague's call on a DID assigned to them", async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/calls', headers: as(dana) });
      const ids: string[] = res.json().data.map((r: { id: string }) => r.id);
      expect(ids).not.toContain(rubenCallId);

      const detail = await app.inject({
        method: 'GET',
        url: `/api/v1/calls/${rubenCallId}`,
        headers: as(dana),
      });
      expect(detail.statusCode).toBe(403);
    });

    it('keeps the ping request from anyone but platform staff', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/calls/${danaCallId}`,
        headers: as(owner),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().pingRequest).toBeNull();
    });

    it("leaves the commercial columns out of an agent's CSV", async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/calls/export.csv',
        headers: as(dana),
      });
      expect(res.statusCode).toBe(200);
      const columns = (csv: string) =>
        csv
          .split('\n')[0]
          .split(',')
          .map(c => c.replace(/^"|"$/g, ''));
      const commercial = [
        'Publisher',
        'Buyer',
        'Destination (To)',
        'Buyer Charge Status',
        'Publisher Payout Status',
      ];
      for (const column of commercial) {
        expect(columns(res.body)).not.toContain(column);
      }
      expect(res.body).not.toContain('Buyer One');

      const ownerCsv = await app.inject({
        method: 'GET',
        url: '/api/v1/calls/export.csv',
        headers: as(owner),
      });
      for (const column of commercial) {
        expect(columns(ownerCsv.body)).toContain(column);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. The buyer portal
  // ══════════════════════════════════════════════════════════════════════════
  describe('the buyer portal', () => {
    it("refuses a buyer and a publisher the agency's invoices and balance", async () => {
      for (const who of [buyerUser, publisherUser]) {
        for (const url of [
          '/api/v1/billing/invoices',
          '/api/v1/billing/invoices/any-id',
          '/api/v1/billing/balance',
        ]) {
          const res = await app.inject({ method: 'GET', url, headers: as(who) });
          expect(res.statusCode, `${who.roles[0]} ${url}`).toBe(403);
        }
      }
      const ownerRes = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/invoices',
        headers: as(owner),
      });
      expect(ownerRes.statusCode).toBe(200);
    });

    describe('targets', () => {
      const patch = (payload: Record<string, unknown>) =>
        app.inject({
          method: 'PATCH',
          url: `/api/v1/buyers/${buyerId}/targets/${targetId}`,
          headers: as(buyerUser),
          payload,
        });

      beforeEach(async () => {
        await prisma.buyer.update({
          where: { id: buyerId },
          data: { canPauseTargets: false, canSetCaps: true },
        });
      });

      it('refuses a buyer changing its price, rules or destination', async () => {
        expect((await patch({ basePrice: 1 })).statusCode).toBe(403);
        expect((await patch({ pricingRules: [] })).statusCode).toBe(403);
        expect((await patch({ destination: '+15550000001' })).statusCode).toBe(403);
        expect((await patch({ maxCap: 5, weight: 1 })).statusCode).toBe(403);

        const target = await prisma.buyerEndpoint.findUniqueOrThrow({ where: { id: targetId } });
        expect(Number(target.basePrice)).toBe(0);
        expect(target.destination).toBe('+15559990000');
      });

      it('refuses a status change without canPauseTargets, and allows it with', async () => {
        expect((await patch({ status: 'INACTIVE' })).statusCode).toBe(403);

        await prisma.buyer.update({ where: { id: buyerId }, data: { canPauseTargets: true } });
        const res = await patch({ status: 'INACTIVE' });
        expect(res.statusCode).toBe(200);
        expect(res.json().status).toBe('INACTIVE');
      });

      it('allows caps with canSetCaps, and refuses them without', async () => {
        expect((await patch({ maxCap: 7, acceptedStates: ['TN'] })).statusCode).toBe(200);

        await prisma.buyer.update({ where: { id: buyerId }, data: { canSetCaps: false } });
        expect((await patch({ maxConcurrency: 3 })).statusCode).toBe(403);
      });

      it('refuses a buyer creating or deleting a target', async () => {
        const created = await app.inject({
          method: 'POST',
          url: `/api/v1/buyers/${buyerId}/targets`,
          headers: as(buyerUser),
          payload: { name: 'New', type: 'PSTN', destination: '+15551110000' },
        });
        expect(created.statusCode).toBe(403);

        const deleted = await app.inject({
          method: 'DELETE',
          url: `/api/v1/buyers/${buyerId}/targets/${targetId}`,
          headers: as(buyerUser),
        });
        expect(deleted.statusCode).toBe(403);
        expect(await prisma.buyerEndpoint.count({ where: { id: targetId } })).toBe(1);
      });

      it('still lets the owner change the price', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: `/api/v1/buyers/${buyerId}/targets/${targetId}`,
          headers: as(owner),
          payload: { basePrice: 0 },
        });
        expect(res.statusCode).toBe(200);
      });
    });

    it('gives a buyer only the names of the campaigns it has taken calls from', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/campaigns',
        headers: as(buyerUser),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([{ id: ownCampaignId, name: 'Sold to buyer one' }]);
      expect(res.body).not.toContain(otherCampaignId);
    });

    describe('disputes', () => {
      const dispute = (callId: string) =>
        app.inject({
          method: 'POST',
          url: `/api/v1/calls/${callId}/dispute`,
          headers: as(buyerUser),
          payload: { reason: 'Not a real caller' },
        });

      it('refuses refiling a denied dispute', async () => {
        await prisma.call.update({ where: { id: danaCallId }, data: { disputeStatus: 'DENIED' } });
        const res = await dispute(danaCallId);
        expect(res.statusCode).toBe(409);
        const call = await prisma.call.findUniqueOrThrow({ where: { id: danaCallId } });
        expect(call.disputeStatus).toBe('DENIED');
      });

      it('files once, then refuses a second filing', async () => {
        await prisma.call.update({ where: { id: danaCallId }, data: { disputeStatus: null } });
        expect((await dispute(danaCallId)).statusCode).toBe(200);
        expect((await dispute(danaCallId)).statusCode).toBe(409);
        await prisma.call.update({ where: { id: danaCallId }, data: { disputeStatus: null } });
      });
    });

    describe('accepting a call', () => {
      const accept = (who: User, callId: string) =>
        app.inject({
          method: 'POST',
          url: `/api/v1/calls/${callId}/accept`,
          headers: as(who),
        });

      it("refuses another buyer's call", async () => {
        const res = await accept(otherBuyerUser, danaCallId);
        expect(res.statusCode).toBe(403);
        const call = await prisma.call.findUniqueOrThrow({ where: { id: danaCallId } });
        expect((call.metadata as any)?.acceptedByBuyerAt).toBeUndefined();
      });

      it('refuses anyone who is not a buyer', async () => {
        expect((await accept(dana, danaCallId)).statusCode).toBe(403);
      });

      it('records the acceptance and leaves the charge as it was', async () => {
        const res = await accept(buyerUser, danaCallId);
        expect(res.statusCode).toBe(200);
        const call = await prisma.call.findUniqueOrThrow({ where: { id: danaCallId } });
        expect(typeof (call.metadata as any)?.acceptedByBuyerAt).toBe('string');
        expect(call.buyerChargeStatus).toBe('CHARGED');
        expect(call.disposition).not.toBe('VERIFIED');
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. CRM deletes
  // ══════════════════════════════════════════════════════════════════════════
  describe('CRM deletes', () => {
    it('refuses an agent deleting leads, even their own', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/insurance-leads',
        headers: as(dana),
        payload: { ids: [leadId] },
      });
      expect(res.statusCode).toBe(403);
      expect(await prisma.insuranceLead.count({ where: { id: leadId } })).toBe(1);
    });

    it('lets the owner delete them', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/insurance-leads',
        headers: as(owner),
        payload: { ids: [leadId] },
      });
      expect(res.statusCode).toBe(200);
      expect(await prisma.insuranceLead.count({ where: { id: leadId } })).toBe(0);
    });
  });

  it('keeps Ruben and Dana distinct users (fixture sanity)', () => {
    expect(ruben.id).not.toBe(dana.id);
  });
});
