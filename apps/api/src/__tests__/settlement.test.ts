/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { hash } from 'bcryptjs';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import type { ChargeRequest, PaymentGateway } from '../services/billing/ach.js';
import {
  consumeCreditForApplication,
  creditBalance,
  recordPurchase,
} from '../services/billing/credit-ledger.js';
import { evaluateDeliveryGate } from '../services/billing/delivery-gate.js';
import {
  runDailySettlement,
  settleAgencyForDeliveryDay,
} from '../services/billing/settlement.js';
import {
  loadAgencyTerms,
  maxDailyDebitFor,
  overrunCeilingApplications,
} from '../services/billing/terms.js';
import { businessDayPeriodEnd } from '../services/rating/business-day.js';
import { calendarDayBounds, currentCalendarDay } from '../services/rating/calendar-day.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Phase 3: the ledger, Overrun, delivery gating and the daily settlement.
 *
 * ── What this suite is for ───────────────────────────────────────────────────
 *
 * Phase 2 made the numbers correct. This charges real money against them,
 * off-session, against real bank accounts, with no refund path in the product.
 * Every defect here is one a customer sees on a bank statement, so the
 * properties below are asserted against a real database with real concurrency
 * rather than against a mock that agrees with the code by construction:
 *
 *   1. IDEMPOTENCY. The settlement job run twice for one agency and one
 *      Delivery Day charges once. Asserted by starting two runs together and
 *      counting the gateway's calls -- not by reading a flag the code sets.
 *   2. NO CREDIT IS SPENT TWICE. Concurrent consumptions of the last credit
 *      produce one consumption and one overrun. The guarantee is a unique
 *      index, so the test exercises the index.
 *   3. THE CEILING STOPS DELIVERY, and a call already connected is untouched.
 *   4. A FAILED DEBIT HOLDS DELIVERY at the paid balance, notifies, and sells
 *      no block.
 *   5. A PAUSE IS NOT A TERMINATION. Paid applications survive it.
 *   6. AGENCIES ARE INDEPENDENT. One failing does not stop another settling.
 *   7. THE MAXIMUM DAILY DEBIT HALTS rather than clamping.
 *   8. AN APPLICATION COSTS ONE CREDIT however many times it is submitted.
 *
 * The payment gateway is a fake, deliberately. The property that matters most --
 * "two concurrent runs produce exactly one charge" -- is not observable against
 * a real Stripe account, and a test that cannot observe it is not checking it.
 */

const gate = databaseGate();
announceSkip('Phase 3: the ledger, Overrun and daily settlement', gate);

const TEST_JWT_SECRET = 'settlement-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

/** A payment gateway that records every call and answers however it is told. */
class FakeGateway implements PaymentGateway {
  readonly achCharges: ChargeRequest[] = [];
  readonly cardCharges: ChargeRequest[] = [];
  /** Set to make every debit decline. */
  declineWith: string | null = null;
  /** Milliseconds each charge takes, so a race has a window to happen in. */
  latencyMs = 0;

