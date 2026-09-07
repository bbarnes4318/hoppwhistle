/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses */
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { recordPurchase } from '../services/billing/credit-ledger.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Every path that delivers a call to an agent is gated.
 *
 * ── Why this is a separate suite ─────────────────────────────────────────────
 *
 * `settlement.test.ts` asserts that the GATE returns the right answer.
 * That is not the same claim as "every path that hands a call to an agent asks
 * it". A gate nobody calls is a comment, and the way that failure happens is a
 * new delivery path being added later, not the gate being wrong.
 *
 * So this suite drives the real route handlers and asserts the refusal comes
 * out the other end, in the shape each caller understands:
 *
 *   GET  /api/v1/freeswitch/lookup   the inbound bridge decision. Both branches
 *                                    -- the Redis RTB lease and the DidRoute
 *                                    lookup -- must answer `reject: true`,
 *                                    which the Lua script hangs up on BEFORE
 *                                    answering, so the call never gets an
 *                                    `answeredAt` and never enters the
 *                                    delivered-call denominator.
 *   POST /api/v1/agent/call/incoming  the softphone screen-pop path. Must
 *                                    answer 403 and create no `Call` row.
 *
 * The full survey of delivery paths, including the ones deliberately NOT gated
 * and why, is in docs/BILLING.md.
 *
 * ── And that every path is ungated for an agency not enrolled in billing ─────
 *
 * The other half of the same claim, and the more expensive one to get wrong.
 * Enrolment is explicit and defaults to off, so an agency that has not been
 * enrolled must reach an agent exactly as it did before Phase 3 existed. The
 * final block below takes the same routes, with the same suspended profile that
 * refuses an enrolled agency, and asserts the calls go through.
 */

const gate = databaseGate();
announceSkip('Delivery gating: every path that offers a call to an agent', gate);

const TEST_JWT_SECRET = 'delivery-gating-suite-secret';
const INTERNAL_KEY = 'delivery-gating-suite-internal-key';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;
process.env.FREESWITCH_INTERNAL_KEY = INTERNAL_KEY;

