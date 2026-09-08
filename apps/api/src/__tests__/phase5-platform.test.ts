/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { createHmac } from 'node:crypto';

import { hash } from 'bcryptjs';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import type { ChargeRequest, PaymentGateway } from '../services/billing/ach.js';
import { recordPurchase } from '../services/billing/credit-ledger.js';
import { evaluateDeliveryGate } from '../services/billing/delivery-gate.js';
import { getPlatformOverview } from '../services/billing/delivery-view.js';
import { recordDispute } from '../services/billing/disputes.js';
import { settleAgencyForDeliveryDay } from '../services/billing/settlement.js';
import { maxDailyDebitFor } from '../services/billing/terms.js';
import { calendarDayBounds } from '../services/rating/calendar-day.js';
import { effectiveRate } from '../services/rating/rate-curve.js';
import { rateAgencyForClosedDay, recomputeFromRecord } from '../services/rating/rating-engine.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Phase 5: the platform admin's view, the rate offset, chargebacks and
 * onboarding.
 *
 * ── What this suite is for ───────────────────────────────────────────────────
 *
 * Five properties, and each of them is a thing somebody would otherwise have to
 * take on trust from a page:
 *
 *   1. A PLATFORM ADMIN WITH NO ACTING TENANT SEES EVERY AGENCY. Not a prompt
 *      to choose one. NetEnroll staff run the whole platform, and the switcher
 *      is a filter -- selecting an agency narrows, leaving returns to all of
 *      them. Asserted at the endpoints those three screens read.
 *
 *   2. AN AGENCY OWNER SEES ONLY THEIR OWN AGENCY, on every one of those
 *      screens, and is refused every platform surface. Asserted directly rather
 *      than inferred from the endpoints being gated: the page could change, the
 *      test says what the agency may see.
 *
 *   3. THE RATE OFFSET IS PART OF THE RATE, EVERYWHERE. On the rate change, the
 *      settlement, the export, the portal and the maximum daily debit. It is
 *      never a fee line, never a percentage on a total, and never itemised --
 *      and a completed settlement does not move when it changes.
 *
 *   4. A CHARGEBACK IS CONTAINED, NOT REVERSED. Delivery stops, the tenant is
 *      flagged as its own state, no overrun is extended -- and no ledger row is
 *      written, no credit is returned and no settlement figure changes.
 *      Delivery does NOT resume when the dispute closes.
 *
 *   5. ONBOARDING IS INTERNAL AND ORDERED. Enrolment names every missing
 *      prerequisite at once; an agency OWNER cannot create a user outside their
 *      own tenant, and cannot create a platform admin at all.
 */

const gate = databaseGate();
announceSkip('Phase 5: the platform view, the rate offset and chargebacks', gate);

const TEST_JWT_SECRET = 'phase5-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

/** A gateway that records every call. No real Stripe, and no real money. */
class FakeGateway implements PaymentGateway {
  readonly achCharges: ChargeRequest[] = [];
  readonly cardCharges: ChargeRequest[] = [];

  async chargeAchOffSession(request: ChargeRequest) {
    this.achCharges.push(request);
    return {
      ok: true,
      paymentIntentId: `pi_ach_${this.achCharges.length}`,
      status: 'processing',
      failureCode: null,
      failureMessage: null,
    };
  }

  async chargeCardOffSession(request: ChargeRequest) {
    this.cardCharges.push(request);
    return {
      ok: true,
      paymentIntentId: `pi_card_${this.cardCharges.length}`,
      status: 'succeeded',
      failureCode: null,
      failureMessage: null,
    };
  }

  async chargeCardOnSession(request: ChargeRequest) {
    this.cardCharges.push(request);
    return {
      ok: true,
      paymentIntentId: `pi_open_${this.cardCharges.length}`,
      status: 'succeeded',
      failureCode: null,
      failureMessage: null,
    };
  }

  async ensureCustomer() {
    return 'cus_fake';
  }

  async createAchSetupIntent() {
    return { id: 'seti_fake', clientSecret: 'seti_fake_secret' };
  }

  async describeAchMandate() {
    return {
      setupIntentStatus: 'succeeded',
      paymentMethodId: 'pm_fake',
      usable: true,
      bankName: 'Test Bank',
      last4: '6789',
      customerId: 'cus_fake',
    };
  }

  async createCardSetupIntent() {
    return { id: 'seti_card', clientSecret: 'seti_card_secret' };
  }

  async describeCardMandate() {
    return {
      setupIntentStatus: 'succeeded',
      paymentMethodId: 'pm_card',
      usable: true,
      brand: 'visa',
      last4: '4242',
      customerId: 'cus_fake',
    };
  }

  constructWebhookEvent() {
    return null;
  }

  isEnabled() {
    return true;
  }
}