  async chargeAchOffSession(request: ChargeRequest) {
    this.achCharges.push(request);
    if (this.latencyMs > 0) await new Promise(resolve => setTimeout(resolve, this.latencyMs));
    if (this.declineWith) {
      return {
        ok: false,
        paymentIntentId: null,
        status: 'requires_payment_method',
        failureCode: 'debit_not_authorized',
        failureMessage: this.declineWith,
      };
    }
    return {
      ok: true,
      paymentIntentId: `pi_${this.achCharges.length}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'processing',
      failureCode: null,
      failureMessage: null,
    };
  }

  async chargeCardOnSession(request: ChargeRequest) {
    this.cardCharges.push(request);
    return {
      ok: true,
      paymentIntentId: `pi_card_${this.cardCharges.length}`,
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

  isEnabled() {
    return true;
  }
}

describe('Phase 3 suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `settlement suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Phase 3: the ledger, Overrun and daily settlement', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let gateway: FakeGateway;

  /** The larger launch agency: 45 licensed agents, block of 45 applications. */
  let big: { id: string; ownerId: string };
  /** The smaller one: 15 agents, block of 15. */
  let small: { id: string; ownerId: string };
  let operatorId: string;

  const CLOSED_DAY = '2026-09-07';
  const NEXT_DAY = '2026-09-08';

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);

    const { registerDeliveryBillingRoutes } = await import('../routes/delivery-billing.js');
    await instance.register(registerDeliveryBillingRoutes);

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
      'billing_notifications',
      'delivery_hold_events',
      'settlement_payment_attempts',
      'application_credit_ledger',
      'daily_settlements',
      'agency_billing_profiles',
      'rating_review_flags',
      'rate_changes',
      'agency_rating_states',
      'rating_settings',
      'rate_curve_anchors',
      'rate_curve_versions',
      'insurance_carrier_applications',
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
          id: '00000000-0000-4000-8000-00000000c001',
          version: 1,
          label: 'Launch curve',
          minimumClosingPct: 5,
          flatFromClosingPct: 15,
          anchors: {
            create: [
              { closingPct: 5, rate: 264 },
              { closingPct: 6, rate: 234 },
              { closingPct: 7, rate: 204 },
              { closingPct: 8, rate: 184 },
              { closingPct: 9, rate: 169 },
              { closingPct: 10, rate: 159 },
              { closingPct: 11, rate: 159 },
              { closingPct: 12, rate: 149 },
              { closingPct: 13, rate: 144 },
              { closingPct: 14, rate: 139 },
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
        activeCurveVersionId: '00000000-0000-4000-8000-00000000c001',
      },
      update: { activeCurveVersionId: '00000000-0000-4000-8000-00000000c001' },
    });
  }

  async function seedAgency(label: string, ownerRoleId: string) {
    const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: `${label} Insurance`, slug, status: 'ACTIVE' },
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

  /**
   * Commercial terms, with the launch numbers.
   *
   * 45 agents, a Daily Block of 45 applications, a 50% Overrun ceiling and a
   * maximum daily debit of $8,978 -- which is (45 + floor(45 x 0.5)) x $134,
   * the figure on the Insertion Order.
   */
  /**
   * Commercial terms, enrolled and charging, unless told otherwise.
   *
   * Enrolment and charging are both OFF by default in the product -- that is
   * the whole point of them -- so every test of Phase 3's behaviour has to turn
   * them on explicitly. The defaults here are inverted from the product's on
   * purpose: a test fixture that had to opt in to charging on every single case
   * would make the enrolment tests below indistinguishable from a forgotten
   * flag.
   */
  async function seedTerms(
    tenantId: string,
    overrides: Partial<{
      dailyBlockApplications: number;
      maxDailyDebit: number;
      ceilingPctBelowThreshold: number;
      mandate: boolean;
      enrolled: boolean;
      chargesEnabled: boolean;
    }> = {}
  ) {
    const block = overrides.dailyBlockApplications ?? 45;
    const ceilingPct = overrides.ceilingPctBelowThreshold ?? 50;
    const mandate = overrides.mandate ?? true;
    const enrolled = overrides.enrolled ?? true;
    const chargesEnabled = overrides.chargesEnabled ?? true;

    const fields = {
      dailyBlockApplications: block,
      maxDailyDebit: overrides.maxDailyDebit ?? maxDailyDebitFor(block, ceilingPct, 134),
      ceilingPctBelowThreshold: ceilingPct,
      stripeCustomerId: 'cus_fake',
      achPaymentMethodId: mandate ? 'pm_fake' : null,
      achMandateStatus: (mandate ? 'ACTIVE' : 'NONE') as 'ACTIVE' | 'NONE',
      achMandateVerifiedAt: mandate ? new Date() : null,
      billingEnrolledAt: enrolled ? new Date() : null,
      chargesEnabled,
    };

    return prisma.agencyBillingProfile.upsert({
      where: { tenantId },
      create: { tenantId, ...fields },
      update: fields,
    });
  }

  /** An agreed opening rate, so the agency is priced and deliverable. */
  async function seedOpeningAgreement(tenantId: string, rate = 134) {
    return prisma.agencyRatingState.upsert({
      where: { tenantId },
      create: {
        tenantId,
        status: 'OPENING_BLOCK',
        openingRate: rate,
        currentRate: rate,
        openingBlockApplications: 45,
      },
      update: { status: 'OPENING_BLOCK', openingRate: rate, currentRate: rate },
    });
  }

  function middayOf(day: string, offsetMs = 0): Date {
    return new Date(calendarDayBounds(day).start.getTime() + 12 * 3600_000 + offsetMs);
  }

  let callSeq = 0;

  async function seedCall(params: {
    tenantId: string;
    answeredAt: Date | null;
    answeredByUserId?: string | null;
    connectedDuration?: number;
  }) {
    callSeq += 1;
    return prisma.call.create({
      data: {
        tenantId: params.tenantId,
        callSid: `sid-${callSeq}-${Math.random().toString(36).slice(2, 8)}`,
        toNumber: '+15550000000',
        status: params.answeredAt ? 'COMPLETED' : 'NO_ANSWER',
        direction: 'INBOUND',
        answeredAt: params.answeredAt,
        answeredByUserId: params.answeredByUserId ?? null,
        connectedDuration: params.connectedDuration ?? (params.answeredAt ? 120 : 0),
        blocked: false,
      },
    });
  }

  async function seedDeliveredCalls(tenantId: string, day: string, count: number) {
    for (let i = 0; i < count; i++) {
      await seedCall({ tenantId, answeredAt: middayOf(day, i * 1000) });
    }
  }

  let appSeq = 0;

  async function seedApplication(tenantId: string, submittedAt: Date | null) {
    appSeq += 1;
    return prisma.insuranceCarrierApplication.create({
      data: {
        tenantId,
        firstName: 'Test',
        lastName: `Applicant ${appSeq}`,
        status: submittedAt ? 'SUBMITTED' : 'PENDING',
        submittedAt,
      },
    });
  }

  /** Applications submitted on `day`, each spending a credit or overrunning. */
  async function submitApplications(tenantId: string, day: string, count: number) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const application = await seedApplication(tenantId, middayOf(day, i * 1000));
      await consumeCreditForApplication({
        prisma,
        tenantId,
        applicationId: application.id,
        deliveryDay: day,
      });
      ids.push(application.id);
    }
    return ids;
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

    const ownerRole = await prisma.role.create({
      data: { name: 'OWNER', description: 'OWNER role', permissions: ['admin:*'] },
    });

    big = await seedAgency('Ridgeline', ownerRole.id);
    small = await seedAgency('Fairhaven', ownerRole.id);

    const operator = await prisma.user.create({
      data: { email: 'operator@netenroll.test', status: 'ACTIVE', tenantId: null },
    });
    operatorId = operator.id;
    await grantPlatformAdmin(operatorId, { note: 'settlement suite fixture' });
  });


  // ══════════════════════════════════════════════════════════════════════════
  // 0. Enrolment — the opt-in
  //
  // Phase 3 shipped without one. A tenant with no billing profile has no
  // mandate, so the gate refused it with NO_MANDATE, and deploying that would
  // have stopped call delivery for every agency on the platform. These are the
  // cases that say it cannot happen again.
  // ══════════════════════════════════════════════════════════════════════════
  describe('enrolment', () => {
    it('leaves every pre-existing tenant unenrolled and ungated after the migration', async () => {
      /*
       * THE case. Production has five tenants, none with a billing profile, one
       * carrying live client traffic. Applying the migration must change
       * nothing about any of them.
       *
       * This asserts against a database the migration file has actually been
       * applied to -- CI runs `db:constraints` and the migration after
       * `prisma db push` -- rather than trusting a reading of the SQL. It also
       * seeds a tenant that looks like a production one: a `Call`, an
       * application, no billing profile, no mandate, no ledger row.
       */
      const ownerRole = await prisma.role.findFirst({ where: { name: 'OWNER' } });
      const preExisting = await Promise.all([
        seedAgency('Legacy-One', ownerRole!.id),
        seedAgency('Legacy-Two', ownerRole!.id),
        seedAgency('Legacy-Three', ownerRole!.id),
      ]);

      for (const tenant of preExisting) {
        await seedDeliveredCalls(tenant.id, CLOSED_DAY, 3);
        await seedApplication(tenant.id, middayOf(CLOSED_DAY));
      }

      // No enrolment anywhere on the platform.
      const enrolledCount = await prisma.agencyBillingProfile.count({
        where: { billingEnrolledAt: { not: null } },
      });
      expect(enrolledCount).toBe(0);

      for (const tenant of preExisting) {
        const decision = await evaluateDeliveryGate(tenant.id, {
          prisma,
          now: middayOf(CLOSED_DAY),
        });

        // Not gated. Not "allowed because it passed the checks" -- not subject
        // to them.
        expect(decision.enrolled).toBe(false);
        expect(decision.allowed).toBe(true);
        expect(decision.reason).toBeNull();
      }

      // Nothing was recorded and nobody was notified on their behalf.
      expect(await prisma.deliveryHoldEvent.count()).toBe(0);
      expect(await prisma.billingNotification.count()).toBe(0);
      expect(await prisma.applicationCreditLedgerEntry.count()).toBe(0);
    });

    it('does not meter an unenrolled agency when an application is submitted', async () => {
      const application = await seedApplication(big.id, null);

      const { markAutomationCompleted } = await import(
        '../services/carrier-rpa/application-store.js'
      );
      await markAutomationCompleted(application.id, 'AA-9001');

      // The application is submitted -- Phase 2 still counts it -- and no
      // ledger row exists, so it is neither a consumption nor an overrun.
      const row = await prisma.insuranceCarrierApplication.findUnique({
        where: { id: application.id },
      });
      expect(row?.status).toBe('SUBMITTED');
      expect(row?.submittedAt).not.toBeNull();

      expect(
        await prisma.applicationCreditLedgerEntry.count({ where: { tenantId: big.id } })
      ).toBe(0);
      expect(await creditBalance(prisma, big.id)).toBe(0);
    });

    it('skips an unenrolled agency entirely rather than settling it at zero', async () => {
      await seedDeliveredCalls(big.id, CLOSED_DAY, 100);
      await seedApplication(big.id, middayOf(CLOSED_DAY));

      const run = await runDailySettlement({ deliveryDay: CLOSED_DAY, prisma, gateway });

      const result = run.results.find(r => r.tenantId === big.id);
      expect(result?.skippedReason).toMatch(/not enrolled/i);
      expect(result?.settlementId).toBeNull();

      // No row at all. A settlement saying zero would assert this agency was
      // billed nothing, and the truth is that it is not in the billing system.
      expect(await prisma.dailySettlement.count()).toBe(0);
      expect(gateway.achCharges).toHaveLength(0);
    });

    it('will not enrol an agency with nothing recorded, and says what is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/platform/delivery/agencies/${big.id}/enrol`,
        headers: tokenFor(operatorId, null),
      });

      expect(response.statusCode).toBe(409);
      const body = response.json();
      expect(body.error.code).toBe('ENROLMENT_BLOCKED');
      expect(body.error.blockers.map((b: any) => b.code)).toEqual(['NO_BILLING_PROFILE']);

      const profile = await prisma.agencyBillingProfile.findUnique({
        where: { tenantId: big.id },
      });
      expect(profile).toBeNull();
    });

    it('names every missing precondition rather than one at a time', async () => {
      // Terms exist, but with no Daily Block, no mandate and no agreed rate.
      await prisma.agencyBillingProfile.create({
        data: { tenantId: big.id, dailyBlockApplications: 0, maxDailyDebit: 0 },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/platform/delivery/agencies/${big.id}/enrol`,
        headers: tokenFor(operatorId, null),
      });

      expect(response.statusCode).toBe(409);
      const codes = response.json().error.blockers.map((b: any) => b.code).sort();
      expect(codes).toEqual([
        'NO_DAILY_BLOCK',
        'NO_MAX_DAILY_DEBIT',
        'NO_OPENING_RATE',
        'NO_VALID_MANDATE',
      ]);

      // Still not enrolled.
      const profile = await prisma.agencyBillingProfile.findUnique({
        where: { tenantId: big.id },
      });
      expect(profile?.billingEnrolledAt).toBeNull();
    });

    it('refuses to enrol an agency missing only its mandate', async () => {
      await seedTerms(big.id, { mandate: false, enrolled: false });
      await seedOpeningAgreement(big.id);

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/platform/delivery/agencies/${big.id}/enrol`,
        headers: tokenFor(operatorId, null),
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.blockers.map((b: any) => b.code)).toEqual([
        'NO_VALID_MANDATE',
      ]);
    });

    it('enrols an agency that has everything, with charging still off', async () => {
      await seedTerms(big.id, { enrolled: false, chargesEnabled: false });
      await seedOpeningAgreement(big.id);

      const ready = await app.inject({
        method: 'GET',
        url: `/api/v1/platform/delivery/agencies/${big.id}/enrolment`,
        headers: tokenFor(operatorId, null),
      });
      expect(ready.json().data.readyToEnrol).toBe(true);
      expect(ready.json().data.blockers).toEqual([]);

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/platform/delivery/agencies/${big.id}/enrol`,
        headers: tokenFor(operatorId, null),
        payload: { note: 'Insertion Order signed 2026-09-01' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.enrolled).toBe(true);
      // Enrolment does NOT start charging. That is a second, separate act.
      expect(response.json().data.chargesEnabled).toBe(false);

      /*
       * And from here Phase 3 applies unchanged: the agency is gated, and every
       * figure on the decision is a real measurement rather than the zeroes an
       * unenrolled agency gets.
       *
       * It is allowed, on nothing: it has bought no block yet, so its balance
       * is zero and it is in Overrun from its first application, up to a
       * ceiling of 22. That is the design -- delivery does not stop at a zero
       * balance -- and it is why an opening purchase is sold before an agency
       * starts, not because the gate would otherwise refuse it.
       */
      const decision = await evaluateDeliveryGate(big.id, {
        prisma,
        now: middayOf(CLOSED_DAY),
        record: false,
      });
      expect(decision.enrolled).toBe(true);
      expect(decision.allowed).toBe(true);
      expect(decision.balance).toBe(0);
      expect(decision.overrunCeiling).toBe(22);
      expect(decision.overrunRemaining).toBe(22);

      const audit = await prisma.auditLog.findFirst({
        where: { tenantId: big.id, action: 'platform.delivery.enrolled' },
      });
      expect(audit).not.toBeNull();
    });

    it('un-enrols an agency without touching its ledger or settlements', async () => {
      await seedTerms(big.id);
      await seedOpeningAgreement(big.id);
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 45,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/platform/delivery/agencies/${big.id}/unenrol`,
        headers: tokenFor(operatorId, null),
        payload: { reason: 'Paused pending contract review' },
      });
      expect(response.statusCode).toBe(200);

      const decision = await evaluateDeliveryGate(big.id, {
        prisma,
        now: middayOf(CLOSED_DAY),
        record: false,
      });
      expect(decision.enrolled).toBe(false);
      expect(decision.allowed).toBe(true);

      // The record of what it was charged is untouched.
      expect(
        await prisma.applicationCreditLedgerEntry.count({ where: { tenantId: big.id } })
      ).toBe(1);
    });

    it('tells an unenrolled agency that billing does not apply, without zeroes', async () => {
      // The portal reads this. Rendering "0 remaining on the block" to an
      // agency that is not in the billing system would tell a principal their
      // phones are about to stop, which is the opposite of the truth.
      await seedDeliveredCalls(big.id, currentCalendarDay(), 7);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/delivery/today',
        headers: tokenFor(big.ownerId, big.id),
      });

      expect(response.statusCode).toBe(200);
      const view = response.json().data;
      expect(view.enrolled).toBe(false);
      expect(view.delivering).toBe(true);
      expect(view.holdReason).toBeNull();
      // The two counts that are true regardless are still real.
      expect(view.callsAnswered).toBe(7);
      // And nothing was priced.
      expect(view.currentRate).toBeNull();
      expect(view.projectedTotalCharge).toBeNull();
    });

    it('refuses an agency enrolling itself or turning on its own charging', async () => {
      await seedTerms(big.id, { enrolled: false, chargesEnabled: false });
      await seedOpeningAgreement(big.id);

      for (const [method, url] of [
        ['POST', `/api/v1/platform/delivery/agencies/${big.id}/enrol`],
        ['POST', `/api/v1/platform/delivery/agencies/${big.id}/unenrol`],
        ['PUT', `/api/v1/platform/delivery/agencies/${big.id}/charges`],
      ] as const) {
        const response = await app.inject({
          method,
          url,
          headers: tokenFor(big.ownerId, big.id),
          payload: { enabled: true },
        });
        expect(response.statusCode, `${method} ${url}`).toBe(403);
      }

      const profile = await prisma.agencyBillingProfile.findUnique({
        where: { tenantId: big.id },
      });
      expect(profile?.billingEnrolledAt).toBeNull();
      expect(profile?.chargesEnabled).toBe(false);
    });

    it('will not enable charging for an agency that is not enrolled', async () => {
      await seedTerms(big.id, { enrolled: false, chargesEnabled: false });

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/platform/delivery/agencies/${big.id}/charges`,
        headers: tokenFor(operatorId, null),
        payload: { enabled: true },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('NOT_ENROLLED');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 0b. The dry run — everything except the debit
  // ══════════════════════════════════════════════════════════════════════════
  describe('the dry run', () => {
    async function seedSettleableDryRunDay(tenantId: string, chargesEnabled: boolean) {
      await seedTerms(tenantId, { dailyBlockApplications: 45, chargesEnabled });
      await seedOpeningAgreement(tenantId);
      await recordPurchase(prisma, {
        tenantId,
        deliveryDay: CLOSED_DAY,
        quantity: 45,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });
      await seedDeliveredCalls(tenantId, CLOSED_DAY, 440);
      await submitApplications(tenantId, CLOSED_DAY, 67);
    }

    it('records the full settlement and places no debit when charging is off', async () => {
      await seedSettleableDryRunDay(big.id, false);

      const result = await settleAgencyForDeliveryDay({
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        prisma,
        gateway,
      });

      // No money moved.
      expect(gateway.achCharges).toHaveLength(0);
      expect(gateway.cardCharges).toHaveLength(0);
      expect(result.paymentStatus).toBe('DRY_RUN');

      // And every figure is the real computation, not a placeholder.
      const settlement = await prisma.dailySettlement.findUnique({
        where: { tenantId_deliveryDay: { tenantId: big.id, deliveryDay: CLOSED_DAY } },
      });
      expect(settlement?.deliveredCalls).toBe(440);
      expect(settlement?.submittedApplications).toBe(67);
      expect(settlement?.overrunQuantity).toBe(22);
      expect(Number(settlement?.rate)).toBe(134);
      expect(settlement?.nextBlockQuantity).toBe(45);
      expect(Number(settlement?.totalCharged)).toBe(8978);
      expect(settlement?.stripePaymentIntentId).toBeNull();
      expect(settlement?.gracePeriodEndsOn).toBeNull();

      // Nothing was attempted, so there is no attempt row and no failure notice.
      expect(
        await prisma.settlementPaymentAttempt.count({ where: { settlementId: settlement!.id } })
      ).toBe(0);
      expect(
        await prisma.billingNotification.count({
          where: { tenantId: big.id, kind: 'SETTLEMENT_FAILED' },
        })
      ).toBe(0);

      /*
       * The block IS sold, so the agency keeps delivering the way it would if
       * the charge had gone through -- otherwise the thing being watched would
       * be an agency starved to its ceiling rather than the real system. The
       * purchase carries no Stripe reference and names this DRY_RUN settlement,
       * which is what makes an unpaid block identifiable at cutover.
       */
      const purchase = await prisma.applicationCreditLedgerEntry.findFirst({
        where: { tenantId: big.id, entryType: 'PURCHASE', deliveryDay: NEXT_DAY },
      });
      expect(purchase?.quantity).toBe(45);
      expect(purchase?.stripePaymentIntentId).toBeNull();
      expect(purchase?.settlementId).toBe(settlement!.id);
    });

    it('charges when charging is enabled, from the same inputs', async () => {
      await seedSettleableDryRunDay(big.id, true);

      const result = await settleAgencyForDeliveryDay({
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        prisma,
        gateway,
      });

      expect(result.paymentStatus).toBe('SUCCEEDED');
      expect(gateway.achCharges).toHaveLength(1);
      expect(gateway.achCharges[0].amountCents).toBe(897_800);
    });

    it('honours --settle-without-charge over an agency that has charging enabled', async () => {
      await seedSettleableDryRunDay(big.id, true);

      const run = await runDailySettlement({
        deliveryDay: CLOSED_DAY,
        prisma,
        gateway,
        tenantIds: [big.id],
        settleWithoutCharge: true,
      });

      expect(run.results[0].paymentStatus).toBe('DRY_RUN');
      expect(gateway.achCharges).toHaveLength(0);
    });

    it('does not count a dry run as a clean settlement', async () => {
      /*
       * Ten dry-run days must not raise the Overrun ceiling to 100%: nothing
       * was charged, so nothing was paid, and the ceiling is credit extended on
       * a payment history that does not exist yet.
       */
      await seedTerms(big.id, { dailyBlockApplications: 45, chargesEnabled: false });

      for (let i = 0; i < 12; i++) {
        await prisma.dailySettlement.create({
          data: {
            tenantId: big.id,
            deliveryDay: `2026-08-${String(i + 1).padStart(2, '0')}`,
            deliveredCalls: 400,
            submittedApplications: 60,
            windowDeliveryDays: 3,
            windowDaysFound: 3,
            windowDayKeys: [],
            totalCharged: 8040,
            maxDailyDebit: 8978,
            paymentStatus: 'DRY_RUN',
          },
        });
      }

      const terms = await loadAgencyTerms(big.id, { prisma });
      expect(terms.consecutiveCleanSettlements).toBe(0);
      // Still the below-threshold ceiling: 50% of 45.
      expect(terms.ceilingApplications).toBe(22);
    });

    it('still halts a dry run that exceeds the maximum daily debit', async () => {
      // A dry run exists to show what would happen. Reporting DRY_RUN for a
      // settlement that would have HALTED hides the one outcome somebody
      // watching a dry run most needs to see.
      await seedSettleableDryRunDay(big.id, false);
      await prisma.agencyBillingProfile.update({
        where: { tenantId: big.id },
        data: { maxDailyDebit: 1000 },
      });

      const result = await settleAgencyForDeliveryDay({
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        prisma,
        gateway,
      });

      expect(result.paymentStatus).toBe('HALTED_MAX_DEBIT');
      expect(gateway.achCharges).toHaveLength(0);
      // No block sold on a halt, dry run or not.
      expect(
        await prisma.applicationCreditLedgerEntry.count({
          where: { tenantId: big.id, entryType: 'PURCHASE', deliveryDay: NEXT_DAY },
        })
      ).toBe(0);
    });

    // ════════════════════════════════════════════════════════════════════════
    // The closeout: what happens to the dry run's credits at cutover
    //
    // A dry-run settlement SELLS the next block, so the agency keeps
    // delivering. Nobody paid for those credits. Left on the balance they
    // carry into the first charged settlement and shrink its block -- the
    // block is the daily target minus unused paid applications, and the ledger
    // cannot tell an unpaid credit from a bought one. So the transition
    // retires them, by appending rows, and the first real settlement sells a
    // full block against a zero balance.
    // ════════════════════════════════════════════════════════════════════════
    describe('the closeout at cutover', () => {
      /** Two dry-run Delivery Days, each selling a block that nobody paid for. */
      async function runDryRunDays(tenantId: string, days: string[]) {
        await seedTerms(tenantId, { dailyBlockApplications: 45, chargesEnabled: false });
        await seedOpeningAgreement(tenantId);
        // The opening purchase: bought on the Insertion Order, by card. It has
        // no settlement, and it is not the dry run's to retire.
        await recordPurchase(prisma, {
          tenantId,
          deliveryDay: days[0],
          quantity: 45,
          unitRate: 134,
          stripePaymentIntentId: 'pi_opening_card',
        });

        for (const day of days) {
          await seedDeliveredCalls(tenantId, day, 440);
          await submitApplications(tenantId, day, 67);
          await settleAgencyForDeliveryDay({ tenantId, deliveryDay: day, prisma, gateway });
        }
      }

      async function enableCharging(tenantId: string) {
        return app.inject({
          method: 'PUT',
          url: `/api/v1/platform/delivery/agencies/${tenantId}/charges`,
          headers: tokenFor(operatorId, null),
          payload: { enabled: true },
        });
      }

      it('leaves the dry run spending its own credits while it is running', async () => {
        /*
         * The credits are NOT excluded from the balance during the dry run.
         * If they were, every application would be Overrun from the first hour
         * and delivery would stop at the ceiling on day one -- what was being
         * watched would be a starved agency rather than the real system.
         */
        await runDryRunDays(big.id, [CLOSED_DAY]);

        // 45 opening + 45 sold by the dry-run settlement, less 45 consumed
        // (67 submitted: 45 spent credits, 22 overran).
        expect(await creditBalance(prisma, big.id)).toBe(45);

        const decision = await evaluateDeliveryGate(big.id, {
          prisma,
          now: middayOf(NEXT_DAY),
        });
        expect(decision.allowed).toBe(true);
        expect(decision.reason).toBeNull();
      });

      it('retires every remaining dry-run credit when charging is turned on', async () => {
        await runDryRunDays(big.id, [CLOSED_DAY]);
        const before = await creditBalance(prisma, big.id);
        expect(before).toBe(45);

        const response = await enableCharging(big.id);
        expect(response.statusCode).toBe(200);

        const closeout = response.json().data.dryRunCloseout;
        expect(closeout.lotsRetired).toBe(1);
        expect(closeout.creditsRetired).toBe(45);
        expect(closeout.balanceAfter).toBe(0);
        expect(await creditBalance(prisma, big.id)).toBe(0);
      });

      it('leaves the opening purchase alone: it was paid for', async () => {
        /*
         * The opening block was bought by card on the Insertion Order and
         * carries no settlement at all. Retiring it would take away credits
         * the agency has already paid for -- the closeout only ever touches a
         * lot sold by a settlement whose status is DRY_RUN.
         */
        await seedTerms(big.id, { dailyBlockApplications: 45, chargesEnabled: false });
        await seedOpeningAgreement(big.id);
        await recordPurchase(prisma, {
          tenantId: big.id,
          deliveryDay: CLOSED_DAY,
          quantity: 45,
          unitRate: 134,
          stripePaymentIntentId: 'pi_opening_card',
        });

        const response = await enableCharging(big.id);
        expect(response.statusCode).toBe(200);
        expect(response.json().data.dryRunCloseout.lotsRetired).toBe(0);

        // Untouched, and still spendable.
        expect(await creditBalance(prisma, big.id)).toBe(45);
        expect(
          await prisma.applicationCreditLedgerEntry.count({
            where: { tenantId: big.id, entryType: 'DRY_RUN_CLOSEOUT' },
          })
        ).toBe(0);
      });

      it('leaves a block that was actually charged for alone', async () => {
        // Charging on from the start, so the settlement really debits and the
        // block it sells was paid for. Turning charging on again later must not
        // retire it.
        await seedTerms(big.id, { dailyBlockApplications: 45, chargesEnabled: true });
        await seedOpeningAgreement(big.id);
        await recordPurchase(prisma, {
          tenantId: big.id,
          deliveryDay: CLOSED_DAY,
          quantity: 45,
          unitRate: 134,
          stripePaymentIntentId: 'pi_opening_card',
        });
        await seedDeliveredCalls(big.id, CLOSED_DAY, 440);
        await submitApplications(big.id, CLOSED_DAY, 67);
        const settled = await settleAgencyForDeliveryDay({
          tenantId: big.id,
          deliveryDay: CLOSED_DAY,
          prisma,
          gateway,
        });
        expect(settled.paymentStatus).toBe('SUCCEEDED');

        const response = await enableCharging(big.id);
        expect(response.json().data.dryRunCloseout.lotsRetired).toBe(0);
        expect(await creditBalance(prisma, big.id)).toBe(45);
      });

      it('retires each lot once however many times charging is turned on', async () => {
        /*
         * The guarantee is the unique index on (purchaseEntryId, lotIndex) --
         * each closeout claims slot -1 of its lot -- not a flag the route
         * checks. Pressing the button twice retires nothing the second time,
         * and pressing it twice AT ONCE must not retire twice either.
         */
        /*
         * Two dry-run days at 20 applications against a 45 block, so each
         * settlement sells a short block that is then only partly spent and
         * BOTH dry-run lots still carry credits at cutover. 130 calls to 20
         * applications is 15.4%, above the flat point, so the rate stays $134
         * and the arithmetic below reads.
         *
         * Lots at cutover: the opening 45 with 5 left (paid for, kept), and
         * two dry-run blocks of 20 with nothing spent (retired).
         */
        await seedTerms(big.id, { dailyBlockApplications: 45, chargesEnabled: false });
        await seedOpeningAgreement(big.id);
        await recordPurchase(prisma, {
          tenantId: big.id,
          deliveryDay: CLOSED_DAY,
          quantity: 45,
          unitRate: 134,
          stripePaymentIntentId: 'pi_opening_card',
        });
        for (const day of [CLOSED_DAY, NEXT_DAY]) {
          await seedDeliveredCalls(big.id, day, 130);
          await submitApplications(big.id, day, 20);
          await settleAgencyForDeliveryDay({ tenantId: big.id, deliveryDay: day, prisma, gateway });
        }

        expect(await creditBalance(prisma, big.id)).toBe(45);

        const [first, second] = await Promise.all([
          enableCharging(big.id),
          enableCharging(big.id),
        ]);

        // Between them, 40 credits over 2 lots -- once, however the two calls
        // interleave.
        const sum = (key: 'lotsRetired' | 'creditsRetired') =>
          [first, second].reduce((total, r) => total + r.json().data.dryRunCloseout[key], 0);
        expect(sum('creditsRetired')).toBe(40);
        expect(sum('lotsRetired')).toBe(2);

        const third = await enableCharging(big.id);
        expect(third.json().data.dryRunCloseout.lotsRetired).toBe(0);

        // One closeout row per dry-run lot, never two.
        const rows = await prisma.applicationCreditLedgerEntry.findMany({
          where: { tenantId: big.id, entryType: 'DRY_RUN_CLOSEOUT' },
        });
        expect(rows).toHaveLength(2);
        expect(new Set(rows.map(row => row.purchaseEntryId)).size).toBe(2);

        // The 5 credits left on the paid opening block survive. Only the dry
        // run's own blocks were retired.
        expect(await creditBalance(prisma, big.id)).toBe(5);
      });

      it('names the lot and the settlement it retired, and moves no money', async () => {
        await runDryRunDays(big.id, [CLOSED_DAY]);
        await enableCharging(big.id);

        const row = await prisma.applicationCreditLedgerEntry.findFirstOrThrow({
          where: { tenantId: big.id, entryType: 'DRY_RUN_CLOSEOUT' },
        });

        // Negative: the credits stop counting toward the balance.
        expect(row.quantity).toBe(-45);
        // No money moved, in either direction. An amount here would read as
        // one that did -- this is not a refund, credit, reversal or rebate.
        expect(row.amount).toBeNull();
        expect(row.stripePaymentIntentId).toBeNull();
        // The row reads on its own: which lot, which settlement, which day the
        // retired block was for, and the rate it was nominally sold at.
        expect(row.lotIndex).toBe(-1);
        expect(row.purchaseEntryId).not.toBeNull();
        expect(row.deliveryDay).toBe(NEXT_DAY);
        expect(Number(row.unitRate)).toBe(134);

        const settlement = await prisma.dailySettlement.findUniqueOrThrow({
          where: { tenantId_deliveryDay: { tenantId: big.id, deliveryDay: CLOSED_DAY } },
        });
        expect(row.settlementId).toBe(settlement.id);
        expect(settlement.paymentStatus).toBe('DRY_RUN');

        const purchase = await prisma.applicationCreditLedgerEntry.findUniqueOrThrow({
          where: { id: row.purchaseEntryId! },
        });
        expect(purchase.entryType).toBe('PURCHASE');
        expect(purchase.settlementId).toBe(settlement.id);
        // Append-only: the purchase it retires is exactly as it was written.
        expect(purchase.quantity).toBe(45);
      });

      it('sells a full block on the first charged settlement after the dry run', async () => {
        /*
         * THE reason the closeout exists. Without it the 45 unpaid dry-run
         * credits look like unused paid applications, the first charged
         * settlement sells 45 - 45 = 0 and the agency delivers its first real
         * billing day on credits nobody paid for.
         */
        await runDryRunDays(big.id, [CLOSED_DAY]);
        await enableCharging(big.id);

        /*
         * The cutover day, delivered on a zero balance right up to the
         * Overrun ceiling: 22 applications, which is 50% of a 45 block. 144
         * calls keeps the trailing window at or above 15% so the rate is the
         * flat $134 and the arithmetic is readable.
         */
        const firstCharged = '2026-09-09';
        await seedDeliveredCalls(big.id, firstCharged, 144);
        await submitApplications(big.id, firstCharged, 22);

        const result = await settleAgencyForDeliveryDay({
          tenantId: big.id,
          deliveryDay: firstCharged,
          prisma,
          gateway,
        });

        expect(result.paymentStatus).toBe('SUCCEEDED');
        // A FULL block. Without the closeout the 45 unpaid dry-run credits
        // would read as unused paid applications and this would be 45-45 = 0.
        expect(result.nextBlockQuantity).toBe(45);
        // Nothing was left to spend, so all 22 were Overrun.
        expect(result.overrunQuantity).toBe(22);

        const settlement = await prisma.dailySettlement.findUniqueOrThrow({
          where: { tenantId_deliveryDay: { tenantId: big.id, deliveryDay: firstCharged } },
        });
        expect(settlement.unusedPaidApplications).toBe(0);

        /*
         * $2,948 of Overrun plus $6,030 of block is $8,978 -- exactly the
         * maximum daily debit, because that figure IS (45 + 22) x $134. An
         * agency delivered to its ceiling on a zero balance bills its
         * contractual maximum to the cent and does not halt.
         */
        expect(result.totalCharged).toBe(8978);
        expect(gateway.achCharges[0].amountCents).toBe(897_800);
      });

      it('shows an operator the number before they press the button', async () => {
        await runDryRunDays(big.id, [CLOSED_DAY]);

        const before = await app.inject({
          method: 'GET',
          url: `/api/v1/platform/delivery/agencies/${big.id}/enrolment`,
          headers: tokenFor(operatorId, null),
        });
        expect(before.json().data.balance).toBe(45);
        expect(before.json().data.pendingDryRunCloseout).toEqual({ lots: 1, credits: 45 });

        // And which bank account the debits will come out of. A mandate that
        // exists is not the same fact as a mandate on the right account.
        expect(before.json().data.mandate).toMatchObject({ status: 'ACTIVE', valid: true });

        await enableCharging(big.id);

        const after = await app.inject({
          method: 'GET',
          url: `/api/v1/platform/delivery/agencies/${big.id}/enrolment`,
          headers: tokenFor(operatorId, null),
        });
        expect(after.json().data.balance).toBe(0);
        expect(after.json().data.pendingDryRunCloseout).toEqual({ lots: 0, credits: 0 });
      });

      it('refuses to update or delete a closeout row', async () => {
        // Append-only stays intact: the closeout is a correction expressed as a
        // later row, and it is no more mutable than anything else here.
        await runDryRunDays(big.id, [CLOSED_DAY]);
        await enableCharging(big.id);

        const row = await prisma.applicationCreditLedgerEntry.findFirstOrThrow({
          where: { tenantId: big.id, entryType: 'DRY_RUN_CLOSEOUT' },
        });

        await expect(
          prisma.$executeRawUnsafe(
            `UPDATE "application_credit_ledger" SET "quantity" = 0 WHERE "id" = '${row.id}'`
          )
        ).rejects.toThrow();
        await expect(
          prisma.$executeRawUnsafe(
            `DELETE FROM "application_credit_ledger" WHERE "id" = '${row.id}'`
          )
        ).rejects.toThrow();
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. The ledger
  // ══════════════════════════════════════════════════════════════════════════
  describe('the ledger', () => {
    it('derives the balance by summing rows, and stores no counter', async () => {
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 45,
        unitRate: 134,
        stripePaymentIntentId: 'pi_opening',
      });

      expect(await creditBalance(prisma, big.id)).toBe(45);

      await submitApplications(big.id, CLOSED_DAY, 5);
      expect(await creditBalance(prisma, big.id)).toBe(40);

      // And the balance is genuinely the sum of the rows, not a column.
      const rows = await prisma.applicationCreditLedgerEntry.findMany({
        where: { tenantId: big.id },
      });
      expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(40);
    });

    it('refuses to update or delete a ledger row', async () => {
      /*
       * "Nothing in this system mutates a balance" is a database property, not
       * a convention. If this ever passes by not throwing, the trigger has
       * stopped being applied and every guarantee above it is a comment.
       */
      const entry = await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 10,
        unitRate: 134,
        stripePaymentIntentId: 'pi_opening',
      });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "application_credit_ledger" SET "quantity" = 999 WHERE "id" = '${entry.id}'`
        )
      ).rejects.toThrow(/append-only/i);

      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM "application_credit_ledger" WHERE "id" = '${entry.id}'`
        )
      ).rejects.toThrow(/append-only/i);

      expect(await creditBalance(prisma, big.id)).toBe(10);
    });

    it('consumes the oldest purchase first when credits span different rates', async () => {
      const older = await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: '2026-09-05',
        quantity: 2,
        unitRate: 159,
        stripePaymentIntentId: 'pi_older',
      });
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: '2026-09-06',
        quantity: 2,
        unitRate: 134,
        stripePaymentIntentId: 'pi_newer',
      });

      const ids = await submitApplications(big.id, CLOSED_DAY, 3);

      const entries = await prisma.applicationCreditLedgerEntry.findMany({
        where: { applicationId: { in: ids } },
        orderBy: { createdAt: 'asc' },
      });

      // The first two draw on the $159 lot, the third on the $134 lot.
      expect(entries.map(e => Number(e.unitRate))).toEqual([159, 159, 134]);
      expect(entries.slice(0, 2).every(e => e.purchaseEntryId === older.id)).toBe(true);
    });

    it('spends exactly one credit when two applications submit simultaneously', async () => {
      /*
       * The brief's case: "Two applications reaching submitted state
       * simultaneously must not consume the same credit."
       *
       * One credit exists. Two writers go for it at the same time. The
       * guarantee is the unique index on (purchaseEntryId, lotIndex), so this
       * exercises the index rather than any application-level ordering: one
       * application spends the credit, the other is recorded as overrun, and no
       * unit of the lot is claimed twice.
       */
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 1,
        unitRate: 134,
        stripePaymentIntentId: 'pi_one',
      });

      const a = await seedApplication(big.id, middayOf(CLOSED_DAY));
      const b = await seedApplication(big.id, middayOf(CLOSED_DAY, 1));

      const [first, second] = await Promise.all([
        consumeCreditForApplication({
          prisma,
          tenantId: big.id,
          applicationId: a.id,
          deliveryDay: CLOSED_DAY,
        }),
        consumeCreditForApplication({
          prisma,
          tenantId: big.id,
          applicationId: b.id,
          deliveryDay: CLOSED_DAY,
        }),
      ]);

      const outcomes = [first.outcome, second.outcome].sort();
      expect(outcomes).toEqual(['CONSUMED', 'OVERRUN']);

      expect(await creditBalance(prisma, big.id)).toBe(0);

      const consumptions = await prisma.applicationCreditLedgerEntry.count({
        where: { tenantId: big.id, entryType: 'CONSUMPTION' },
      });
      expect(consumptions).toBe(1);
    });

    it('spends one credit for twenty applications racing for twenty credits', async () => {
      // The same guarantee under real contention: twenty writers, twenty
      // credits, twenty distinct units claimed and nothing left over.
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 20,
        unitRate: 134,
        stripePaymentIntentId: 'pi_twenty',
      });

      const applications = await Promise.all(
        Array.from({ length: 20 }, (_, i) => seedApplication(big.id, middayOf(CLOSED_DAY, i)))
      );

      const results = await Promise.all(
        applications.map(application =>
          consumeCreditForApplication({
            prisma,
            tenantId: big.id,
            applicationId: application.id,
            deliveryDay: CLOSED_DAY,
          })
        )
      );

      expect(results.filter(r => r.outcome === 'CONSUMED')).toHaveLength(20);
      expect(await creditBalance(prisma, big.id)).toBe(0);

      const lotIndexes = await prisma.applicationCreditLedgerEntry.findMany({
        where: { tenantId: big.id, entryType: 'CONSUMPTION' },
        select: { lotIndex: true },
      });
      expect(new Set(lotIndexes.map(r => r.lotIndex)).size).toBe(20);
    });

    it('costs one credit when an application reaches submitted state twice', async () => {
      /*
       * The brief's case, driven through the real submission path: a retried
       * automation run calls markAutomationCompleted again with the same
       * application id.
       */
      // Metering is opt-in: an unenrolled agency's applications write no ledger
      // row at all, so this case only exists for an enrolled one.
      await seedTerms(big.id);
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 5,
        unitRate: 134,
        stripePaymentIntentId: 'pi_five',
      });

      const application = await seedApplication(big.id, null);

      const { markAutomationCompleted } = await import(
        '../services/carrier-rpa/application-store.js'
      );
      await markAutomationCompleted(application.id, 'AA-0001');
      await markAutomationCompleted(application.id, 'AA-0001');
      await markAutomationCompleted(application.id, 'AA-0001');

      const entries = await prisma.applicationCreditLedgerEntry.findMany({
        where: { applicationId: application.id },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].quantity).toBe(-1);
      expect(await creditBalance(prisma, big.id)).toBe(4);

      // And exactly one application is counted, so exactly one is charged.
      const submitted = await prisma.insuranceCarrierApplication.count({
        where: { tenantId: big.id, submittedAt: { not: null } },
      });
      expect(submitted).toBe(1);
    });

    it('records an application as overrun when the balance is spent', async () => {
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 1,
        unitRate: 134,
        stripePaymentIntentId: 'pi_one',
      });

      await submitApplications(big.id, CLOSED_DAY, 3);

      const counts = await prisma.applicationCreditLedgerEntry.groupBy({
        by: ['entryType'],
        where: { tenantId: big.id },
        _count: { _all: true },
      });

      const byType = Object.fromEntries(counts.map(c => [c.entryType, c._count._all]));
      expect(byType.CONSUMPTION).toBe(1);
      expect(byType.OVERRUN).toBe(2);

      // An overrun does not move the balance: there was no balance to move.
      expect(await creditBalance(prisma, big.id)).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Overrun and the ceiling
  // ══════════════════════════════════════════════════════════════════════════
  describe('the Overrun ceiling', () => {
    it('reproduces the Insertion Order figures for both launch agencies', () => {
      // 45 licensed agents: block 45, ceiling 50% -> 22 overrun applications,
      // maximum daily debit (45 + 22) x $134 = $8,978.
      expect(overrunCeilingApplications(45, 50)).toBe(22);
      expect(maxDailyDebitFor(45, 50, 134)).toBe(8978);

      // 15 agents: block 15, ceiling 50% -> 7, (15 + 7) x $134 = $2,948.
      expect(overrunCeilingApplications(15, 50)).toBe(7);
      expect(maxDailyDebitFor(15, 50, 134)).toBe(2948);

      // At or beyond ten clean settlements the ceiling doubles.
      expect(overrunCeilingApplications(45, 100)).toBe(45);
    });

    it('keeps delivering when the balance hits zero, and stops at the ceiling', async () => {
      /*
       * The brief's case: "Ceiling reached mid-day with a call connected: that
       * call completes, no new calls."
       *
       * Delivery does NOT stop when the prepaid balance hits zero -- that is
       * where Overrun begins. It stops at the ceiling, and the call that is
       * already up is untouched by any of it.
       */
      await seedTerms(big.id, { dailyBlockApplications: 4 }); // ceiling: 2
      await seedOpeningAgreement(big.id);
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 4,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });

      const now = middayOf(CLOSED_DAY);

      // A call is up right now: answered, not yet ended.
      const connected = await prisma.call.create({
        data: {
          tenantId: big.id,
          callSid: `sid-live-${Math.random().toString(36).slice(2, 8)}`,
          toNumber: '+15550000000',
          status: 'ANSWERED',
          direction: 'INBOUND',
          answeredAt: now,
          blocked: false,
        },
      });

      // The block is spent. Delivery continues -- this is Overrun, not a stop.
      await submitApplications(big.id, CLOSED_DAY, 4);
      let decision = await evaluateDeliveryGate(big.id, { prisma, now });
      expect(decision.allowed).toBe(true);
      expect(decision.balance).toBe(0);
      expect(decision.overrunRemaining).toBe(2);

      // Two more applications: the ceiling is reached.
      await submitApplications(big.id, CLOSED_DAY, 2);
      decision = await evaluateDeliveryGate(big.id, { prisma, now });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('CEILING_REACHED');
      expect(decision.overrunToday).toBe(2);
      expect(decision.overrunRemaining).toBe(0);

      // The call that was already connected is untouched: nothing in the gate
      // writes to a call, and it is still ANSWERED with no end time.
      const stillUp = await prisma.call.findUnique({ where: { id: connected.id } });
      expect(stillUp?.status).toBe('ANSWERED');
      expect(stillUp?.endedAt).toBeNull();
      expect(stillUp?.answeredAt).not.toBeNull();

      // A hold event was recorded once, and platform admins were notified.
      const holds = await prisma.deliveryHoldEvent.findMany({
        where: { tenantId: big.id, deliveryDay: CLOSED_DAY },
      });
      expect(holds).toHaveLength(1);
      expect(holds[0].reason).toBe('CEILING_REACHED');

      const notices = await prisma.billingNotification.findMany({
        where: { tenantId: big.id, kind: 'CEILING_REACHED' },
      });
      expect(notices).toHaveLength(1);
      expect(notices[0].toPlatform).toBe(true);
      expect(notices[0].toAgency).toBe(true);

      // Consulting the gate again does not send a second notice.
      await evaluateDeliveryGate(big.id, { prisma, now });
      await evaluateDeliveryGate(big.id, { prisma, now });
      expect(
        await prisma.billingNotification.count({
          where: { tenantId: big.id, kind: 'CEILING_REACHED' },
        })
      ).toBe(1);
    });

    it('extends no overrun at all to an agency with an unpaid settlement', async () => {
      await seedTerms(big.id, { dailyBlockApplications: 4 });
      await seedOpeningAgreement(big.id);

      await prisma.dailySettlement.create({
        data: {
          tenantId: big.id,
          deliveryDay: '2026-09-06',
          deliveredCalls: 100,
          submittedApplications: 10,
          windowDeliveryDays: 3,
          windowDaysFound: 3,
          windowDayKeys: [],
          overrunQuantity: 0,
          totalCharged: 500,
          maxDailyDebit: 8978,
          paymentStatus: 'FAILED',
          gracePeriodEndsOn: businessDayPeriodEnd('2026-09-06', 5),
        },
      });

      const decision = await evaluateDeliveryGate(big.id, {
        prisma,
        now: middayOf(CLOSED_DAY),
        record: false,
      });

      expect(decision.overrunWithheldForUnpaidSettlement).toBe(true);
      expect(decision.overrunCeiling).toBe(0);
    });

    it('lets a platform admin withdraw the ceiling entirely', async () => {
      await seedTerms(big.id, { dailyBlockApplications: 45 });

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/platform/delivery/agencies/${big.id}/ceiling`,
        headers: tokenFor(operatorId, null),
        payload: { ceilingPctOverride: 0, note: 'Withdrawn pending review' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.ceilingApplications).toBe(0);
      expect(response.json().data.ceilingSource).toBe('PLATFORM_OVERRIDE');
    });

    it('refuses an agency raising its own ceiling', async () => {
      await seedTerms(big.id);

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/platform/delivery/agencies/${big.id}/ceiling`,
        headers: tokenFor(big.ownerId, big.id),
        payload: { ceilingPctOverride: 5000 },
      });

      expect(response.statusCode).toBe(403);

      const profile = await prisma.agencyBillingProfile.findUnique({
        where: { tenantId: big.id },
      });
      expect(profile?.ceilingPctOverride).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Delivery gating
  // ══════════════════════════════════════════════════════════════════════════
  describe('delivery gating', () => {
    it('refuses delivery with no valid ACH mandate', async () => {
      await seedTerms(big.id, { mandate: false });
      await seedOpeningAgreement(big.id);
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 45,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });

      const decision = await evaluateDeliveryGate(big.id, { prisma, now: middayOf(CLOSED_DAY) });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('NO_MANDATE');
      // The paid block is untouched. No mandate is a pause, not a forfeiture.
      expect(decision.balance).toBe(45);
    });

    it('pauses delivery below 5%, and the paid applications survive', async () => {
      /*
       * The brief's case: "Agency crossing below 5%: delivery pauses, paid
       * applications survive."
       */
      await seedTerms(big.id);
      await seedOpeningAgreement(big.id);
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 45,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });

      const before = await evaluateDeliveryGate(big.id, {
        prisma,
        now: middayOf(CLOSED_DAY),
        record: false,
      });
      expect(before.allowed).toBe(true);

      // 300 delivered calls, 12 applications: 4.0%, below the curve's minimum.
      await seedDeliveredCalls(big.id, CLOSED_DAY, 300);
      for (let i = 0; i < 12; i++) await seedApplication(big.id, middayOf(CLOSED_DAY, i * 100));

      const { rateAgencyForClosedDay } = await import('../services/rating/rating-engine.js');
      const rating = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: CLOSED_DAY,
        prisma,
      });
      expect(rating.status).toBe('BELOW_MINIMUM');
      expect(rating.newRate).toBeNull();

      const after = await evaluateDeliveryGate(big.id, { prisma, now: middayOf(NEXT_DAY) });
      expect(after.allowed).toBe(false);
      expect(after.reason).toBe('BELOW_MINIMUM_CLOSING');

      // Paused is not terminated. Every paid application is still there.
      expect(await creditBalance(prisma, big.id)).toBe(45);
      expect(after.balance).toBe(45);

      // And an agency cannot clear its own flag: only a platform admin can, and
      // the flag stays open until they do -- a recovered window does not do it.
      const flag = await prisma.ratingReviewFlag.findFirst({
        where: { tenantId: big.id, clearedAt: null },
      });
      expect(flag).not.toBeNull();

      const { clearReviewFlag } = await import('../services/rating/rating-engine.js');
      await clearReviewFlag({ flagId: flag!.id, clearedByUserId: operatorId, prisma });

      const resumed = await evaluateDeliveryGate(big.id, {
        prisma,
        now: middayOf(NEXT_DAY),
        record: false,
      });
      expect(resumed.allowed).toBe(true);
      // The applications the agency paid for are available again, untouched.
      expect(resumed.balance).toBe(45);
    });

    it('refuses delivery to a suspended agency and restores it on resume', async () => {
      await seedTerms(big.id);
      await seedOpeningAgreement(big.id);
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 45,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });

      const suspend = await app.inject({
        method: 'POST',
        url: `/api/v1/platform/delivery/agencies/${big.id}/suspend`,
        headers: tokenFor(operatorId, null),
        payload: { reason: 'Compliance review' },
      });
      expect(suspend.statusCode).toBe(200);

      let decision = await evaluateDeliveryGate(big.id, { prisma, now: middayOf(CLOSED_DAY) });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('ADMIN_SUSPENDED');
      expect(decision.balance).toBe(45);

      await app.inject({
        method: 'POST',
        url: `/api/v1/platform/delivery/agencies/${big.id}/resume`,
        headers: tokenFor(operatorId, null),
      });

      decision = await evaluateDeliveryGate(big.id, {
        prisma,
        now: middayOf(CLOSED_DAY),
        record: false,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.balance).toBe(45);
    });

    it('refuses an enrolled agency that has no agreed rate', async () => {
      /*
       * `NO_OPENING_AGREEMENT` is defence in depth rather than a state the
       * enrolment route can produce: enrolment refuses an agency with no agreed
       * opening rate, precisely so this cannot happen. It is still asserted,
       * because an agency enrolled by a direct database write, or one whose
       * rating state was cleared afterwards, must not be delivered to at a
       * price nobody agreed.
       *
       * Note there is no rating state at all here -- `seedOpeningAgreement` is
       * deliberately not called.
       */
      await seedTerms(big.id);
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 45,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });

      const decision = await evaluateDeliveryGate(big.id, {
        prisma,
        now: middayOf(CLOSED_DAY),
        record: false,
      });
      expect(decision.enrolled).toBe(true);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('NO_OPENING_AGREEMENT');
      // And the block it paid for is still there.
      expect(decision.balance).toBe(45);
    });

    it('stops delivery when a settlement is unpaid past its Business Day grace period', async () => {
      await seedTerms(big.id);
      await seedOpeningAgreement(big.id);
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 45,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });

      /*
       * Friday 2026-09-04 fails. Five BUSINESS Days beginning that Friday runs
       * Fri 4, Tue 8, Wed 9, Thu 10, Fri 11 -- Monday the 7th is Labor Day, so
       * the holiday extends the period by a day and it ends on Friday the 11th.
       *
       * Read as calendar days it would expire on Tuesday the 8th, and the
       * agency would lose three days of a right it was granted in writing. Read
       * as Delivery Days it would be a different length for every agency.
       * Neither shows up as an error; a shortened deadline is just an earlier
       * date, which is why this is asserted rather than assumed.
       */
      const failedDay = '2026-09-04';
      const graceEnd = businessDayPeriodEnd(failedDay, 5);
      expect(graceEnd).toBe('2026-09-11');

      await prisma.dailySettlement.create({
        data: {
          tenantId: big.id,
          deliveryDay: failedDay,
          deliveredCalls: 400,
          submittedApplications: 50,
          windowDeliveryDays: 3,
          windowDaysFound: 3,
          windowDayKeys: [],
          overrunQuantity: 0,
          totalCharged: 6030,
          maxDailyDebit: 8978,
          paymentStatus: 'FAILED',
          gracePeriodEndsOn: graceEnd,
        },
      });

      // Inside the grace period: delivery holds at the paid balance but is not
      // stopped, and no overrun is extended.
      const inside = await evaluateDeliveryGate(big.id, {
        prisma,
        now: middayOf('2026-09-10'),
        record: false,
      });
      expect(inside.allowed).toBe(true);
      expect(inside.overrunCeiling).toBe(0);
      expect(inside.balance).toBe(45);

      // Past it: delivery stops entirely.
      const outside = await evaluateDeliveryGate(big.id, {
        prisma,
        now: middayOf('2026-09-14'),
        record: false,
      });
      expect(outside.allowed).toBe(false);
      expect(outside.reason).toBe('SETTLEMENT_UNPAID');
      // And still nothing has been taken away.
      expect(outside.balance).toBe(45);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. The settlement
  // ══════════════════════════════════════════════════════════════════════════
  describe('the daily settlement', () => {
    async function seedSettleableDay(tenantId: string) {
      await seedTerms(tenantId, { dailyBlockApplications: 45 });
      await seedOpeningAgreement(tenantId);
      await recordPurchase(prisma, {
        tenantId,
        deliveryDay: CLOSED_DAY,
        quantity: 45,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });
      /*
       * 440 delivered calls and 67 applications: 15.23%, at or above the flat
       * top of the curve, so $134 -- and 67 is exactly a full Daily Block of 45
       * plus a full Overrun ceiling of 22. The night's debit is therefore
       * (22 + 45) x $134 = $8,978: the Insertion Order's maximum daily debit to
       * the cent, which is the most this agency can ever be charged in a day.
       */
      await seedDeliveredCalls(tenantId, CLOSED_DAY, 440);
      await submitApplications(tenantId, CLOSED_DAY, 67);
    }

    it('bills the overrun and sells the next block as one debit', async () => {
      await seedSettleableDay(big.id);

      const result = await settleAgencyForDeliveryDay({
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        prisma,
        gateway,
      });

      // 67 applications against a block of 45: 45 consumed, 22 overrun.
      expect(result.overrunQuantity).toBe(22);
      expect(result.rate).toBe(134);
      expect(result.overrunAmount).toBe(22 * 134);

      // The balance is spent, so the whole next block is sold.
      expect(result.nextBlockQuantity).toBe(45);
      expect(result.nextBlockAmount).toBe(45 * 134);
      expect(result.totalCharged).toBe(8978);

      // One debit, for both, and exactly the contractual maximum.
      expect(gateway.achCharges).toHaveLength(1);
      expect(gateway.achCharges[0].amountCents).toBe(897_800);
      expect(result.paymentStatus).toBe('SUCCEEDED');
      expect(gateway.cardCharges).toHaveLength(0);

      // And the block is on the ledger, for the next Delivery Day.
      const purchase = await prisma.applicationCreditLedgerEntry.findFirst({
        where: { tenantId: big.id, entryType: 'PURCHASE', deliveryDay: NEXT_DAY },
      });
      expect(purchase?.quantity).toBe(45);
      expect(Number(purchase?.unitRate)).toBe(134);
      expect(purchase?.settlementId).toBe(result.settlementId);
      expect(await creditBalance(prisma, big.id)).toBe(45);
    });

    it('reduces the next block by the unused paid applications', async () => {
      await seedTerms(big.id, { dailyBlockApplications: 45 });
      await seedOpeningAgreement(big.id);
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 45,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });
      await seedDeliveredCalls(big.id, CLOSED_DAY, 300);
      // Only 40 submitted, so five paid applications go unused.
      await submitApplications(big.id, CLOSED_DAY, 40);

      const result = await settleAgencyForDeliveryDay({
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        prisma,
        gateway,
      });

      expect(result.overrunQuantity).toBe(0);
      expect(result.unusedPaidApplications ?? 0).toBeGreaterThanOrEqual(0);
      expect(result.nextBlockQuantity).toBe(40);

      const settlement = await prisma.dailySettlement.findUnique({
        where: { tenantId_deliveryDay: { tenantId: big.id, deliveryDay: CLOSED_DAY } },
      });
      expect(settlement?.unusedPaidApplications).toBe(5);
      expect(settlement?.configuredBlockQuantity).toBe(45);
      expect(settlement?.nextBlockQuantity).toBe(40);
    });

    it('charges once when the run is started twice concurrently', async () => {
      /*
       * THE requirement of this phase. Two runs for the same agency and the
       * same Delivery Day, started together, must produce one settlement row
       * and one charge. The mechanism is the unique index on
       * (tenantId, deliveryDay), not a check-then-act, and this asserts the
       * gateway rather than a flag the code sets about itself.
       */
      await seedSettleableDay(big.id);
      gateway.latencyMs = 40;

      const [first, second] = await Promise.all([
        settleAgencyForDeliveryDay({
          tenantId: big.id,
          deliveryDay: CLOSED_DAY,
          prisma,
          gateway,
        }),
        settleAgencyForDeliveryDay({
          tenantId: big.id,
          deliveryDay: CLOSED_DAY,
          prisma,
          gateway,
        }),
      ]);

      expect(gateway.achCharges).toHaveLength(1);

      const settlements = await prisma.dailySettlement.findMany({
        where: { tenantId: big.id, deliveryDay: CLOSED_DAY },
      });
      expect(settlements).toHaveLength(1);

      // Exactly one run wrote it; the other reports that it was already done.
      expect([first.alreadySettled, second.alreadySettled].sort()).toEqual([false, true]);

      // One block sold, not two.
      const purchases = await prisma.applicationCreditLedgerEntry.findMany({
        where: { tenantId: big.id, entryType: 'PURCHASE', deliveryDay: NEXT_DAY },
      });
      expect(purchases).toHaveLength(1);

      // And one payment attempt.
      const attempts = await prisma.settlementPaymentAttempt.count({
        where: { settlementId: settlements[0].id },
      });
      expect(attempts).toBe(1);
    });

    it('charges once when the run is repeated sequentially', async () => {
      await seedSettleableDay(big.id);

      await settleAgencyForDeliveryDay({
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        prisma,
        gateway,
      });
      const second = await settleAgencyForDeliveryDay({
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        prisma,
        gateway,
      });

      expect(second.alreadySettled).toBe(true);
      expect(gateway.achCharges).toHaveLength(1);
      expect(
        await prisma.applicationCreditLedgerEntry.count({
          where: { tenantId: big.id, entryType: 'PURCHASE', deliveryDay: NEXT_DAY },
        })
      ).toBe(1);
    });

    it('halts without charging when the total exceeds the maximum daily debit', async () => {
      /*
       * The brief's case. The maximum daily debit is a contractual commitment on
       * the Insertion Order, so a computed settlement above it is not clamped
       * and charged -- it is not sent to Stripe at all.
       */
      await seedSettleableDay(big.id);
      await prisma.agencyBillingProfile.update({
        where: { tenantId: big.id },
        data: { maxDailyDebit: 1000 },
      });

      const result = await settleAgencyForDeliveryDay({
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        prisma,
        gateway,
      });

      expect(result.paymentStatus).toBe('HALTED_MAX_DEBIT');
      expect(result.totalCharged).toBeGreaterThan(1000);
      expect(gateway.achCharges).toHaveLength(0);
      expect(gateway.cardCharges).toHaveLength(0);

      // No block was sold.
      expect(
        await prisma.applicationCreditLedgerEntry.count({
          where: { tenantId: big.id, entryType: 'PURCHASE', deliveryDay: NEXT_DAY },
        })
      ).toBe(0);

      // Platform admins were alerted; the agency was not told it was nearly
      // overcharged before anybody had looked at why.
      const notice = await prisma.billingNotification.findFirst({
        where: { tenantId: big.id, kind: 'MAX_DAILY_DEBIT_EXCEEDED' },
      });
      expect(notice).not.toBeNull();
      expect(notice?.toPlatform).toBe(true);
      expect(notice?.toAgency).toBe(false);

      // The settlement still records the whole computation, so a human can see
      // exactly what would have been charged and why it was not.
      const settlement = await prisma.dailySettlement.findUnique({
        where: { tenantId_deliveryDay: { tenantId: big.id, deliveryDay: CLOSED_DAY } },
      });
      expect(Number(settlement?.maxDailyDebit)).toBe(1000);
      expect(Number(settlement?.totalCharged)).toBe(result.totalCharged);
    });

    it('holds delivery, notifies and sells no block when the debit fails', async () => {
      /*
       * The brief's case: "ACH failure: delivery holds, agency and admins
       * notified, no second block sold."
       */
      await seedSettleableDay(big.id);
      gateway.declineWith = 'The bank declined the debit.';

      const result = await settleAgencyForDeliveryDay({
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        prisma,
        gateway,
      });

      expect(result.paymentStatus).toBe('FAILED');
      expect(gateway.achCharges).toHaveLength(1);

      // No second block.
      expect(
        await prisma.applicationCreditLedgerEntry.count({
          where: { tenantId: big.id, entryType: 'PURCHASE', deliveryDay: NEXT_DAY },
        })
      ).toBe(0);

      // Both the agency and platform admins were told, once.
      const notices = await prisma.billingNotification.findMany({
        where: { tenantId: big.id, kind: 'SETTLEMENT_FAILED' },
      });
      expect(notices).toHaveLength(1);
      expect(notices[0].toAgency).toBe(true);
      expect(notices[0].toPlatform).toBe(true);

      // The grace period is five BUSINESS Days from the Delivery Day, counted
      // in weekdays excluding US federal holidays.
      const settlement = await prisma.dailySettlement.findUnique({
        where: { tenantId_deliveryDay: { tenantId: big.id, deliveryDay: CLOSED_DAY } },
      });
      expect(settlement?.gracePeriodEndsOn).toBe(businessDayPeriodEnd(CLOSED_DAY, 5));

      // Delivery holds at the paid balance: still deliverable inside the grace
      // period, with no overrun extended.
      const decision = await evaluateDeliveryGate(big.id, {
        prisma,
        now: middayOf(NEXT_DAY),
        record: false,
      });
      expect(decision.overrunCeiling).toBe(0);
      expect(decision.unpaidSettlement?.deliveryDay).toBe(CLOSED_DAY);

      // The attempt is on the record.
      const attempts = await prisma.settlementPaymentAttempt.findMany({
        where: { settlementId: settlement!.id },
      });
      expect(attempts).toHaveLength(1);
      expect(attempts[0].failureMessage).toBe('The bank declined the debit.');
    });

    it('settles two agencies independently, and one failing does not block the other', async () => {
      /*
       * The brief's case. `small` has no billing profile at all, which makes it
       * unsettleable; `big` must still settle.
       */
      await seedSettleableDay(big.id);
      await seedDeliveredCalls(small.id, CLOSED_DAY, 150);

      const run = await runDailySettlement({ deliveryDay: CLOSED_DAY, prisma, gateway });

      const bigResult = run.results.find(r => r.tenantId === big.id);
      const smallResult = run.results.find(r => r.tenantId === small.id);

      expect(bigResult?.paymentStatus).toBe('SUCCEEDED');
      expect(smallResult?.skippedReason).toMatch(/no billing profile/);
      expect(gateway.achCharges).toHaveLength(1);

      // And the money is per agency: nothing in big's settlement mentions small.
      const settlements = await prisma.dailySettlement.findMany({
        where: { deliveryDay: CLOSED_DAY },
      });
      expect(settlements).toHaveLength(1);
      expect(settlements[0].tenantId).toBe(big.id);
    });

    it('settles two live agencies on the same night with independent figures', async () => {
      await seedSettleableDay(big.id);

      await seedTerms(small.id, { dailyBlockApplications: 15 });
      await seedOpeningAgreement(small.id);
      await recordPurchase(prisma, {
        tenantId: small.id,
        deliveryDay: CLOSED_DAY,
        quantity: 15,
        unitRate: 134,
        stripePaymentIntentId: 'pi_small_block',
      });
      await seedDeliveredCalls(small.id, CLOSED_DAY, 150);
      await submitApplications(small.id, CLOSED_DAY, 18);

      const run = await runDailySettlement({ deliveryDay: CLOSED_DAY, prisma, gateway });

      const bigResult = run.results.find(r => r.tenantId === big.id)!;
      const smallResult = run.results.find(r => r.tenantId === small.id)!;

      expect(bigResult.overrunQuantity).toBe(22);
      expect(smallResult.overrunQuantity).toBe(3);
      expect(bigResult.settlementId).not.toBe(smallResult.settlementId);
      expect(gateway.achCharges).toHaveLength(2);

      // Neither agency's debit is the other's.
      const amounts = gateway.achCharges.map(c => c.amountCents).sort((a, b) => a - b);
      expect(amounts[0]).toBeLessThan(amounts[1]);
    });

    it("refuses to update a settlement's figures once written", async () => {
      await seedSettleableDay(big.id);
      const result = await settleAgencyForDeliveryDay({
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        prisma,
        gateway,
      });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "daily_settlements" SET "totalCharged" = 1 WHERE "id" = '${result.settlementId!}'`
        )
      ).rejects.toThrow(/immutable/i);
    });

    it('records a settlement even when there is nothing to charge', async () => {
      // A day the job ran and found nothing to bill and a day the job did not
      // run are different things, and only one of them is fine.
      await seedTerms(big.id, { dailyBlockApplications: 0 });
      await seedOpeningAgreement(big.id);

      const result = await settleAgencyForDeliveryDay({
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        prisma,
        gateway,
      });

      expect(result.paymentStatus).toBe('NOT_CHARGED');
      expect(result.totalCharged).toBe(0);
      expect(gateway.achCharges).toHaveLength(0);
      expect(
        await prisma.dailySettlement.count({ where: { tenantId: big.id, deliveryDay: CLOSED_DAY } })
      ).toBe(1);
    });

    it('records a ledger row at settlement for an application the hook missed', async () => {
      /*
       * The consumption hook can fail -- a database blip between the carrier
       * accepting an application and our write. Without reconciliation that
       * application would be delivered, submitted and never charged.
       */
      await seedTerms(big.id, { dailyBlockApplications: 45 });
      await seedOpeningAgreement(big.id);
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 2,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });
      await seedDeliveredCalls(big.id, CLOSED_DAY, 100);

      // Three applications submitted, none of them recorded on the ledger.
      for (let i = 0; i < 3; i++) await seedApplication(big.id, middayOf(CLOSED_DAY, i * 100));
      expect(
        await prisma.applicationCreditLedgerEntry.count({
          where: { tenantId: big.id, entryType: { in: ['CONSUMPTION', 'OVERRUN'] } },
        })
      ).toBe(0);

      const result = await settleAgencyForDeliveryDay({
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        prisma,
        gateway,
      });

      // Two spent the credits that existed; the third is overrun and is billed.
      expect(result.overrunQuantity).toBe(1);
      expect(await creditBalance(prisma, big.id)).toBeGreaterThanOrEqual(0);
    });

    it('never charges an amount taken from a request', async () => {
      /*
       * The settlement run endpoint takes a Delivery Day and, optionally, which
       * agencies. It takes no amount, no rate and no quantity, and a body
       * carrying them changes nothing about what is charged.
       */
      await seedSettleableDay(big.id);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/platform/delivery/settlement/run',
        headers: tokenFor(operatorId, null),
        payload: {
          deliveryDay: CLOSED_DAY,
          tenantIds: [big.id],
          // All ignored.
          totalCharged: 1,
          rate: 1,
          overrunQuantity: 0,
          nextBlockQuantity: 0,
          amount: 1,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(gateway.achCharges).toHaveLength(0); // the route uses the real gateway

      const settlement = await prisma.dailySettlement.findUnique({
        where: { tenantId_deliveryDay: { tenantId: big.id, deliveryDay: CLOSED_DAY } },
      });
      // Stripe is not enabled in the test environment, so the debit is recorded
      // as failed rather than as money that moved -- but the FIGURES are the
      // server's, not the browser's.
      expect(Number(settlement?.totalCharged)).toBe(8978);
      expect(Number(settlement?.rate)).toBe(134);
    });

    it('refuses an agency running the settlement', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/platform/delivery/settlement/run',
        headers: tokenFor(big.ownerId, big.id),
        payload: { deliveryDay: CLOSED_DAY },
      });

      expect(response.statusCode).toBe(403);
      expect(await prisma.dailySettlement.count()).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. What the portal shows
  // ══════════════════════════════════════════════════════════════════════════
  describe('the portal', () => {
    it('separates today from the window, and the current rate from the tracking rate', async () => {
      await seedTerms(big.id, { dailyBlockApplications: 45 });
      await seedOpeningAgreement(big.id, 159);
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 45,
        unitRate: 159,
        stripePaymentIntentId: 'pi_block',
      });

      const now = middayOf(CLOSED_DAY, 20 * 60_000);
      await seedDeliveredCalls(big.id, CLOSED_DAY, 100);
      await submitApplications(big.id, CLOSED_DAY, 15);

      const { getDeliveryToday } = await import('../services/billing/delivery-view.js');
      const view = await getDeliveryToday(big.id, { prisma, now });

      expect(view.callsAnswered).toBe(100);
      expect(view.applicationsSubmitted).toBe(15);
      expect(view.todayClosingPct).toBeCloseTo(15, 5);

      // The window that set the rate in force is a different number, and it is
      // reported separately rather than being computed from today's.
      expect(view.windowClosingPct).toBeNull(); // never rated yet
      expect(view.currentRate).toBe(159);
      expect(view.trackingRate).toBe(134); // 15% prices at the flat top anchor

      expect(view.applicationsRemainingOnBlock).toBe(30);
      expect(view.overrunToday).toBe(0);
      expect(view.distanceToCeiling).toBe(22);

      // Projected: nothing overrun yet, and the next block is the shortfall.
      expect(view.projectedNextBlockQuantity).toBe(15);
      expect(view.projectedTotalCharge).toBe(15 * 134);
    });

    it('ranks agents by closing percentage and keeps unattributed calls visible', async () => {
      await seedTerms(big.id);
      await seedOpeningAgreement(big.id);

      const ownerRole = await prisma.role.findFirst({ where: { name: 'OWNER' } });
      const alice = await prisma.user.create({
        data: {
          tenantId: big.id,
          email: `alice-${Math.random().toString(36).slice(2, 8)}@test.local`,
          firstName: 'Alice',
          lastName: 'Nguyen',
          status: 'ACTIVE',
          roles: { create: { roleId: ownerRole!.id } },
        },
      });
      const bob = await prisma.user.create({
        data: {
          tenantId: big.id,
          email: `bob-${Math.random().toString(36).slice(2, 8)}@test.local`,
          firstName: 'Bob',
          lastName: 'Ortiz',
          status: 'ACTIVE',
        },
      });

      // Alice: 10 calls, 3 applications. Bob: 10 calls, 1 application.
      for (let i = 0; i < 10; i++) {
        await seedCall({
          tenantId: big.id,
          answeredAt: middayOf(CLOSED_DAY, i * 1000),
          answeredByUserId: alice.id,
          connectedDuration: 300,
        });
        await seedCall({
          tenantId: big.id,
          answeredAt: middayOf(CLOSED_DAY, 100_000 + i * 1000),
          answeredByUserId: bob.id,
          connectedDuration: 120,
        });
      }
      // Two calls with no agent recorded at all.
      await seedCall({ tenantId: big.id, answeredAt: middayOf(CLOSED_DAY, 500_000) });
      await seedCall({ tenantId: big.id, answeredAt: middayOf(CLOSED_DAY, 501_000) });

      for (let i = 0; i < 3; i++) {
        await prisma.insuranceCarrierApplication.create({
          data: {
            tenantId: big.id,
            firstName: 'A',
            lastName: `App ${i}`,
            status: 'SUBMITTED',
            submittedAt: middayOf(CLOSED_DAY, i * 100),
            createdById: alice.id,
          },
        });
      }
      await prisma.insuranceCarrierApplication.create({
        data: {
          tenantId: big.id,
          firstName: 'B',
          lastName: 'App',
          status: 'SUBMITTED',
          submittedAt: middayOf(CLOSED_DAY, 400),
          createdById: bob.id,
        },
      });

      const { getAgentBreakdown } = await import('../services/billing/delivery-view.js');
      const { agents } = await getAgentBreakdown(big.id, { prisma, day: CLOSED_DAY });

      /*
       * Sorted by closing percentage ASCENDING, weakest first. Phase 4 flipped
       * this: it used to lead with the best closer, which is a leaderboard on a
       * screen whose purpose is deciding who to coach or pull off the queue.
       */
      expect(agents[0].name).toBe('Bob Ortiz');
      expect(agents[0].closingPct).toBeCloseTo(10, 5);
      expect(agents[1].name).toBe('Alice Nguyen');
      expect(agents[1].closingPct).toBeCloseTo(30, 5);
      expect(agents[1].talkTimeSeconds).toBe(3000);

      /*
       * The unattributed calls are shown, not dropped: the table's total has to
       * reconcile with the agency total. But they are held at the BOTTOM. That
       * row closes at 0% and would otherwise lead an ascending table -- and it
       * is not a person, so nobody can be coached about it.
       */
      const unattributed = agents.find(a => a.userId === null);
      expect(unattributed?.callsTaken).toBe(2);
      expect(agents[agents.length - 1].userId).toBeNull();
      expect(agents.reduce((sum, a) => sum + a.callsTaken, 0)).toBe(22);

      // Hours were never recorded, so occupancy is null rather than 0%.
      expect(agents[0].occupancyPct).toBeNull();
    });

    it("shows an agent their own numbers and no money at all", async () => {
      await seedTerms(big.id);
      await seedOpeningAgreement(big.id);

      const agent = await prisma.user.create({
        data: {
          tenantId: big.id,
          email: `agent-${Math.random().toString(36).slice(2, 8)}@test.local`,
          status: 'ACTIVE',
        },
      });

      for (let i = 0; i < 5; i++) {
        await seedCall({
          tenantId: big.id,
          answeredAt: middayOf(CLOSED_DAY, i * 1000),
          answeredByUserId: agent.id,
        });
      }
      await seedCall({ tenantId: big.id, answeredAt: middayOf(CLOSED_DAY, 90_000) });
      await prisma.insuranceCarrierApplication.create({
        data: {
          tenantId: big.id,
          firstName: 'A',
          lastName: 'App',
          status: 'SUBMITTED',
          submittedAt: middayOf(CLOSED_DAY),
          createdById: agent.id,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/delivery/me?day=${CLOSED_DAY}`,
        headers: tokenFor(agent.id, big.id),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json().data;

      expect(body.callsTaken).toBe(5);
      expect(body.applications).toBe(1);
      expect(body.closingPct).toBeCloseTo(20, 5);
      expect(body.agencyCallsTaken).toBe(6);

      // No pricing, no money. Not "not rendered" -- not present.
      const serialised = JSON.stringify(body);
      for (const forbidden of ['rate', 'balance', 'overrun', 'charge', 'amount', 'Rate']) {
        expect(serialised).not.toContain(forbidden);
      }
    });

    it('serves the settlement history as CSV carrying every figure', async () => {
      await seedTerms(big.id, { dailyBlockApplications: 45 });
      await seedOpeningAgreement(big.id);
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 45,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });
      await seedDeliveredCalls(big.id, CLOSED_DAY, 440);
      await submitApplications(big.id, CLOSED_DAY, 67);
      await settleAgencyForDeliveryDay({
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        prisma,
        gateway,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/delivery/settlements.csv',
        headers: tokenFor(big.ownerId, big.id),
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/csv/);

      const lines = response.body.trim().split('\n');
      expect(lines[0]).toContain('delivery_day');
      expect(lines[0]).toContain('overrun_amount');
      expect(lines[0]).toContain('total_charged');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain(CLOSED_DAY);
      expect(lines[1]).toContain('8978');
    });

    it('never shows one agency another agency settlement', async () => {
      await seedTerms(small.id, { dailyBlockApplications: 15 });
      await seedOpeningAgreement(small.id);
      await prisma.dailySettlement.create({
        data: {
          tenantId: small.id,
          deliveryDay: CLOSED_DAY,
          deliveredCalls: 150,
          submittedApplications: 20,
          windowDeliveryDays: 3,
          windowDaysFound: 3,
          windowDayKeys: [],
          totalCharged: 2680,
          maxDailyDebit: 2948,
          paymentStatus: 'SUCCEEDED',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/delivery/settlements',
        headers: tokenFor(big.ownerId, big.id),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(0);
    });

    it('gives the cross-agency view to platform staff and refuses an agency', async () => {
      await seedTerms(big.id);
      await seedOpeningAgreement(big.id);
      await seedDeliveredCalls(big.id, CLOSED_DAY, 100);

      const refused = await app.inject({
        method: 'GET',
        url: `/api/v1/platform/delivery/overview?day=${CLOSED_DAY}`,
        headers: tokenFor(big.ownerId, big.id),
      });
      expect(refused.statusCode).toBe(403);

      const allowed = await app.inject({
        method: 'GET',
        url: `/api/v1/platform/delivery/overview?day=${CLOSED_DAY}`,
        headers: tokenFor(operatorId, null),
      });
      expect(allowed.statusCode).toBe(200);

      const rows = allowed.json().data.agencies;
      expect(rows).toHaveLength(2);

      const bigRow = rows.find((r: any) => r.tenantId === big.id);
      expect(bigRow.deliveredCalls).toBe(100);
      expect(bigRow.settlement.status).toBe('NOT_YET_RUN');
      expect(bigRow.flags.noValidMandate).toBe(false);

      /*
       * `small` has no billing profile, so it is not enrolled -- and an
       * unenrolled agency carries NO flags. Flagging it "no valid mandate"
       * would put a red badge on every tenant that has not been onboarded and
       * bury the one that genuinely needs attention.
       */
      const smallRow = rows.find((r: any) => r.tenantId === small.id);
      expect(smallRow.deliveredCalls).toBe(0);
      expect(smallRow.enrolled).toBe(false);
      expect(smallRow.flags.noValidMandate).toBe(false);
      expect(Object.values(smallRow.flags).every((f) => f === false)).toBe(true);
      expect(smallRow.settlement.status).toBe('NOT_ENROLLED');

      // An ENROLLED agency that then loses its mandate is flagged, which is the
      // case the flag exists for.
      await seedTerms(small.id, { dailyBlockApplications: 15, mandate: false });
      const afterEnrolment = await app.inject({
        method: 'GET',
        url: `/api/v1/platform/delivery/overview?day=${CLOSED_DAY}`,
        headers: tokenFor(operatorId, null),
      });
      const flagged = afterEnrolment
        .json()
        .data.agencies.find((r: any) => r.tenantId === small.id);
      expect(flagged.enrolled).toBe(true);
      expect(flagged.flags.noValidMandate).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5b. The settlement export — what a dry run is invoiced from
  //
  // The dry run is three Delivery Days and it is invoiced BY HAND. At 45
  // applications a day the larger agency generates $6,030 of production daily,
  // so "we were watching the numbers" is not a reason to give the period away.
  // The export therefore has to carry enough to raise an invoice from the file
  // alone, and to separate the days that took money from the days that did not.
  // ══════════════════════════════════════════════════════════════════════════
  describe('the settlement export', () => {
    /** One settlement row on `day`, written directly so the figures are exact. */
    async function seedSettlement(
      tenantId: string,
      day: string,
      overrides: Partial<{
        deliveredCalls: number;
        submittedApplications: number;
        paymentStatus: 'DRY_RUN' | 'SUCCEEDED' | 'FAILED' | 'HALTED_MAX_DEBIT';
        totalCharged: number;
      }> = {}
    ) {
      return prisma.dailySettlement.create({
        data: {
          tenantId,
          deliveryDay: day,
          deliveredCalls: overrides.deliveredCalls ?? 440,
          submittedApplications: overrides.submittedApplications ?? 67,
          windowClosingPct: 15.2273,
          windowDeliveryDays: 3,
          windowDaysFound: 3,
          windowDayKeys: [day],
          rate: 134,
          curveVersion: 1,
          overrunQuantity: 22,
          overrunAmount: 2948,
          configuredBlockQuantity: 45,
          unusedPaidApplications: 0,
          nextBlockQuantity: 45,
          nextBlockAmount: 6030,
          totalCharged: overrides.totalCharged ?? 8978,
          maxDailyDebit: 8978,
          paymentStatus: overrides.paymentStatus ?? 'DRY_RUN',
        },
      });
    }

    /**
     * Every cell is quoted -- the export is a file a finance team opens in
     * Excel, and an unquoted cell beginning `=` is a formula -- so reading it
     * back means unquoting it.
     */
    function parseLine(line: string): string[] {
      const cells: string[] = [];
      let cell = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (quoted) {
          if (char !== '"') cell += char;
          else if (line[i + 1] === '"') (cell += '"'), i++;
          else quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === ',') (cells.push(cell), (cell = ''));
        else cell += char;
      }
      cells.push(cell);
      return cells;
    }

    function parse(body: string): { header: string[]; rows: string[][] } {
      const [head, ...rest] = body.trim().split('\n');
      return { header: parseLine(head), rows: rest.map(parseLine) };
    }

    async function exportCsv(query: string) {
      return app.inject({
        method: 'GET',
        url: `/api/v1/platform/delivery/settlements.csv${query}`,
        headers: tokenFor(operatorId, null),
      });
    }

    it('carries every figure an invoice is raised from', async () => {
      await seedSettlement(big.id, CLOSED_DAY);

      const response = await exportCsv('');
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/csv/);
      expect(response.headers['content-disposition']).toMatch(/settlements-all-/);

      const { header, rows } = parse(response.body);

      // Everything asked for, by name, so a missing column fails here rather
      // than in a spreadsheet at invoicing time.
      for (const column of [
        'agency',
        'delivery_day',
        'delivered_calls',
        'submitted_applications',
        'day_closing_pct',
        'rate',
        'curve_version',
        'overrun_quantity',
        'overrun_amount',
        'next_block_quantity',
        'next_block_amount',
        'total_charged',
        'payment_status',
      ]) {
        expect(header).toContain(column);
      }

      expect(rows).toHaveLength(1);
      const row = Object.fromEntries(header.map((name, i) => [name, rows[0][i]]));
      expect(row.agency).toContain('Ridgeline');
      expect(row.tenant_id).toBe(big.id);
      expect(row.delivery_day).toBe(CLOSED_DAY);
      expect(row.delivered_calls).toBe('440');
      expect(row.submitted_applications).toBe('67');
      expect(row.rate).toBe('134');
      expect(row.curve_version).toBe('1');
      expect(row.overrun_quantity).toBe('22');
      expect(row.overrun_amount).toBe('2948');
      expect(row.next_block_quantity).toBe('45');
      expect(row.next_block_amount).toBe('6030');
      expect(row.total_charged).toBe('8978');
      expect(row.payment_status).toBe('DRY_RUN');

      // The DAY's closing percentage, derived from the two counts on the row
      // rather than stored beside them: 67 / 440.
      expect(Number(row.day_closing_pct)).toBeCloseTo(15.2273, 4);
      // And it is a different number from the trailing window that set the
      // rate, which is why both are present under names that say which.
      expect(header).toContain('window_closing_pct');
    });

    it('filters to an inclusive Delivery Day range', async () => {
      for (const day of ['2026-09-05', '2026-09-06', CLOSED_DAY, '2026-09-08']) {
        await seedSettlement(big.id, day);
      }

      const { rows } = parse((await exportCsv(`?from=2026-09-06&to=${CLOSED_DAY}`)).body);
      expect(rows.map(row => row[2])).toEqual(['2026-09-06', CLOSED_DAY]);
    });

    it('separates the days that took money from the days that did not', async () => {
      await seedSettlement(big.id, '2026-09-05', { paymentStatus: 'DRY_RUN' });
      await seedSettlement(big.id, '2026-09-06', { paymentStatus: 'DRY_RUN' });
      await seedSettlement(big.id, CLOSED_DAY, { paymentStatus: 'SUCCEEDED' });

      const dryRun = parse((await exportCsv('?mode=DRY_RUN')).body);
      expect(dryRun.rows.map(row => row[2])).toEqual(['2026-09-05', '2026-09-06']);

      const charged = parse((await exportCsv('?mode=CHARGED')).body);
      expect(charged.rows.map(row => row[2])).toEqual([CLOSED_DAY]);

      const all = parse((await exportCsv('?mode=ALL')).body);
      expect(all.rows).toHaveLength(3);
    });

    it('counts a failed or halted day as charged, not as a dry run', async () => {
      /*
       * Charging was in force on both: one was sent to Stripe and declined,
       * the other never went because it breached the maximum daily debit.
       * Neither is a dry run, and leaving them out of the charged export would
       * make a reconciler think the day was never settled at all.
       */
      await seedSettlement(big.id, '2026-09-05', { paymentStatus: 'FAILED' });
      await seedSettlement(big.id, '2026-09-06', { paymentStatus: 'HALTED_MAX_DEBIT' });
      await seedSettlement(big.id, CLOSED_DAY, { paymentStatus: 'DRY_RUN' });

      const charged = parse((await exportCsv('?mode=CHARGED')).body);
      expect(charged.rows.map(row => row[2])).toEqual(['2026-09-05', '2026-09-06']);
      expect(parse((await exportCsv('?mode=DRY_RUN')).body).rows).toHaveLength(1);
    });

    it('spans every agency, and narrows to one on request', async () => {
      await seedSettlement(big.id, CLOSED_DAY);
      await seedSettlement(small.id, CLOSED_DAY);

      const both = parse((await exportCsv('')).body);
      expect(both.rows).toHaveLength(2);
      expect(both.rows.map(row => row[1]).sort()).toEqual([big.id, small.id].sort());

      const one = parse((await exportCsv(`?tenantId=${small.id}`)).body);
      expect(one.rows).toHaveLength(1);
      expect(one.rows[0][1]).toBe(small.id);
    });

    it('refuses a malformed date or an unknown mode rather than exporting the lot', async () => {
      expect((await exportCsv('?from=07-09-2026')).statusCode).toBe(400);
      expect((await exportCsv(`?from=${CLOSED_DAY}&to=nonsense`)).statusCode).toBe(400);
      expect((await exportCsv('?mode=SOMETHING')).statusCode).toBe(400);
    });

    it('does not hand a finance team a spreadsheet formula', async () => {
      /*
       * The agency name is the one free-text field in this file, and this file
       * is opened in Excel by somebody raising an invoice. A cell beginning
       * `=`, `+`, `-` or `@` is evaluated there, so it is quoted and prefixed
       * rather than trusted.
       */
      await prisma.tenant.update({
        where: { id: big.id },
        data: { name: '=1+1' },
      });
      await seedSettlement(big.id, CLOSED_DAY);

      const response = await exportCsv('');
      expect(response.body).toContain(`"'=1+1"`);

      const row = parse(response.body).rows[0];
      expect(row[0]).toBe("'=1+1");
    });

    it('is platform staff only', async () => {
      await seedSettlement(big.id, CLOSED_DAY);
      await seedSettlement(small.id, CLOSED_DAY);

      // An agency principal, with a perfectly good token, asking for the
      // export that contains every other agency's revenue.
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/platform/delivery/settlements.csv',
        headers: tokenFor(big.ownerId, big.id),
      });
      expect(response.statusCode).toBe(403);
      expect(response.body).not.toContain(small.id);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. No refunds, anywhere
  // ══════════════════════════════════════════════════════════════════════════
  describe('there are no refunds', () => {
    it('has no refund, credit, reversal or make-good in the ledger vocabulary', async () => {
      const types = await prisma.$queryRawUnsafe<Array<{ enumlabel: string }>>(
        `SELECT e.enumlabel FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'CreditLedgerEntryType'`
      );
      const labels = types.map(t => t.enumlabel).sort();

      /*
       * The whole vocabulary, listed exactly, so a fourth member cannot be
       * added without somebody deciding here what it means.
       *
       * DRY_RUN_CLOSEOUT is the only one that reduces a balance without an
       * application behind it, and it is NOT a refund. It retires credits
       * issued by a dry-run settlement -- credits that were never sold, never
       * invoiced and never paid for, created so an agency could keep
       * delivering while its numbers were watched. Nothing is returned to
       * anybody and no money moves in either direction, which is why those
       * rows carry a null `amount`. A refund, credit, reversal, rebate or
       * make-good would give back something that was paid for, and none of
       * those exists here.
       */
      expect(labels).toEqual([
        'CONSUMPTION',
        'DRY_RUN_CLOSEOUT',
        'OVERRUN',
        'PURCHASE',
      ]);

      // And no money is attached to one, ever.
      const withMoney = await prisma.applicationCreditLedgerEntry.count({
        where: { entryType: 'DRY_RUN_CLOSEOUT', OR: [{ amount: { not: null } }, { stripePaymentIntentId: { not: null } }] },
      });
      expect(withMoney).toBe(0);
    });

    it('does not return a credit when a carrier declines after submission', async () => {
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: CLOSED_DAY,
        quantity: 5,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });

      const [applicationId] = await submitApplications(big.id, CLOSED_DAY, 1);
      expect(await creditBalance(prisma, big.id)).toBe(4);

      // The carrier declines it afterwards. Nothing about that is an input to
      // anything, and the balance does not move.
      await prisma.insuranceCarrierApplication.update({
        where: { id: applicationId },
        data: { status: 'DECLINED' },
      });

      expect(await creditBalance(prisma, big.id)).toBe(4);
      const entries = await prisma.applicationCreditLedgerEntry.findMany({
        where: { tenantId: big.id },
      });
      expect(entries.filter(e => e.quantity > 0)).toHaveLength(1); // the purchase only
    });
  });
});