describe.skipIf(!gate.available)(
  'Delivery gating: every path that offers a call to an agent',
  () => {
    let prisma: ReturnType<typeof getPrismaClient>;
    let app: FastifyInstance;
    let tenantId: string;

    async function buildApp(): Promise<FastifyInstance> {
      const instance = Fastify();
      await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
      await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
      registerApiV1Auth(instance);

      const { registerDidRouteRoutes } = await import('../routes/did-routes.js');
      const { registerAgentPhoneRoutes } = await import('../routes/agent-phone.js');
      await instance.register(registerDidRouteRoutes);
      await instance.register(registerAgentPhoneRoutes);

      await instance.ready();
      return instance;
    }

    async function cleanDatabase() {
      for (const table of [
        'billing_notifications',
        'delivery_hold_events',
        'application_credit_ledger',
        'daily_settlements',
        'agency_billing_profiles',
        'agency_rating_states',
        'did_routes',
        'phone_numbers',
        'insurance_carrier_applications',
        'calls',
        'user_roles',
        'users',
        'roles',
        'tenants',
      ]) {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
      }
    }

    /** An agency with agreed terms, a valid mandate and a paid block. */
    async function deliverableAgency() {
      const tenant = await prisma.tenant.create({
        data: {
          name: 'Ridgeline Insurance',
          slug: `ridgeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          status: 'ACTIVE',
        },
      });

      await prisma.agencyBillingProfile.create({
        data: {
          tenantId: tenant.id,
          dailyBlockApplications: 45,
          maxDailyDebit: 8978,
          stripeCustomerId: 'cus_fake',
          achPaymentMethodId: 'pm_fake',
          achMandateStatus: 'ACTIVE',
          achMandateVerifiedAt: new Date(),
          // Explicitly enrolled: the gate does nothing at all otherwise, which
          // is what the last describe block below asserts.
          billingEnrolledAt: new Date(),
          chargesEnabled: true,
        },
      });

      await prisma.agencyRatingState.create({
        data: {
          tenantId: tenant.id,
          status: 'OPENING_BLOCK',
          openingRate: 134,
          currentRate: 134,
        },
      });

      await recordPurchase(prisma, {
        tenantId: tenant.id,
        deliveryDay: '2026-09-07',
        quantity: 45,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });

      return tenant.id;
    }

    async function seedDidRoute(did: string) {
      const number = await prisma.phoneNumber.create({
        data: { tenantId, number: did, status: 'ACTIVE' },
      });
      return prisma.didRoute.create({
        data: {
          tenantId,
          phoneNumberId: number.id,
          did,
          destination: '1001',
          status: 'ACTIVE',
          recordingEnabled: true,
        },
      });
    }

    beforeAll(async () => {
      app = await buildApp();
    });

    afterAll(async () => {
      await app?.close();
    });

    beforeEach(async () => {
      prisma = getPrismaClient();
      await cleanDatabase();
      tenantId = await deliverableAgency();
    });

    describe('GET /api/v1/freeswitch/lookup', () => {
      it('hands over a destination while the agency is deliverable', async () => {
        await seedDidRoute('+15551230001');

        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/freeswitch/lookup?did=%2B15551230001',
          headers: { 'x-internal-key': INTERNAL_KEY },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.reject).toBeUndefined();
        expect(body.destination).toBe('1001');
      });

      it('refuses when a platform admin has suspended the agency', async () => {
        await seedDidRoute('+15551230002');
        await prisma.agencyBillingProfile.update({
          where: { tenantId },
          data: { suspendedAt: new Date(), suspensionReason: 'Compliance review' },
        });

        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/freeswitch/lookup?did=%2B15551230002',
          headers: { 'x-internal-key': INTERNAL_KEY },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        // `reject: true` is the shape the Lua script already hangs up on, and it
        // hangs up BEFORE answering -- so the call never carries an `answeredAt`
        // and never enters the delivered-call denominator.
        expect(body.reject).toBe(true);
        expect(body.reason).toBe('DELIVERY_PAUSED');
        expect(body.deliveryHoldReason).toBe('ADMIN_SUSPENDED');
        expect(body.destination).toBeUndefined();
      });

      it('refuses when there is no valid ACH mandate', async () => {
        await seedDidRoute('+15551230003');
        await prisma.agencyBillingProfile.update({
          where: { tenantId },
          data: { achMandateStatus: 'NONE', achPaymentMethodId: null },
        });

        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/freeswitch/lookup?did=%2B15551230003',
          headers: { 'x-internal-key': INTERNAL_KEY },
        });

        expect(response.json().deliveryHoldReason).toBe('NO_MANDATE');
      });

      it('still refuses the internal key check first', async () => {
        // Gating delivery must not have opened the FreeSWITCH callbacks to
        // anyone who can reach nginx. The Phase 1b guard runs first.
        await seedDidRoute('+15551230004');

        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/freeswitch/lookup?did=%2B15551230004',
        });

        expect(response.statusCode).toBe(401);
      });
    });

    describe('POST /api/v1/agent/call/incoming', () => {
      it('creates a ringing call while the agency is deliverable', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/agent/call/incoming',
          payload: { tenantId, from: '+15559990000' },
        });

        expect(response.statusCode).toBe(201);
        expect(await prisma.call.count({ where: { tenantId } })).toBe(1);
      });

      it('refuses, and creates no call row, when delivery is held', async () => {
        await prisma.agencyBillingProfile.update({
          where: { tenantId },
          data: { suspendedAt: new Date(), suspensionReason: 'Compliance review' },
        });

        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/agent/call/incoming',
          payload: { tenantId, from: '+15559990001' },
        });

        expect(response.statusCode).toBe(403);
        expect(response.json().deliveryHoldReason).toBe('ADMIN_SUSPENDED');

        /*
         * No `Call` row. A TCPA block writes one because a blocked litigator is
         * a compliance record somebody may have to produce; a delivery hold is
         * already recorded once per Delivery Day in `delivery_hold_events`, and
         * a row per refused call would put hundreds of RINGING calls that were
         * never offered to anybody into the agency's call history.
         */
        expect(await prisma.call.count({ where: { tenantId } })).toBe(0);
      });
    });

    describe('an agency not enrolled in billing is not gated at all', () => {
      /*
       * The production case this switch was added for: five tenants, none with
       * a billing profile, one carrying live client traffic. Every one of them
       * must keep delivering.
       *
       * Each case here uses a condition that DOES refuse an enrolled agency --
       * suspension, a missing mandate, no terms whatsoever -- so a pass means
       * the gate is genuinely not being applied rather than being applied and
       * happening to say yes.
       */
      it('routes a call for a tenant with no billing profile at all', async () => {
        await prisma.agencyBillingProfile.deleteMany({ where: { tenantId } });
        await seedDidRoute('+15551230010');

        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/freeswitch/lookup?did=%2B15551230010',
          headers: { 'x-internal-key': INTERNAL_KEY },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().reject).toBeUndefined();
        expect(response.json().destination).toBe('1001');
      });

      it('routes a call for an unenrolled tenant that is suspended and has no mandate', async () => {
        // Both of these refuse an ENROLLED agency outright. Unenrolled, they
        // are simply not consulted.
        await prisma.agencyBillingProfile.update({
          where: { tenantId },
          data: {
            billingEnrolledAt: null,
            suspendedAt: new Date(),
            suspensionReason: 'would refuse an enrolled agency',
            achMandateStatus: 'NONE',
            achPaymentMethodId: null,
          },
        });
        await seedDidRoute('+15551230011');

        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/freeswitch/lookup?did=%2B15551230011',
          headers: { 'x-internal-key': INTERNAL_KEY },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().reject).toBeUndefined();
        expect(response.json().destination).toBe('1001');
      });

      it('creates the ringing call for an unenrolled tenant on the softphone path', async () => {
        await prisma.agencyBillingProfile.update({
          where: { tenantId },
          data: { billingEnrolledAt: null, suspendedAt: new Date() },
        });

        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/agent/call/incoming',
          payload: { tenantId, from: '+15559990002' },
        });

        expect(response.statusCode).toBe(201);
        expect(await prisma.call.count({ where: { tenantId } })).toBe(1);
      });

      it('records no hold event and sends no notification for an unenrolled tenant', async () => {
        await prisma.agencyBillingProfile.update({
          where: { tenantId },
          data: { billingEnrolledAt: null, suspendedAt: new Date() },
        });
        await seedDidRoute('+15551230012');

        for (let i = 0; i < 3; i++) {
          await app.inject({
            method: 'GET',
            url: '/api/v1/freeswitch/lookup?did=%2B15551230012',
            headers: { 'x-internal-key': INTERNAL_KEY },
          });
        }

        // Nothing happened, so nothing is recorded and nobody is told.
        expect(await prisma.deliveryHoldEvent.count({ where: { tenantId } })).toBe(0);
        expect(await prisma.billingNotification.count({ where: { tenantId } })).toBe(0);
      });
    });

    describe('the hold is recorded once, not once per refused call', () => {
      it('writes one delivery_hold_events row however many calls are refused', async () => {
        await seedDidRoute('+15551230005');
        await prisma.agencyBillingProfile.update({
          where: { tenantId },
          data: { suspendedAt: new Date() },
        });

        for (let i = 0; i < 5; i++) {
          await app.inject({
            method: 'GET',
            url: '/api/v1/freeswitch/lookup?did=%2B15551230005',
            headers: { 'x-internal-key': INTERNAL_KEY },
          });
        }

        const holds = await prisma.deliveryHoldEvent.findMany({ where: { tenantId } });
        expect(holds).toHaveLength(1);
        expect(holds[0].reason).toBe('ADMIN_SUSPENDED');

        const notices = await prisma.billingNotification.findMany({ where: { tenantId } });
        expect(notices).toHaveLength(1);
      });
    });
  }
);
