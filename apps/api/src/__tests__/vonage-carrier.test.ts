/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses and JSON metadata, which are dynamically typed */
import type { CallRouteType } from '@hopwhistle/shared';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerCarrierRoutingRoutes } from '../routes/carrier-routing.js';
import { didLookupVariants } from '../routes/did-routes.js';
import { ensureCarrierCatalog } from '../services/carrier-catalog.js';
import {
  getCarrierChain,
  getInboundCarrierChain,
  listCarrierRoutes,
  recordLegOutcome,
  resetCarrierRoutingCaches,
  scheduleChainOutcome,
} from '../services/carrier-routing.js';

import { TEST_INTERNAL_KEY, useTestInternalKey } from './helpers/internal-key.js';
import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Vonage as a first-class carrier, end to end through the API.
 *
 * What is being proved, against a real Postgres:
 *
 *   - the catalog gives every tenant a routable Vonage carrier without moving
 *     a single existing call;
 *   - each call type keeps its own waterfall, so Vonage can lead the power
 *     dialer while the softphone never sees it;
 *   - Vonage presents only numbers it issued TO THIS TENANT;
 *   - the dialplan's lookup picks the tenant from the authenticated call row,
 *     not from a caller-ID guess;
 *   - one leg's own report opens Vonage's circuit without touching another
 *     carrier or another tenant, and an answered leg attributes the call;
 *   - carrier caller-ID and attestation settings are tenant scoped.
 */

const gate = databaseGate();
announceSkip('the Vonage carrier integration', gate);

describe('DID normalization for the inbound lookup', () => {
  // Vonage's SIP forwarding delivers international digits; other carriers
  // deliver +1XXXXXXXXXX or ten digits. All three must find the same route.
  it.each([
    ['14155550100', '+14155550100'],
    ['+14155550100', '+14155550100'],
    ['4155550100', '+14155550100'],
    ['(415) 555-0100', '+14155550100'],
  ])('%s → %s', (raw, canonical) => {
    const { normalizedDid, variants } = didLookupVariants(raw);
    expect(normalizedDid).toBe(canonical);
    expect(variants).toEqual(['+14155550100', '4155550100', '14155550100']);
  });
});