describe('Phase 5 suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `Phase 5 suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)(
  'Phase 5: the platform view, the rate offset and chargebacks',
  () => {
    let prisma: ReturnType<typeof getPrismaClient>;
    let app: FastifyInstance;
    let gateway: FakeGateway;

    let ridgeline: { id: string; ownerId: string };
    let fairhaven: { id: string; ownerId: string };
    let fixture: { id: string; ownerId: string };
    let operatorId: string;

    let TODAY: string;
    let CLOSED_DAY: string;

    async function buildApp(): Promise<FastifyInstance> {
      const instance = Fastify();
      await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
      await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
      registerApiV1Auth(instance);

      const { registerDeliveryBillingRoutes } = await import('../routes/delivery-billing.js');
      await instance.register(registerDeliveryBillingRoutes);

      const { registerRatingRoutes } = await import('../routes/rating.js');
      await instance.register(registerRatingRoutes);

      const { registerPlatformRoutes } = await import('../routes/platform.js');
      await instance.register(registerPlatformRoutes);

      const { registerOnboardingRoutes } = await import('../routes/onboarding.js');
      await instance.register(registerOnboardingRoutes);

      const { registerAuthRoutes } = await import('../routes/auth.js');
      await instance.register(registerAuthRoutes);

      await instance.ready();
      return instance;
    }

    function tokenFor(userId: string, tenantId: string | null): Record<string, string> {
      return {
        authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${userId}@test.local` })}`,
      };
    }

    async function cleanDatabase() {
      for (const table of [
        'settlement_disputes',
        'agent_state_events',
        'billing_notifications',
        'delivery_hold_events',
        'settlement_payment_attempts',
        'application_credit_ledger',
        'daily_settlements',
        'agency_billing_profiles',
        'agency_profiles',
        'rating_review_flags',
        'rate_changes',
        'agency_rating_states',
        'rating_settings',
        'rate_curve_anchors',
        'rate_curve_versions',
        'insurance_carrier_applications',
        'tenant_activation_grants',
        'calls',
        'platform_acting_tenants',
        'platform_admins',
        'audit_logs',
        'user_roles',
        'users',
        'roles',
        'tenants',
      ]) {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
      }
    }

    async function ensureLaunchCurve() {
      const existing = await prisma.rateCurveVersion.findUnique({ where: { version: 1 } });
      if (!existing) {
        await prisma.rateCurveVersion.create({
          data: {
            id: '00000000-0000-4000-8000-00000000e001',
            version: 1,
            label: 'Launch curve',
            minimumClosingPct: 5,
            flatFromClosingPct: 15,
            anchors: {
              create: [
                { closingPct: 5, rate: 264 },
                { closingPct: 10, rate: 159 },
                { closingPct: 15, rate: 134 },
              ],
            },
          },
        });
      }

      await prisma.ratingSettings.upsert({
        where: { id: 'global' },
        create: {
          id: 'global',
          windowDeliveryDays: 3,
          activeCurveVersionId: '00000000-0000-4000-8000-00000000e001',
        },
        update: { activeCurveVersionId: '00000000-0000-4000-8000-00000000e001' },
      });
    }

    async function seedAgency(label: string, ownerRoleId: string, isNonProduction = false) {
      const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tenant = await prisma.tenant.create({
        data: { name: `${label} Insurance`, slug, status: 'ACTIVE', isNonProduction },
      });
      const owner = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: `principal@${slug}.local`,
          passwordHash: await hash('password123', 10),
          status: 'ACTIVE',
          roles: { create: { roleId: ownerRoleId } },
        },
      });
      return { id: tenant.id, ownerId: owner.id };
    }

    async function seedTerms(
      tenantId: string,
      overrides: Partial<{
        dailyBlockApplications: number;
        enrolled: boolean;
        rateOffset: number;
        paymentMethod: 'ACH' | 'CARD';
      }> = {}
    ) {
      const block = overrides.dailyBlockApplications ?? 45;
      const enrolled = overrides.enrolled ?? true;
      const rateOffset = overrides.rateOffset ?? 0;
      const paymentMethod = overrides.paymentMethod ?? 'ACH';

      const fields = {
        dailyBlockApplications: block,
        // The cap is what a full day at the ceiling costs at the EFFECTIVE
        // rate, which is the point of the arithmetic under test.
        maxDailyDebit: maxDailyDebitFor(block, 50, 134 + rateOffset),
        ceilingPctBelowThreshold: 50,
        rateOffset,
        paymentMethod,
        stripeCustomerId: 'cus_fake',
        achPaymentMethodId: 'pm_fake',
        achMandateStatus: 'ACTIVE' as const,
        achMandateVerifiedAt: new Date(),
        achBankName: 'Test Bank',
        achLast4: '6789',
        cardPaymentMethodId: 'pm_card',
        cardMandateStatus: 'ACTIVE' as const,
        cardMandateVerifiedAt: new Date(),
        cardBrand: 'visa',
        cardLast4: '4242',
        billingEnrolledAt: enrolled ? new Date() : null,
        chargesEnabled: enrolled,
      };

      return prisma.agencyBillingProfile.upsert({
        where: { tenantId },
        create: { tenantId, ...fields },
        update: fields,
      });
    }

    async function seedOpeningAgreement(tenantId: string, rate = 134) {
      return prisma.agencyRatingState.upsert({
        where: { tenantId },
        create: {
          tenantId,
          status: 'RATED',
          openingRate: rate,
          currentRate: rate,
          openingBlockApplications: 45,
        },
        update: { status: 'RATED', openingRate: rate, currentRate: rate },
      });
    }

    function middayOf(day: string, offsetMs = 0): Date {
      return new Date(calendarDayBounds(day).start.getTime() + 12 * 3600_000 + offsetMs);
    }

    let callSeq = 0;

    async function seedDeliveredCalls(tenantId: string, day: string, count: number) {
      for (let i = 0; i < count; i++) {
        callSeq += 1;
        await prisma.call.create({
          data: {
            tenantId,
            callSid: `sid-p5-${callSeq}-${Math.random().toString(36).slice(2, 8)}`,
            toNumber: '+15550000000',
            status: 'COMPLETED',
            direction: 'INBOUND',
            answeredAt: middayOf(day, i * 1000),
            endedAt: middayOf(day, i * 1000 + 120_000),
            connectedDuration: 120,
            blocked: false,
          },
        });
      }
    }

    let appSeq = 0;

    async function seedApplications(tenantId: string, day: string, count: number) {
      for (let i = 0; i < count; i++) {
        appSeq += 1;
        await prisma.insuranceCarrierApplication.create({
          data: {
            tenantId,
            firstName: 'Test',
            lastName: `Applicant ${appSeq}`,
            status: 'SUBMITTED',
            submittedAt: middayOf(day, i * 1000),
          },
        });
      }
    }

    beforeAll(async () => {
      app = await buildApp();
    });

    afterAll(async () => {
      await app?.close();
    });

    beforeEach(async () => {
      prisma = getPrismaClient();
      gateway = new FakeGateway();
      await cleanDatabase();
      await ensureLaunchCurve();

      const { currentCalendarDay, previousCalendarDay } = await import(
        '../services/rating/calendar-day.js'
      );
      TODAY = currentCalendarDay(new Date());
      CLOSED_DAY = previousCalendarDay(TODAY);

      const ownerRole = await prisma.role.create({
        data: { name: 'OWNER', description: 'OWNER role', permissions: ['admin:*'] },
      });
      await prisma.role.create({
        data: { name: 'AGENT', description: 'AGENT role', permissions: [] },
      });

      ridgeline = await seedAgency('Ridgeline', ownerRole.id);
      fairhaven = await seedAgency('Fairhaven', ownerRole.id);
      fixture = await seedAgency('Demo Organization', ownerRole.id, true);

      const operator = await prisma.user.create({
        data: { email: 'operator@netenroll.test', status: 'ACTIVE', tenantId: null },
      });
      operatorId = operator.id;
      await grantPlatformAdmin(operatorId, { note: 'phase 5 suite fixture' });
    });

    // ════════════════════════════════════════════════════════════════════════
    // 1. The platform admin's view is the platform, not a prompt
    // ════════════════════════════════════════════════════════════════════════
    describe('the platform-wide screens', () => {
      it('serves a platform admin with no acting tenant every agency on /delivery', async () => {
        /*
         * The failure this replaces: an operator with no agency selected was
         * told "Choose an agency" and could see nothing until they picked one.
         * That is backwards -- NetEnroll staff run the whole platform.
         *
         * `tenantId: null` on the token is exactly the state: authenticated,
         * holds the capability, has entered no agency.
         */
        await seedTerms(ridgeline.id);
        await seedTerms(fairhaven.id);
        await seedOpeningAgreement(ridgeline.id);
        await seedOpeningAgreement(fairhaven.id);
        await seedDeliveredCalls(ridgeline.id, TODAY, 10);
        await seedApplications(ridgeline.id, TODAY, 1);
        await seedDeliveredCalls(fairhaven.id, TODAY, 4);

        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/platform/delivery/overview',
          headers: tokenFor(operatorId, null),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json().data;

        // Every production agency, not a refusal and not one of them.
        const names = body.agencies.map((row: any) => row.name).sort();
        expect(names).toEqual(['Fairhaven Insurance', 'Ridgeline Insurance']);

        // Nothing anywhere in the response asks the operator to choose an
        // agency. The absence is the point: this used to be all they got.
        expect(JSON.stringify(body)).not.toMatch(/NO_ACTING_TENANT|Choose an agency/i);

        // The figures the brief names, per agency.
        const row = body.agencies.find((r: any) => r.name === 'Ridgeline Insurance');
        expect(row.deliveredCalls).toBe(10);
        expect(row.applications).toBe(1);
        expect(row.closingPct).toBeCloseTo(10, 4);
        expect(row).toHaveProperty('applicationsRemainingOnBlock');
        expect(row).toHaveProperty('overrunToday');
        expect(row).toHaveProperty('distanceToCeiling');
        expect(row.rate).toBe(134);

        // And the totals across the top.
        expect(body.totals.agencies).toBe(2);
        expect(body.totals.deliveredCalls).toBe(14);
        expect(body.totals.applications).toBe(1);
      });

      it('serves a platform admin with no acting tenant every agency on /rating', async () => {
        await seedTerms(ridgeline.id);
        await seedOpeningAgreement(ridgeline.id, 149);
        await seedOpeningAgreement(fairhaven.id, 134);
        await seedDeliveredCalls(ridgeline.id, TODAY, 10);
        await seedApplications(ridgeline.id, TODAY, 1);

        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/platform/rating/overview',
          headers: tokenFor(operatorId, null),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json().data;

        expect(body.agencies).toHaveLength(2);

        const row = body.agencies.find((r: any) => r.name === 'Ridgeline Insurance');
        // The three columns the brief names, side by side.
        expect(row).toHaveProperty('todayClosingPct');
        expect(row.currentRate).toBe(149);
        expect(row).toHaveProperty('trackingRate');
      });

      it('serves a platform admin with no acting tenant every agency on /delivery/settlements', async () => {
        await seedTerms(ridgeline.id);
        await seedTerms(fairhaven.id);
        await seedOpeningAgreement(ridgeline.id);
        await seedOpeningAgreement(fairhaven.id);
        await seedDeliveredCalls(ridgeline.id, CLOSED_DAY, 10);
        await seedApplications(ridgeline.id, CLOSED_DAY, 1);
        await seedDeliveredCalls(fairhaven.id, CLOSED_DAY, 10);
        await seedApplications(fairhaven.id, CLOSED_DAY, 1);

        for (const tenantId of [ridgeline.id, fairhaven.id]) {
          await settleAgencyForDeliveryDay({ tenantId, deliveryDay: CLOSED_DAY, prisma, gateway });
        }

        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/platform/delivery/settlements?from=${CLOSED_DAY}&to=${CLOSED_DAY}`,
          headers: tokenFor(operatorId, null),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json().data;

        expect(body.settlements).toHaveLength(2);
        // Each row names the agency it belongs to, or the table is unreadable.
        expect(body.settlements.map((r: any) => r.agency).sort()).toEqual([
          'Fairhaven Insurance',
          'Ridgeline Insurance',
        ]);
      });

      it('narrows all three screens to the agency an operator has entered, and widens again when they leave', async () => {
        await seedTerms(ridgeline.id);
        await seedTerms(fairhaven.id);
        await seedOpeningAgreement(ridgeline.id);
        await seedOpeningAgreement(fairhaven.id);
        await seedDeliveredCalls(ridgeline.id, CLOSED_DAY, 10);
        await seedApplications(ridgeline.id, CLOSED_DAY, 1);
        await seedDeliveredCalls(fairhaven.id, CLOSED_DAY, 10);
        await seedApplications(fairhaven.id, CLOSED_DAY, 1);
        for (const tenantId of [ridgeline.id, fairhaven.id]) {
          await settleAgencyForDeliveryDay({ tenantId, deliveryDay: CLOSED_DAY, prisma, gateway });
        }

        /*
         * Entering an agency, through the real switch.
         *
         * Deliberately NOT by minting a token that names the agency: for
         * platform staff the `PlatformActingTenant` row REPLACES whatever the
         * JWT says, so a token naming an agency gets an operator nothing. The
         * token below still names no tenant, and the selection row is what
         * narrows every screen -- which is the property worth exercising.
         */
        const { enterActingTenant, leaveActingTenant } = await import('../lib/platform-admin.js');
        await enterActingTenant(operatorId, ridgeline.id, {});
        const inside = tokenFor(operatorId, null);

        const delivery = await app.inject({
          method: 'GET',
          url: '/api/v1/platform/delivery/overview',
          headers: inside,
        });
        expect(delivery.json().data.agencies).toHaveLength(1);
        expect(delivery.json().data.agencies[0].name).toBe('Ridgeline Insurance');

        const rating = await app.inject({
          method: 'GET',
          url: '/api/v1/platform/rating/overview',
          headers: inside,
        });
        expect(rating.json().data.agencies).toHaveLength(1);

        const settlements = await app.inject({
          method: 'GET',
          url: '/api/v1/platform/delivery/settlements',
          headers: inside,
        });
        expect(settlements.json().data.settlements).toHaveLength(1);
        expect(settlements.json().data.settlements[0].agency).toBe('Ridgeline Insurance');

        // A query parameter cannot widen past the agency actually entered.
        const attempted = await app.inject({
          method: 'GET',
          url: `/api/v1/platform/delivery/settlements?agencyId=${fairhaven.id}`,
          headers: inside,
        });
        expect(attempted.json().data.settlements).toHaveLength(1);
        expect(attempted.json().data.settlements[0].agency).toBe('Ridgeline Insurance');

        // Leaving returns to every agency. Same routes, same token.
        await leaveActingTenant(operatorId, {});

        const widened = await app.inject({
          method: 'GET',
          url: '/api/v1/platform/delivery/overview',
          headers: tokenFor(operatorId, null),
        });
        expect(widened.json().data.agencies).toHaveLength(2);

        const widenedSettlements = await app.inject({
          method: 'GET',
          url: '/api/v1/platform/delivery/settlements',
          headers: tokenFor(operatorId, null),
        });
        expect(widenedSettlements.json().data.settlements).toHaveLength(2);
      });

      it('shows an agency OWNER only their own agency on every one of those screens', async () => {
        /*
         * Asserted directly rather than inferred from the endpoints being
         * gated. The gate could move; what an agency may see must not.
         */
        await seedTerms(ridgeline.id);
        await seedTerms(fairhaven.id);
        await seedOpeningAgreement(ridgeline.id);
        await seedOpeningAgreement(fairhaven.id);
        await seedDeliveredCalls(ridgeline.id, CLOSED_DAY, 10);
        await seedApplications(ridgeline.id, CLOSED_DAY, 1);
        await seedDeliveredCalls(fairhaven.id, CLOSED_DAY, 20);
        await seedApplications(fairhaven.id, CLOSED_DAY, 3);
        for (const tenantId of [ridgeline.id, fairhaven.id]) {
          await settleAgencyForDeliveryDay({ tenantId, deliveryDay: CLOSED_DAY, prisma, gateway });
        }

        const owner = tokenFor(ridgeline.ownerId, ridgeline.id);

        // The platform-wide screens are refused outright.
        for (const url of [
          '/api/v1/platform/delivery/overview',
          '/api/v1/platform/rating/overview',
          '/api/v1/platform/delivery/settlements',
          '/api/v1/platform/delivery/settlements.csv',
          '/api/v1/platform/delivery/agencies',
        ]) {
          const refused = await app.inject({ method: 'GET', url, headers: owner });
          expect(refused.statusCode, `${url} must refuse an agency OWNER`).toBe(403);
          // And the refusal leaks no other agency's name or id.
          expect(refused.body).not.toContain(fairhaven.id);
          expect(refused.body).not.toContain('Fairhaven');
        }

        // Their own screens answer, with their own figures and nobody else's.
        const own = await app.inject({
          method: 'GET',
          url: '/api/v1/delivery/settlements',
          headers: owner,
        });
        expect(own.statusCode).toBe(200);
        const rows = own.json().data;
        expect(rows).toHaveLength(1);
        expect(rows.every((row: any) => row.tenantId === ridgeline.id)).toBe(true);
        expect(own.body).not.toContain(fairhaven.id);

        const today = await app.inject({
          method: 'GET',
          url: '/api/v1/delivery/today',
          headers: owner,
        });
        expect(today.statusCode).toBe(200);
        expect(today.json().data.tenantId).toBe(ridgeline.id);
        expect(today.body).not.toContain(fairhaven.id);

        const rating = await app.inject({
          method: 'GET',
          url: '/api/v1/rating/summary',
          headers: owner,
        });
        expect(rating.statusCode).toBe(200);
        expect(rating.json().data.tenantId).toBe(ridgeline.id);
        expect(rating.body).not.toContain(fairhaven.id);
      });
    });

    // ════════════════════════════════════════════════════════════════════════
    // 2. Test tenants
    // ════════════════════════════════════════════════════════════════════════
    describe('non-production tenants', () => {
      it('excludes a tenant marked non-production from the platform totals', async () => {
        await seedTerms(ridgeline.id);
        await seedTerms(fixture.id);
        await seedOpeningAgreement(ridgeline.id);
        await seedOpeningAgreement(fixture.id);

        await seedDeliveredCalls(ridgeline.id, TODAY, 10);
        await seedApplications(ridgeline.id, TODAY, 1);
        // The fixture is busier than the real agency, so a total that included
        // it would be obviously wrong rather than plausibly wrong.
        await seedDeliveredCalls(fixture.id, TODAY, 90);
        await seedApplications(fixture.id, TODAY, 30);

        const hidden = await getPlatformOverview({ prisma });
        expect(hidden.agencies.map(a => a.name)).not.toContain('Demo Organization Insurance');
        expect(hidden.totals.deliveredCalls).toBe(10);
        expect(hidden.totals.applications).toBe(1);

        /*
         * Shown, and STILL excluded from the totals. Hiding the row and
         * excluding the number are two decisions and only the first is the
         * toggle -- a demo fixture is not platform revenue in either state.
         */
        const shown = await getPlatformOverview({ prisma, includeNonProduction: true });
        expect(shown.agencies.map(a => a.name)).toContain('Demo Organization Insurance');
        expect(shown.totals.deliveredCalls).toBe(10);
        expect(shown.totals.agenciesExcluded).toBe(1);
      });

      it('marks and unmarks a tenant without touching delivery or billing', async () => {
        await seedTerms(ridgeline.id);
        await seedOpeningAgreement(ridgeline.id);
        await recordPurchase(prisma, {
          tenantId: ridgeline.id,
          deliveryDay: TODAY,
          quantity: 45,
          unitRate: 134,
          stripePaymentIntentId: 'pi_seed',
          settlementId: null,
        });

        const before = await evaluateDeliveryGate(ridgeline.id, { prisma, record: false });
        expect(before.allowed).toBe(true);

        const marked = await app.inject({
          method: 'PUT',
          url: `/api/v1/platform/tenants/${ridgeline.id}/non-production`,
          headers: tokenFor(operatorId, null),
          payload: { isNonProduction: true, note: 'suite fixture' },
        });
        expect(marked.statusCode).toBe(200);
        expect(marked.json().data.isNonProduction).toBe(true);

        // Nothing about delivery or billing moved. It is a display decision.
        const after = await evaluateDeliveryGate(ridgeline.id, { prisma, record: false });
        expect(after.allowed).toBe(true);
        expect(after.enrolled).toBe(true);
        expect(after.balance).toBe(45);

        const unmarked = await app.inject({
          method: 'PUT',
          url: `/api/v1/platform/tenants/${ridgeline.id}/non-production`,
          headers: tokenFor(operatorId, null),
          payload: { isNonProduction: false },
        });
        expect(unmarked.json().data.isNonProduction).toBe(false);
      });

      it('reports every tenant with its call and application volume, and marks nobody', async () => {
        // The mechanism the brief asks for: a query the owner decides from.
        // It must not guess, so nothing here is marked by reading it.
        await seedDeliveredCalls(ridgeline.id, TODAY, 7);
        await seedApplications(ridgeline.id, TODAY, 2);

        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/platform/tenants/volume',
          headers: tokenFor(operatorId, null),
        });

        expect(response.statusCode).toBe(200);
        const rows = response.json().data;

        const row = rows.find((r: any) => r.name === 'Ridgeline Insurance');
        expect(row.callsTotal).toBe(7);
        expect(row.applicationsSubmitted).toBe(2);
        expect(row.isNonProduction).toBe(false);

        // Reading the report changed nothing.
        const stillUnmarked = await prisma.tenant.findMany({
          where: { isNonProduction: true },
          select: { id: true },
        });
        expect(stillUnmarked.map(t => t.id)).toEqual([fixture.id]);
      });
    });

    // ════════════════════════════════════════════════════════════════════════
    // 3. The rate offset
    // ════════════════════════════════════════════════════════════════════════
    describe('the rate offset', () => {
      it('adds the offset to the curve rate everywhere the rate appears', async () => {
        /*
         * Ridgeline carries a $6 offset; Fairhaven carries none. Both close at
         * exactly 10%, which the curve prices at $159. So one is charged $165
         * and the other $159, from the same measurement -- which is the whole
         * of what "priced through the rate" means.
         */
        await seedTerms(ridgeline.id, { rateOffset: 6 });
        await seedTerms(fairhaven.id, { rateOffset: 0 });
        await seedOpeningAgreement(ridgeline.id);
        await seedOpeningAgreement(fairhaven.id);

        for (const tenantId of [ridgeline.id, fairhaven.id]) {
          await seedDeliveredCalls(tenantId, CLOSED_DAY, 100);
          await seedApplications(tenantId, CLOSED_DAY, 10);
        }

        const withOffset = await rateAgencyForClosedDay({
          tenantId: ridgeline.id,
          closedCalendarDay: CLOSED_DAY,
          prisma,
        });
        const without = await rateAgencyForClosedDay({
          tenantId: fairhaven.id,
          closedCalendarDay: CLOSED_DAY,
          prisma,
        });

        expect(without.curveRate).toBe(159);
        expect(without.newRate).toBe(159);
        expect(withOffset.curveRate).toBe(159);
        expect(withOffset.newRate).toBe(165);

        // The agency's own state carries the effective rate: it is the price.
        const state = await prisma.agencyRatingState.findUnique({
          where: { tenantId: ridgeline.id },
        });
        expect(Number(state!.currentRate)).toBe(165);

        // And the portal's summary reports it, with the two halves visible.
        const summary = await app.inject({
          method: 'GET',
          url: '/api/v1/rating/summary',
          headers: tokenFor(ridgeline.ownerId, ridgeline.id),
        });
        expect(summary.json().data.currentRate).toBe(165);
        expect(summary.json().data.curveRate).toBe(159);
        expect(summary.json().data.rateOffset).toBe(6);
      });

      it('stores the curve rate and the offset separately, and recomputes from the row', async () => {
        await seedTerms(ridgeline.id, { rateOffset: 6 });
        await seedOpeningAgreement(ridgeline.id);
        await seedDeliveredCalls(ridgeline.id, CLOSED_DAY, 100);
        await seedApplications(ridgeline.id, CLOSED_DAY, 10);

        const rated = await rateAgencyForClosedDay({
          tenantId: ridgeline.id,
          closedCalendarDay: CLOSED_DAY,
          prisma,
        });

        const row = await prisma.rateChange.findUnique({ where: { id: rated.rateChangeId } });
        expect(Number(row!.curveRate)).toBe(159);
        expect(Number(row!.rateOffset)).toBe(6);
        expect(Number(row!.newRate)).toBe(165);
        // The row's own arithmetic adds up.
        expect(Number(row!.curveRate) + Number(row!.rateOffset)).toBe(Number(row!.newRate));

        /*
         * The dispute answer: re-derive the price from the row and the curve
         * version the row names, touching no live data. It must land on the
         * stored rate, offset included.
         */
        const recomputed = await recomputeFromRecord(rated.rateChangeId, prisma);
        expect(recomputed.curveRate).toBe(159);
        expect(recomputed.rateOffset).toBe(6);
        expect(recomputed.rate).toBe(165);
        expect(recomputed.matchesStoredRate).toBe(true);

        /*
         * And it stays true after the agency's terms change. The recomputation
         * reads the offset off the ROW, never off the profile -- a price that
         * could be restated by a later renegotiation is not a record.
         */
        await prisma.agencyBillingProfile.update({
          where: { tenantId: ridgeline.id },
          data: { rateOffset: 25 },
        });

        const again = await recomputeFromRecord(rated.rateChangeId, prisma);
        expect(again.rateOffset).toBe(6);
        expect(again.rate).toBe(165);
        expect(again.matchesStoredRate).toBe(true);
      });

      it('does not alter a completed settlement when the offset changes', async () => {
        await seedTerms(ridgeline.id, { rateOffset: 6 });
        await seedOpeningAgreement(ridgeline.id);
        await seedDeliveredCalls(ridgeline.id, CLOSED_DAY, 100);
        await seedApplications(ridgeline.id, CLOSED_DAY, 10);

        const settled = await settleAgencyForDeliveryDay({
          tenantId: ridgeline.id,
          deliveryDay: CLOSED_DAY,
          prisma,
          gateway,
        });

        expect(settled.rate).toBe(165);
        expect(settled.curveRate).toBe(159);
        expect(settled.rateOffset).toBe(6);

        const before = await prisma.dailySettlement.findUnique({
          where: { id: settled.settlementId! },
        });

        // The agency renegotiates. Every figure on the settled day stands.
        await prisma.agencyBillingProfile.update({
          where: { tenantId: ridgeline.id },
          data: { rateOffset: 40 },
        });

        const after = await prisma.dailySettlement.findUnique({
          where: { id: settled.settlementId! },
        });

        expect(Number(after!.rate)).toBe(Number(before!.rate));
        expect(Number(after!.curveRate)).toBe(Number(before!.curveRate));
        expect(Number(after!.rateOffset)).toBe(6);
        expect(Number(after!.totalCharged)).toBe(Number(before!.totalCharged));

        /*
         * And the database refuses to move them at all. This is the property,
         * not the convention: the immutability trigger now guards `curveRate`
         * and `rateOffset` alongside `rate`.
         */
        await expect(
          prisma.$executeRawUnsafe(
            `UPDATE "daily_settlements" SET "rateOffset" = 40 WHERE "id" = '${settled.settlementId!}'`
          )
        ).rejects.toThrow(/immutable/i);
      });

      it('reflects the offset in the maximum daily debit', async () => {
        /*
         * The Insertion Order figure is what a full day at the ceiling costs,
         * and a day at the ceiling costs the EFFECTIVE rate. Computing it off
         * the curve rate alone leaves it short by the offset times the whole
         * block plus ceiling, every day -- so a settlement at the ceiling would
         * halt on a cap that was never the real cost of the day.
         */
        expect(maxDailyDebitFor(45, 50, 134)).toBe(8_978);
        expect(maxDailyDebitFor(45, 50, effectiveRate(134, 6)!)).toBe(9_380);

        await seedTerms(ridgeline.id, { rateOffset: 6 });

        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/platform/delivery/agencies/${ridgeline.id}/terms?rate=134`,
          headers: tokenFor(operatorId, null),
        });

        const body = response.json().data;
        expect(body.rateOffset).toBe(6);
        // (45 + 22) x $140, not x $134.
        expect(body.computedAtEffectiveRate).toBe(140);
        expect(body.computedMaxDailyDebitAtRate).toBe(9_380);
        expect(body.maxDailyDebit).toBe(9_380);
      });

      it('carries the curve rate and the offset in the export, with no fee column', async () => {
        await seedTerms(ridgeline.id, { rateOffset: 6 });
        await seedOpeningAgreement(ridgeline.id);
        await seedDeliveredCalls(ridgeline.id, CLOSED_DAY, 100);
        await seedApplications(ridgeline.id, CLOSED_DAY, 10);
        await settleAgencyForDeliveryDay({
          tenantId: ridgeline.id,
          deliveryDay: CLOSED_DAY,
          prisma,
          gateway,
        });

        const csv = await app.inject({
          method: 'GET',
          url: `/api/v1/platform/delivery/settlements.csv?from=${CLOSED_DAY}&to=${CLOSED_DAY}`,
          headers: tokenFor(operatorId, null),
        });

        const [header, row] = csv.body.split('\n');
        expect(header).toContain('"rate"');
        expect(header).toContain('"curve_rate"');
        expect(header).toContain('"rate_offset"');

        // There is no fee, surcharge or adjustment column, and there is not
        // going to be one. An itemised fee added to a price is a surcharge.
        expect(header.toLowerCase()).not.toMatch(/fee|surcharge|adjustment|convenience/);

        const cells = row.split(',');
        const rateIndex = header.split(',').indexOf('"rate"');
        const curveIndex = header.split(',').indexOf('"curve_rate"');
        const offsetIndex = header.split(',').indexOf('"rate_offset"');
        expect(cells[rateIndex]).toBe('"165"');
        expect(cells[curveIndex]).toBe('"159"');
        expect(cells[offsetIndex]).toBe('"6"');
      });

      it('refuses a negative offset, and takes none from an agency', async () => {
        await seedTerms(ridgeline.id);

        const negative = await app.inject({
          method: 'PUT',
          url: `/api/v1/platform/delivery/agencies/${ridgeline.id}/terms`,
          headers: tokenFor(operatorId, null),
          payload: { dailyBlockApplications: 45, maxDailyDebit: 8978, rateOffset: -5 },
        });
        expect(negative.statusCode).toBe(400);

        // An agency OWNER cannot set its own price in either direction.
        const byAgency = await app.inject({
          method: 'PUT',
          url: `/api/v1/platform/delivery/agencies/${ridgeline.id}/terms`,
          headers: tokenFor(ridgeline.ownerId, ridgeline.id),
          payload: { dailyBlockApplications: 45, maxDailyDebit: 8978, rateOffset: 0 },
        });
        expect(byAgency.statusCode).toBe(403);

        const profile = await prisma.agencyBillingProfile.findUnique({
          where: { tenantId: ridgeline.id },
        });
        expect(Number(profile!.rateOffset)).toBe(0);
      });

      it('gives a card-paying agency a lower ceiling that does not rise with settlement history', async () => {
        /*
         * Chargeback exposure. An ACH agency with ten clean settlements earns
         * the doubled ceiling; a card-paying one does not, because a run of
         * clean card settlements is not the evidence the schedule treats it as
         * -- any of them can be taken back.
         */
        await seedTerms(ridgeline.id, { paymentMethod: 'CARD' });
        await seedOpeningAgreement(ridgeline.id);

        const { loadAgencyTerms } = await import('../services/billing/terms.js');

        const card = await loadAgencyTerms(ridgeline.id, { prisma });
        expect(card.ceilingPct).toBe(25);
        expect(card.ceilingSource).toBe('CARD_EXPOSURE');
        expect(card.ceilingApplications).toBe(11); // floor(45 x 0.25)

        // Twelve clean settlements later, still 25%.
        const { previousCalendarDay } = await import('../services/rating/calendar-day.js');
        let day = CLOSED_DAY;
        for (let i = 0; i < 12; i++) {
          await prisma.dailySettlement.create({
            data: {
              tenantId: ridgeline.id,
              deliveryDay: day,
              deliveredCalls: 10,
              submittedApplications: 1,
              windowDeliveryDays: 3,
              windowDaysFound: 3,
              windowDayKeys: [],
              maxDailyDebit: 8978,
              paymentStatus: 'SUCCEEDED',
            },
          });
          day = previousCalendarDay(day);
        }

        const stillCard = await loadAgencyTerms(ridgeline.id, { prisma });
        expect(stillCard.consecutiveCleanSettlements).toBeGreaterThanOrEqual(10);
        expect(stillCard.ceilingPct).toBe(25);
        expect(stillCard.ceilingSource).toBe('CARD_EXPOSURE');
      });
    });

    // ════════════════════════════════════════════════════════════════════════
    // 4. Chargebacks
    // ════════════════════════════════════════════════════════════════════════
    describe('a card chargeback', () => {
      /** Sign a payload the way Stripe does, so the real route can verify it. */
      function stripeSignature(payload: string, secret: string): string {
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = createHmac('sha256', secret)
          .update(`${timestamp}.${payload}`)
          .digest('hex');
        return `t=${timestamp},v1=${signature}`;
      }

      async function settleAndDispute(): Promise<{
        settlementId: string;
        paymentIntentId: string;
      }> {
        await seedTerms(ridgeline.id, { paymentMethod: 'CARD' });
        await seedOpeningAgreement(ridgeline.id);
        await seedDeliveredCalls(ridgeline.id, CLOSED_DAY, 100);
        await seedApplications(ridgeline.id, CLOSED_DAY, 10);

        const settled = await settleAgencyForDeliveryDay({
          tenantId: ridgeline.id,
          deliveryDay: CLOSED_DAY,
          prisma,
          gateway,
        });

        const row = await prisma.dailySettlement.findUnique({
          where: { id: settled.settlementId! },
        });

        return { settlementId: settled.settlementId!, paymentIntentId: row!.stripePaymentIntentId! };
      }

      it('suspends delivery, flags the tenant, and changes no ledger row and no settlement figure', async () => {
        const { settlementId, paymentIntentId } = await settleAndDispute();

        const ledgerBefore = await prisma.applicationCreditLedgerEntry.findMany({
          where: { tenantId: ridgeline.id },
          orderBy: { createdAt: 'asc' },
        });
        const settlementBefore = await prisma.dailySettlement.findUnique({
          where: { id: settlementId },
        });
        expect(ledgerBefore.length).toBeGreaterThan(0);

        await recordDispute({
          prisma,
          tenantId: ridgeline.id,
          settlementId,
          facts: {
            stripeDisputeId: 'dp_test_1',
            stripeChargeId: 'ch_test_1',
            stripePaymentIntentId: paymentIntentId,
            amount: 1_650,
            reason: 'fraudulent',
            stripeStatus: 'needs_response',
            closed: false,
          },
        });

        // Delivery stops immediately, with its own reason.
        const decision = await evaluateDeliveryGate(ridgeline.id, { prisma, record: false });
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe('PAYMENT_DISPUTED');
        expect(decision.disputed).toBe(true);

        // It is its own state on the platform view, not just "suspended".
        const overview = await getPlatformOverview({ prisma });
        const row = overview.agencies.find(a => a.tenantId === ridgeline.id)!;
        expect(row.flags.disputed).toBe(true);
        expect(row.dispute!.count).toBe(1);
        expect(row.dispute!.amount).toBe(1_650);

        // Platform admins were told. The agency was not: a chargeback is
        // NetEnroll's to answer, and telling a floor before anybody has looked
        // is alarm rather than information.
        const notice = await prisma.billingNotification.findFirst({
          where: { tenantId: ridgeline.id, kind: 'PAYMENT_DISPUTE_OPENED' },
        });
        expect(notice).not.toBeNull();
        expect(notice!.toPlatform).toBe(true);
        expect(notice!.toAgency).toBe(false);

        /*
         * And the thing this whole design turns on: NOTHING WAS REVERSED.
         * The ledger is byte-for-byte what it was, and every figure on the
         * settlement stands. Consumed credits stay consumed.
         */
        const ledgerAfter = await prisma.applicationCreditLedgerEntry.findMany({
          where: { tenantId: ridgeline.id },
          orderBy: { createdAt: 'asc' },
        });
        expect(ledgerAfter).toHaveLength(ledgerBefore.length);
        expect(ledgerAfter.map(r => `${r.id}:${r.entryType}:${r.quantity}`)).toEqual(
          ledgerBefore.map(r => `${r.id}:${r.entryType}:${r.quantity}`)
        );

        const settlementAfter = await prisma.dailySettlement.findUnique({
          where: { id: settlementId },
        });
        expect(Number(settlementAfter!.totalCharged)).toBe(Number(settlementBefore!.totalCharged));
        expect(Number(settlementAfter!.rate)).toBe(Number(settlementBefore!.rate));
        expect(settlementAfter!.paymentStatus).toBe(settlementBefore!.paymentStatus);

        // There is no ledger entry type for a chargeback, and there is not
        // going to be one. Asserted from the database's own enum labels.
        const labels = await prisma.$queryRawUnsafe<Array<{ enumlabel: string }>>(
          `SELECT enumlabel FROM pg_enum e
             JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'CreditLedgerEntryType'`
        );
        expect(labels.map(l => l.enumlabel).sort()).toEqual([
          'CONSUMPTION',
          'DRY_RUN_CLOSEOUT',
          'OVERRUN',
          'PURCHASE',
        ]);
      });

      it('extends no overrun at all to a tenant with an open dispute', async () => {
        const { settlementId, paymentIntentId } = await settleAndDispute();

        const before = await evaluateDeliveryGate(ridgeline.id, { prisma, record: false });
        expect(before.overrunCeiling).toBeGreaterThan(0);

        await recordDispute({
          prisma,
          tenantId: ridgeline.id,
          settlementId,
          facts: {
            stripeDisputeId: 'dp_test_2',
            stripeChargeId: 'ch_test_2',
            stripePaymentIntentId: paymentIntentId,
            amount: 1_650,
            reason: 'fraudulent',
            stripeStatus: 'needs_response',
            closed: false,
          },
        });

        const after = await evaluateDeliveryGate(ridgeline.id, { prisma, record: false });
        // Withdrawn, not reduced. Overrun is unsecured credit, and an agency
        // that has just taken a payment back is the one case where extending
        // more of it is indefensible.
        expect(after.overrunCeiling).toBe(0);
        expect(after.overrunRemaining).toBe(0);
        expect(after.overrunWithheldForUnpaidSettlement).toBe(true);
      });

      it('does not resume delivery when the dispute closes, even in our favour', async () => {
        const { settlementId, paymentIntentId } = await settleAndDispute();

        const facts = {
          stripeDisputeId: 'dp_test_3',
          stripeChargeId: 'ch_test_3',
          stripePaymentIntentId: paymentIntentId,
          amount: 1_650,
          reason: 'fraudulent',
        };

        await recordDispute({
          prisma,
          tenantId: ridgeline.id,
          settlementId,
          facts: { ...facts, stripeStatus: 'needs_response', closed: false },
        });

        // Stripe decides in our favour and closes it.
        await recordDispute({
          prisma,
          tenantId: ridgeline.id,
          settlementId,
          facts: { ...facts, stripeStatus: 'won', closed: true },
        });

        const dispute = await prisma.settlementDispute.findUnique({
          where: { stripeDisputeId: 'dp_test_3' },
        });
        expect(dispute!.status).toBe('WON');
        expect(dispute!.closedAt).not.toBeNull();
        // Nobody has looked at it, so delivery is still stopped.
        expect(dispute!.deliveryResumedAt).toBeNull();

        const stillStopped = await evaluateDeliveryGate(ridgeline.id, { prisma, record: false });
        expect(stillStopped.allowed).toBe(false);
        expect(stillStopped.reason).toBe('PAYMENT_DISPUTED');

        // Only an explicit platform-admin act starts it again.
        const stoodDown = await app.inject({
          method: 'POST',
          url: `/api/v1/platform/delivery/agencies/${ridgeline.id}/disputes/stand-down`,
          headers: tokenFor(operatorId, null),
          payload: { note: 'reviewed, account retained' },
        });
        expect(stoodDown.statusCode).toBe(200);
        // And standing down returns nothing to anybody.
        expect(stoodDown.json().data.creditsReturned).toBe(0);
        expect(stoodDown.json().data.settlementsChanged).toBe(0);

        const resumed = await evaluateDeliveryGate(ridgeline.id, { prisma, record: false });
        expect(resumed.disputed).toBe(false);
        expect(resumed.reason).not.toBe('PAYMENT_DISPUTED');

        // An agency cannot stand down its own chargeback.
        const byAgency = await app.inject({
          method: 'POST',
          url: `/api/v1/platform/delivery/agencies/${ridgeline.id}/disputes/stand-down`,
          headers: tokenFor(ridgeline.ownerId, ridgeline.id),
          payload: {},
        });
        expect(byAgency.statusCode).toBe(403);
      });

      it('records one dispute however many times Stripe delivers the webhook', async () => {
        const { settlementId, paymentIntentId } = await settleAndDispute();

        const facts = {
          stripeDisputeId: 'dp_test_4',
          stripeChargeId: 'ch_test_4',
          stripePaymentIntentId: paymentIntentId,
          amount: 1_650,
          reason: 'fraudulent',
          stripeStatus: 'needs_response',
          closed: false,
        };

        const first = await recordDispute({ prisma, tenantId: ridgeline.id, settlementId, facts });
        const second = await recordDispute({ prisma, tenantId: ridgeline.id, settlementId, facts });

        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.disputeId).toBe(first.disputeId);

        const all = await prisma.settlementDispute.findMany({ where: { tenantId: ridgeline.id } });
        expect(all).toHaveLength(1);
      });

      it('refuses a webhook it cannot verify, and stops no delivery on one', async () => {
        await seedTerms(ridgeline.id);
        await seedOpeningAgreement(ridgeline.id);

        const webhookApp = Fastify();
        const { registerStripeWebhookRoutes } = await import('../routes/stripe-webhooks.js');
        await webhookApp.register(registerStripeWebhookRoutes);
        await webhookApp.ready();

        try {
          const body = JSON.stringify({
            type: 'charge.dispute.created',
            data: { object: { id: 'dp_forged', amount: 500_000 } },
          });

          // No signature at all.
          const unsigned = await webhookApp.inject({
            method: 'POST',
            url: '/api/v1/webhooks/stripe',
            headers: { 'content-type': 'application/json' },
            payload: body,
          });
          expect(unsigned.statusCode).toBe(400);

          // A signature computed with the wrong secret.
          process.env.STRIPE_WEBHOOK_SECRET = 'whsec_phase5_suite';
          const forged = await webhookApp.inject({
            method: 'POST',
            url: '/api/v1/webhooks/stripe',
            headers: {
              'content-type': 'application/json',
              'stripe-signature': stripeSignature(body, 'whsec_the_wrong_one'),
            },
            payload: body,
          });
          expect(forged.statusCode).toBe(400);

          /*
           * An unverified dispute webhook would let anybody who can reach this
           * URL stop an agency's delivery, so the refusal has to be before
           * anything is read out of the payload.
           */
          const disputes = await prisma.settlementDispute.count();
          expect(disputes).toBe(0);
          const decision = await evaluateDeliveryGate(ridgeline.id, { prisma, record: false });
          expect(decision.disputed).toBe(false);
        } finally {
          delete process.env.STRIPE_WEBHOOK_SECRET;
          await webhookApp.close();
        }
      });
    });

    // ════════════════════════════════════════════════════════════════════════
    // 5. Onboarding
    // ════════════════════════════════════════════════════════════════════════
    describe('onboarding', () => {
      it('refuses enrolment with every missing prerequisite named at once', async () => {
        /*
         * An operator enrolling an agency at 9am should not discover the list
         * one failed request at a time. Enrolment takes effect on the next call
         * offered, so enrolling an agency that fails any of these stops its
         * phones that second.
         */
        await prisma.agencyBillingProfile.create({
          data: {
            tenantId: ridgeline.id,
            dailyBlockApplications: 0,
            maxDailyDebit: 0,
          },
        });

        const response = await app.inject({
          method: 'POST',
          url: `/api/v1/platform/delivery/agencies/${ridgeline.id}/enrol`,
          headers: tokenFor(operatorId, null),
          payload: { note: 'too early' },
        });

        expect(response.statusCode).toBe(409);
        const codes = response.json().error.blockers.map((b: any) => b.code).sort();
        expect(codes).toEqual([
          'NO_DAILY_BLOCK',
          'NO_MAX_DAILY_DEBIT',
          'NO_OPENING_RATE',
          'NO_VALID_MANDATE',
        ]);

        // And nothing moved.
        const profile = await prisma.agencyBillingProfile.findUnique({
          where: { tenantId: ridgeline.id },
        });
        expect(profile!.billingEnrolledAt).toBeNull();
      });

      it('walks an agency from nothing to enrolled, refusing each step out of order', async () => {
        const platform = tokenFor(operatorId, null);

        // Terms before the agency itself: refused.
        const early = await app.inject({
          method: 'PUT',
          url: `/api/v1/platform/onboarding/agencies/${fairhaven.id}/terms`,
          headers: platform,
          payload: {
            openingRate: 134,
            rateOffset: 6,
            openingBlockApplications: 45,
            dailyBlockApplications: 45,
            ceilingPct: 50,
          },
        });
        expect(early.statusCode).toBe(409);
        expect(early.json().error.code).toBe('STEP_OUT_OF_ORDER');

        // a. The agency.
        const created = await app.inject({
          method: 'POST',
          url: '/api/v1/platform/onboarding/agencies',
          headers: platform,
          payload: {
            name: 'Northgate',
            legalName: 'Northgate Insurance Services LLC',
            state: 'TX',
            contactName: 'Dana Reyes',
            contactEmail: 'dana@northgate.example',
            contactPhone: '+15125550100',
            licensedAgentCount: 45,
            deliveryDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
            deliveryStartTime: '09:00',
            deliveryEndTime: '18:00',
          },
        });
        expect(created.statusCode).toBe(201);
        const tenantId = created.json().data.tenantId;

        const stepState = (body: any, id: string) =>
          body.steps.find((s: any) => s.id === id).state;

        expect(stepState(created.json().data, 'TENANT')).toBe('COMPLETE');
        expect(stepState(created.json().data, 'TERMS')).toBe('READY');
        expect(stepState(created.json().data, 'ENROL')).toBe('BLOCKED');

        // b. Terms, including the offset and the maximum daily debit.
        const terms = await app.inject({
          method: 'PUT',
          url: `/api/v1/platform/onboarding/agencies/${tenantId}/terms`,
          headers: platform,
          payload: {
            openingRate: 134,
            rateOffset: 6,
            openingBlockApplications: 45,
            dailyBlockApplications: 45,
            ceilingPct: 50,
          },
        });
        expect(terms.statusCode).toBe(200);
        const termsBody = terms.json().data;
        expect(termsBody.rateOffset).toBe(6);
        expect(termsBody.effectiveRate).toBe(140);
        expect(termsBody.ceilingApplications).toBe(22);
        // (45 + 22) x $140. Computed and shown, stored as an explicit figure.
        expect(termsBody.computedMaxDailyDebit).toBe(9_380);
        expect(termsBody.maxDailyDebit).toBe(9_380);

        const stored = await prisma.agencyBillingProfile.findUnique({ where: { tenantId } });
        expect(Number(stored!.maxDailyDebit)).toBe(9_380);

        // c. Payment method.
        const payment = await app.inject({
          method: 'PUT',
          url: `/api/v1/platform/onboarding/agencies/${tenantId}/payment-method`,
          headers: platform,
          payload: { paymentMethod: 'CARD' },
        });
        expect(payment.statusCode).toBe(200);
        expect(payment.json().data.paymentMethod).toBe('CARD');
        // Still blocked: the agency has not saved a card yet, and the step says
        // so rather than reporting itself done.
        expect(stepState(payment.json().data.onboarding, 'PAYMENT_METHOD')).toBe('READY');

        await prisma.agencyBillingProfile.update({
          where: { tenantId },
          data: {
            stripeCustomerId: 'cus_fake',
            cardPaymentMethodId: 'pm_card',
            cardMandateStatus: 'ACTIVE',
            cardMandateVerifiedAt: new Date(),
            cardBrand: 'visa',
            cardLast4: '4242',
          },
        });

        // d. The owner's activation grant, through the existing mechanism.
        const owner = await app.inject({
          method: 'POST',
          url: `/api/v1/platform/onboarding/agencies/${tenantId}/owner`,
          headers: platform,
          payload: { email: 'principal@northgate.example' },
        });
        expect(owner.statusCode).toBe(201);
        const token = owner.json().data.activationToken;
        expect(typeof token).toBe('string');

        const grant = await prisma.tenantActivationGrant.findFirst({ where: { tenantId } });
        expect(grant!.roleName).toBe('OWNER');
        expect(grant!.email).toBe('principal@northgate.example');
        // Only the hash is stored. A database dump contains no working links.
        expect(grant!.tokenHash).not.toBe(token);
        expect(JSON.stringify(grant)).not.toContain(token);
        // And no second invitation path was built: the grant carries the tenant.
        expect(grant!.stripeSessionId).toBeNull();

        // e. Enrol, through the existing route and its prerequisite check.
        const enrolled = await app.inject({
          method: 'POST',
          url: `/api/v1/platform/delivery/agencies/${tenantId}/enrol`,
          headers: platform,
          payload: { note: 'IO signed' },
        });
        expect(enrolled.statusCode).toBe(200);
        expect(enrolled.json().data.enrolled).toBe(true);
        // Charging is a second switch and stays off.
        expect(enrolled.json().data.chargesEnabled).toBe(false);

        // Every step wrote an AuditLog row naming the operator.
        const audits = await prisma.auditLog.findMany({
          where: { tenantId, userId: operatorId },
          select: { action: true },
        });
        expect(audits.map(a => a.action).sort()).toEqual([
          'platform.delivery.enrolled',
          'platform.onboarding.owner.invited',
          'platform.onboarding.payment_method.recorded',
          'platform.onboarding.tenant.created',
          'platform.onboarding.terms.recorded',
        ]);
      });

      it('refuses an agency OWNER a user outside their tenant, and a platform admin anywhere', async () => {
        const owner = tokenFor(ridgeline.ownerId, ridgeline.id);

        /*
         * There is no `tenantId` field in this body and there never was: the
         * tenant is the caller's own session. So the way an OWNER would create
         * a user in another agency is to name one, and there is nothing to
         * name -- asserted by sending it anyway and checking where the grant
         * landed.
         */
        const issued = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/activation-grants',
          headers: owner,
          payload: { email: 'agent@ridgeline.example', role: 'AGENT', tenantId: fairhaven.id },
        });
        expect(issued.statusCode).toBe(201);

        const grant = await prisma.tenantActivationGrant.findFirst({
          where: { email: 'agent@ridgeline.example' },
        });
        expect(grant!.tenantId).toBe(ridgeline.id);
        expect(grant!.tenantId).not.toBe(fairhaven.id);
        expect(grant!.roleName).toBe('AGENT');

        // An agency invites AGENTS. A second principal is arranged with
        // NetEnroll, who issues that invitation from the platform surface.
        const asOwner = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/activation-grants',
          headers: owner,
          payload: { email: 'coowner@ridgeline.example', role: 'OWNER' },
        });
        expect(asOwner.statusCode).toBe(403);

        /*
         * And a platform admin cannot be created by any grant at all: the
         * capability is a `PlatformAdmin` row granted by a command on the host,
         * not a role, so there is no value of `role` that confers it.
         */
        const asPlatform = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/activation-grants',
          headers: owner,
          payload: { email: 'staff@netenroll.example', role: 'PLATFORM_ADMIN' },
        });
        expect(asPlatform.statusCode).toBe(403);

        expect(
          await prisma.tenantActivationGrant.count({
            where: { email: { in: ['coowner@ridgeline.example', 'staff@netenroll.example'] } },
          })
        ).toBe(0);

        // The onboarding surface, which does mint OWNER grants, is refused too.
        const onboarding = await app.inject({
          method: 'POST',
          url: `/api/v1/platform/onboarding/agencies/${fairhaven.id}/owner`,
          headers: owner,
          payload: { email: 'principal@fairhaven.example' },
        });
        expect(onboarding.statusCode).toBe(403);

        const platformAdmins = await prisma.platformAdmin.count();
        expect(platformAdmins).toBe(1); // the suite's operator, and nobody else
      });

      it('refuses an agency OWNER every onboarding route', async () => {
        const owner = tokenFor(ridgeline.ownerId, ridgeline.id);

        for (const [method, url] of [
          ['GET', '/api/v1/platform/onboarding/agencies'],
          ['POST', '/api/v1/platform/onboarding/agencies'],
          ['PUT', `/api/v1/platform/onboarding/agencies/${fairhaven.id}/terms`],
          ['PUT', `/api/v1/platform/onboarding/agencies/${fairhaven.id}/payment-method`],
          ['PUT', `/api/v1/platform/tenants/${fairhaven.id}/non-production`],
        ] as const) {
          const refused = await app.inject({
            method,
            url,
            headers: owner,
            payload: {},
          });
          expect(refused.statusCode, `${method} ${url}`).toBe(403);
        }

        // Nothing was created and nothing was marked.
        expect(await prisma.agencyProfile.count()).toBe(0);
        expect(await prisma.tenant.count({ where: { isNonProduction: true } })).toBe(1);
      });
    });
  }
);