describe.skipIf(!gate.available)('Vonage carrier integration', () => {
  useTestInternalKey();

  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let tenantA: string;
  let tenantB: string;

  const carrierOf = (tenantId: string, code: string) =>
    prisma.carrier.findFirstOrThrow({ where: { tenantId, code } });
  const gatewayOf = (tenantId: string, name: string) =>
    prisma.carrierGateway.findFirstOrThrow({ where: { tenantId, name } });

  /** Write a waterfall the way the settings page does: a full ordered replacement. */
  async function setWaterfall(tenantId: string, callType: string, order: Array<[string, boolean]>) {
    const carriers = await Promise.all(order.map(([code]) => carrierOf(tenantId, code)));
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/carrier-routing/routes/${callType}`,
      headers: { 'x-test-tenant': tenantId },
      payload: { carriers: carriers.map((c, i) => ({ carrierId: c.id, enabled: order[i][1] })) },
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  async function addNumber(
    tenantId: string,
    number: string,
    provider: string,
    over: { status?: 'ACTIVE' | 'RELEASED'; callerIdEligible?: boolean } = {}
  ) {
    return prisma.phoneNumber.create({
      data: { tenantId, number, provider, status: 'ACTIVE', ...over },
    });
  }

  beforeAll(async () => {
    prisma = getPrismaClient();
    app = Fastify();
    // Stands in for the real auth hook: an authenticated admin of the tenant
    // named in the header. The routes read nothing else from the request.
    app.decorateRequest('user', null);
    app.addHook('onRequest', (request, _reply, done) => {
      const tenantId = request.headers['x-test-tenant'];
      if (typeof tenantId === 'string') {
        (request as any).user = { tenantId, userId: 'test-admin', isPlatformAdmin: true };
      }
      done();
    });
    await registerCarrierRoutingRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "carrier_route_steps", "carrier_routes", "carrier_gateways", "carriers", "calls", "phone_numbers", "tenants" CASCADE;'
    );
    resetCarrierRoutingCaches();
    const stamp = Date.now();
    tenantA = (await prisma.tenant.create({ data: { name: 'A', slug: `vonage-a-${stamp}` } })).id;
    tenantB = (await prisma.tenant.create({ data: { name: 'B', slug: `vonage-b-${stamp}` } })).id;
    await ensureCarrierCatalog();
  });

  describe('catalog', () => {
    it('gives every tenant a routable Vonage carrier and gateway', async () => {
      for (const tenantId of [tenantA, tenantB]) {
        const vonage = await carrierOf(tenantId, 'VONAGE');
        expect(vonage).toMatchObject({
          name: 'Vonage',
          status: 'ACTIVE',
          callerIdStrategy: 'POOL',
          numberProvider: 'vonage',
          attestation: null,
        });
        const gw = await gatewayOf(tenantId, 'vonage');
        expect(gw).toMatchObject({ carrierId: vonage.id, enabled: true, numberFormat: 'NANP11' });
      }
    });

    it('puts Vonage on every route, switched off, leaving every existing chain unchanged', async () => {
      const vonage = await carrierOf(tenantA, 'VONAGE');
      const routes = await prisma.carrierRoute.findMany({
        where: { tenantId: tenantA },
        include: { steps: true },
      });
      expect(routes.map(r => r.callType).sort()).toEqual([
        'CC_MANUAL',
        'CC_POWER_DIALER',
        'DOGRAH_AI',
        'INBOUND',
        'PREDICTIVE_DIALER',
        'SOFTPHONE_MANUAL',
      ]);
      for (const r of routes) {
        const step = r.steps.find(s => s.carrierId === vonage.id);
        expect(step, r.callType).toBeDefined();
        expect(step!.enabled).toBe(false);

        const chain = await getCarrierChain(tenantA, r.callType as CallRouteType);
        expect(chain.carrierOrder, r.callType).toEqual(['FRACTEL']);
      }
    });
  });

  describe('independent waterfalls per call type', () => {
    it('lets Vonage lead the power dialer and back up manual calls, without touching the softphone', async () => {
      await setWaterfall(tenantA, 'CC_POWER_DIALER', [
        ['VONAGE', true],
        ['FRACTEL', true],
        ['TELNYX', true],
      ]);
      await setWaterfall(tenantA, 'CC_MANUAL', [
        ['FRACTEL', true],
        ['VONAGE', true],
      ]);

      expect((await getCarrierChain(tenantA, 'CC_POWER_DIALER')).carrierOrder).toEqual([
        'VONAGE',
        'FRACTEL',
        'TELNYX',
      ]);
      expect((await getCarrierChain(tenantA, 'CC_MANUAL')).carrierOrder).toEqual([
        'FRACTEL',
        'VONAGE',
      ]);
      expect((await getCarrierChain(tenantA, 'SOFTPHONE_MANUAL')).carrierOrder).toEqual([
        'FRACTEL',
      ]);
      expect((await getCarrierChain(tenantA, 'PREDICTIVE_DIALER')).carrierOrder).toEqual([
        'FRACTEL',
      ]);
      // Tenant B's identical call type is untouched.
      expect((await getCarrierChain(tenantB, 'CC_POWER_DIALER')).carrierOrder).toEqual(['FRACTEL']);
    });

    it('can be switched back off from the same page', async () => {
      await setWaterfall(tenantA, 'SOFTPHONE_MANUAL', [
        ['VONAGE', true],
        ['FRACTEL', true],
      ]);
      await setWaterfall(tenantA, 'SOFTPHONE_MANUAL', [
        ['VONAGE', false],
        ['FRACTEL', true],
      ]);
      expect((await getCarrierChain(tenantA, 'SOFTPHONE_MANUAL')).carrierOrder).toEqual([
        'FRACTEL',
      ]);
    });

    it("refuses to put another tenant's Vonage on a waterfall", async () => {
      const foreign = await carrierOf(tenantB, 'VONAGE');
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/carrier-routing/routes/CC_MANUAL',
        headers: { 'x-test-tenant': tenantA },
        payload: { carriers: [{ carrierId: foreign.id, enabled: true }] },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('UNKNOWN_CARRIER');
    });
  });

  describe('Vonage caller ID', () => {
    beforeEach(async () => {
      await setWaterfall(tenantA, 'SOFTPHONE_MANUAL', [
        ['VONAGE', true],
        ['FRACTEL', true],
      ]);
      await addNumber(tenantA, '+14155550100', 'vonage');
      await addNumber(tenantA, '+14155550101', 'vonage');
      await addNumber(tenantA, '+14155550102', 'vonage', { callerIdEligible: false });
      await addNumber(tenantA, '+14155550103', 'vonage', { status: 'RELEASED' });
      await addNumber(tenantA, '+12816991120', 'fractel');
      await addNumber(tenantB, '+16465550000', 'vonage');
      resetCarrierRoutingCaches();
    });

    it("keeps an agent's own Vonage DID", async () => {
      const chain = await getCarrierChain(tenantA, 'SOFTPHONE_MANUAL', '14155550101');
      expect(chain.gateways[0]).toMatchObject({ gateway: 'vonage', callerId: null });
    });

    it("swaps a FracTEL DID for one of this tenant's eligible Vonage numbers only", async () => {
      const seen = new Set<string | null>();
      for (let i = 0; i < 6; i++) {
        const chain = await getCarrierChain(tenantA, 'SOFTPHONE_MANUAL', '12816991120');
        seen.add(chain.gateways[0].callerId);
        // The FracTEL leg after it presents the call's own number again.
        expect(chain.gateways[1].callerId).toBeNull();
      }
      expect(seen).toEqual(new Set(['14155550100', '14155550101']));
    });

    it('says so on the settings page when Vonage has no eligible number', async () => {
      await prisma.phoneNumber.updateMany({
        where: { tenantId: tenantA, provider: 'vonage' },
        data: { status: 'RELEASED' },
      });
      resetCarrierRoutingCaches();
      const views = await listCarrierRoutes(tenantA);
      const step = views
        .find(v => v.callType === 'SOFTPHONE_MANUAL')!
        .steps.find(s => s.carrierCode === 'VONAGE')!;
      expect(step).toMatchObject({ callerIdCount: 0, callerIdUnattestable: true });

      const overview = await app.inject({
        method: 'GET',
        url: '/api/v1/carrier-routing/overview',
        headers: { 'x-test-tenant': tenantA },
      });
      const { carriers } = overview.json<{ carriers: Array<{ code: string }> }>();
      const vonage = carriers.find(c => c.code === 'VONAGE');
      expect(vonage).toMatchObject({ eligibleCallerIdCount: 0, callerIdStrategy: 'POOL' });
    });
  });

  describe('the dialplan lookup', () => {
    let callA: string;

    beforeEach(async () => {
      await setWaterfall(tenantA, 'SOFTPHONE_MANUAL', [
        ['VONAGE', true],
        ['FRACTEL', true],
      ]);
      await setWaterfall(tenantA, 'CC_POWER_DIALER', [
        ['FRACTEL', true],
        ['VONAGE', true],
      ]);
      await addNumber(tenantA, '+14155550100', 'vonage');
      await addNumber(tenantA, '+12816991120', 'fractel');
      // Tenant B owns the number the call presents — the caller-ID heuristic
      // would pick B. The call row says A, and must win.
      await addNumber(tenantB, '+19138999080', 'fractel');
      callA = (
        await prisma.call.create({
          data: {
            tenantId: tenantA,
            callSid: `softphone-${Date.now()}`,
            toNumber: '+18005551212',
            status: 'INITIATED',
            direction: 'OUTBOUND',
          },
        })
      ).id;
      resetCarrierRoutingCaches();
    });

    const lookup = (params: Record<string, string>) =>
      app.inject({
        method: 'GET',
        url: `/api/v1/freeswitch/carrier-route?${new URLSearchParams({ ...params, k: TEST_INTERNAL_KEY }).toString()}`,
      });

    it('routes a softphone call by the tenant of its own call row', async () => {
      const res = await lookup({
        type: 'SOFTPHONE_MANUAL',
        dest: '8005551212',
        cid: '19138999080',
        call_id: callA,
        corr: 'leg-uuid-1',
      });
      expect(res.statusCode).toBe(200);
      const legs = res.body.split('|');
      expect(legs[0]).toContain('sofia/gateway/vonage/18005551212');
      expect(legs[0]).toContain('origination_caller_id_number=14155550100');
      expect(legs[1]).toContain('sofia/gateway/fractel1/18005551212');
      expect(res.body).toContain(`hopwhistle_tenant_id=${tenantA}`);
      expect(res.body).toContain(`hopwhistle_call_id=${callA}`);
      expect(res.body).toContain('hopwhistle_corr=leg-uuid-1');
      expect(res.body).toContain('hopwhistle_route_type=SOFTPHONE_MANUAL');
      expect(res.body).toContain('api_reporting_hook=lua carrier_leg_result.lua');
    });

    it('selects the waterfall from the route-type header the browser sent', async () => {
      const res = await lookup({
        type: 'CC_POWER_DIALER',
        dest: '8005551212',
        cid: '12816991120',
        call_id: callA,
      });
      const legs = res.body.split('|');
      expect(legs[0]).toContain('sofia/gateway/fractel1/');
      expect(legs.at(-1)).toContain('sofia/gateway/vonage/18005551212');
    });

    it("ignores a call id from nowhere and falls back to the caller ID's tenant", async () => {
      const res = await lookup({
        type: 'SOFTPHONE_MANUAL',
        dest: '8005551212',
        cid: '12816991120',
        call_id: 'not-a-call',
      });
      expect(res.body).toContain(`hopwhistle_tenant_id=${tenantA}`);
      expect(res.body).not.toContain('hopwhistle_call_id');
    });

    it('refuses an unkeyed caller', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/freeswitch/carrier-route?type=SOFTPHONE_MANUAL&dest=8005551212',
      });
      expect(res.statusCode).toBe(401);
    });

    it('formats the inbound forward legs per carrier', async () => {
      await setWaterfall(tenantA, 'INBOUND', [
        ['VONAGE', true],
        ['TWILIO', true],
        ['FRACTEL', true],
      ]);
      const inbound = await getInboundCarrierChain(tenantA);
      expect(inbound.gatewaysCsv).toBe(
        'vonage,twilio,fractel1,fractel2,fractel3,fractel4,fractel5,fractel6'
      );
      const [vonageLeg, twilioLeg] = inbound.bridgeTemplate.split('|');
      expect(vonageLeg).toMatch(/^sofia\/gateway\/vonage\/1/);
      expect(twilioLeg).toMatch(/^sofia\/gateway\/twilio\/\+1/);
      // No caller-ID override on an inbound forward: the original caller's
      // number must reach the buyer.
      expect(inbound.bridgeTemplate).not.toContain('origination_caller_id_number');
    });
  });

  describe('health and attribution from leg reports', () => {
    const report = (params: Record<string, string>) =>
      app.inject({
        method: 'GET',
        url: `/api/v1/freeswitch/carrier-result?${new URLSearchParams({ mode: 'leg', ...params, k: TEST_INTERNAL_KEY }).toString()}`,
      });

    it("opens Vonage's circuit on carrier faults, for this tenant only", async () => {
      for (let i = 0; i < 5; i++) {
        const res = await report({
          gateway: 'vonage',
          cause: 'CALL_REJECTED',
          answered: 'false',
          tenant: tenantA,
        });
        expect(res.statusCode).toBe(200);
      }
      const a = await gatewayOf(tenantA, 'vonage');
      expect(a.consecutiveFailures).toBe(5);
      expect(a.circuitOpenUntil!.getTime()).toBeGreaterThan(Date.now());
      expect(a.lastFailureCause).toBe('CALL_REJECTED');
      expect(Number(a.totalFailures)).toBe(5);

      const b = await gatewayOf(tenantB, 'vonage');
      expect(b.consecutiveFailures).toBe(0);
      const fractel = await gatewayOf(tenantA, 'fractel1');
      expect(fractel.consecutiveFailures).toBe(0);

      await setWaterfall(tenantA, 'PREDICTIVE_DIALER', [
        ['VONAGE', true],
        ['FRACTEL', true],
      ]);
      const chain = await getCarrierChain(tenantA, 'PREDICTIVE_DIALER');
      expect(chain.gateways[0].gateway).toBe('fractel1');
      expect(chain.gateways.at(-1)).toMatchObject({ gateway: 'vonage', demoted: true });
    });

    it('does not blame Vonage for a busy or unanswered callee', async () => {
      await report({ gateway: 'vonage', cause: 'USER_BUSY', answered: 'false', tenant: tenantA });
      await report({ gateway: 'vonage', cause: 'NO_ANSWER', answered: 'false', tenant: tenantA });
      const a = await gatewayOf(tenantA, 'vonage');
      expect(a.consecutiveFailures).toBe(0);
      expect(Number(a.totalAttempts)).toBe(0);
    });

    it('credits the gateway that connected and records it on the call', async () => {
      const call = await prisma.call.create({
        data: {
          tenantId: tenantA,
          callSid: `softphone-${Date.now()}`,
          toNumber: '+18005551212',
          status: 'INITIATED',
          direction: 'OUTBOUND',
          metadata: { callerId: '14155550100' },
        },
      });
      await report({
        gateway: 'vonage',
        cause: 'PROGRESS_TIMEOUT',
        answered: 'false',
        tenant: tenantA,
      });
      await report({
        gateway: 'vonage',
        carrier: 'VONAGE',
        route_type: 'SOFTPHONE_MANUAL',
        cause: 'NORMAL_CLEARING',
        answered: 'true',
        call_id: call.id,
        // A forged hint naming the other tenant: the call row wins.
        tenant: tenantB,
      });

      const row = await prisma.call.findUniqueOrThrow({ where: { id: call.id } });
      expect((row.metadata as any).callerId).toBe('14155550100');
      expect((row.metadata as any).carrier).toMatchObject({
        gateway: 'vonage',
        carrierCode: 'VONAGE',
        routeType: 'SOFTPHONE_MANUAL',
      });

      const a = await gatewayOf(tenantA, 'vonage');
      expect(a.consecutiveFailures).toBe(0);
      expect(a.lastSuccessAt).not.toBeNull();
      const b = await gatewayOf(tenantB, 'vonage');
      expect(b.lastSuccessAt).toBeNull();
    });

    it('counts an answered leg once though it reports at answer and again at hangup', async () => {
      const call = await prisma.call.create({
        data: {
          tenantId: tenantA,
          callSid: `softphone-twice-${Date.now()}`,
          toNumber: '+18005551212',
          status: 'INITIATED',
          direction: 'OUTBOUND',
        },
      });
      const leg = { gateway: 'vonage', carrier: 'VONAGE', call_id: call.id, corr: 'a-leg-uuid' };
      await report({ ...leg, phase: 'answer', answered: 'true' });
      // The hangup handler merges its own key meanwhile.
      await prisma.$executeRaw`UPDATE "calls" SET "metadata" = COALESCE("metadata", '{}'::jsonb) || '{"endReason":"agent"}'::jsonb WHERE "id" = ${call.id}`;
      await report({
        ...leg,
        phase: 'end',
        answered: 'true',
        cause: 'NORMAL_CLEARING',
        carrier: 'OTHER',
      });

      const gw = await gatewayOf(tenantA, 'vonage');
      expect(Number(gw.totalAttempts)).toBe(1);
      const row = await prisma.call.findUniqueOrThrow({ where: { id: call.id } });
      expect(row.metadata).toMatchObject({
        endReason: 'agent',
        carrier: { gateway: 'vonage', carrierCode: 'VONAGE' },
      });
    });

    it("never writes attribution onto another tenant's call", async () => {
      const callB = await prisma.call.create({
        data: {
          tenantId: tenantB,
          callSid: `softphone-b-${Date.now()}`,
          toNumber: '+18005551212',
          status: 'INITIATED',
          direction: 'OUTBOUND',
        },
      });
      await recordLegOutcome({
        gateway: 'vonage',
        answered: true,
        callId: callB.id,
        tenantId: tenantA,
      });
      // The leg's tenant hint said A; the row is B's, so B's gateway is credited
      // and the attribution lands on B's own row — never A's counters.
      expect((await gatewayOf(tenantA, 'vonage')).lastSuccessAt).toBeNull();
      expect((await gatewayOf(tenantB, 'vonage')).lastSuccessAt).not.toBeNull();
    });

    it('does not count a leg twice when the whole chain also reports', async () => {
      await recordLegOutcome({
        gateway: 'vonage',
        answered: false,
        cause: 'NORMAL_TEMPORARY_FAILURE',
        tenantId: tenantA,
        corr: 'call-1',
      });
      await scheduleChainOutcome(
        ['vonage', 'fractel1'],
        { ok: false, cause: 'NORMAL_TEMPORARY_FAILURE' },
        { tenantId: tenantA, corr: 'call-1' },
        0
      );
      expect((await gatewayOf(tenantA, 'vonage')).consecutiveFailures).toBe(1);
      // FracTEL never got a channel of its own, so only the chain report covers it.
      expect((await gatewayOf(tenantA, 'fractel1')).consecutiveFailures).toBe(1);
    });
  });

  describe('carrier settings', () => {
    const patch = (tenantId: string, carrierId: string, payload: Record<string, unknown>) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/carrier-routing/carriers/${carrierId}`,
        headers: { 'x-test-tenant': tenantId },
        payload,
      });

    it('sets and clears the attestation claim per carrier', async () => {
      const vonage = await carrierOf(tenantA, 'VONAGE');
      expect((await patch(tenantA, vonage.id, { attestation: 'A' })).json().attestation).toBe('A');
      expect(
        (await patch(tenantA, vonage.id, { attestation: null })).json().attestation
      ).toBeNull();
      expect((await patch(tenantA, vonage.id, { attestation: 'Z' })).statusCode).toBe(400);
      expect((await carrierOf(tenantA, 'FRACTEL')).attestation).toBeNull();
    });

    it("accepts only this tenant's own number as a fixed caller ID", async () => {
      await addNumber(tenantA, '+14155550100', 'vonage');
      await addNumber(tenantB, '+16465550000', 'vonage');
      const vonage = await carrierOf(tenantA, 'VONAGE');

      const foreign = await patch(tenantA, vonage.id, {
        callerIdStrategy: 'FIXED',
        callerIdNumber: '16465550000',
      });
      expect(foreign.statusCode).toBe(400);
      expect(foreign.json().error.code).toBe('UNKNOWN_CALLER_ID');

      const missing = await patch(tenantA, vonage.id, { callerIdStrategy: 'FIXED' });
      expect(missing.json().error.code).toBe('CALLER_ID_REQUIRED');

      const ok = await patch(tenantA, vonage.id, {
        callerIdStrategy: 'FIXED',
        callerIdNumber: '(415) 555-0100',
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({
        callerIdStrategy: 'FIXED',
        callerIdNumber: '+14155550100',
      });
    });

    it("cannot reach another tenant's carrier", async () => {
      const foreign = await carrierOf(tenantB, 'VONAGE');
      expect((await patch(tenantA, foreign.id, { attestation: 'A' })).statusCode).toBe(404);
      expect((await carrierOf(tenantB, 'VONAGE')).attestation).toBeNull();
    });

    it('takes an INACTIVE carrier out of every waterfall', async () => {
      await setWaterfall(tenantA, 'CC_MANUAL', [
        ['VONAGE', true],
        ['FRACTEL', true],
      ]);
      const vonage = await carrierOf(tenantA, 'VONAGE');
      await patch(tenantA, vonage.id, { status: 'INACTIVE' });
      expect((await getCarrierChain(tenantA, 'CC_MANUAL')).carrierOrder).toEqual(['FRACTEL']);
    });
  });
});
