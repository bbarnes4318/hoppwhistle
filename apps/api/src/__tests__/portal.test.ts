/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { hash } from 'bcryptjs';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { recordPurchase } from '../services/billing/credit-ledger.js';
import { settleAgencyForDeliveryDay } from '../services/billing/settlement.js';
import { maxDailyDebitFor } from '../services/billing/terms.js';
import { calendarDayBounds } from '../services/rating/calendar-day.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Phase 4: the portal an agency principal runs their business on.
 *
 * ── What this suite is for ───────────────────────────────────────────────────
 *
 * An agency's cost per application is set by a number their own team produces.
 * This portal is the only place they can watch that number move and the only
 * place they can see which agent is moving it. If it is vague, the pricing
 * model reads as arbitrary and every rate change becomes an argument.
 *
 * So the properties asserted here are the ones that decide whether the screen
 * can be trusted and acted on:
 *
 *   1. AN UNENROLLED AGENCY SEES NO BILLING FIGURES. Not zeroes -- an agency
 *      told it has 0 applications remaining reasonably concludes its phones are
 *      about to stop.
 *   2. THE TWO CLOSING PERCENTAGES ARE BOTH PRESENT AND SEPARATE. "Today so
 *      far" prices nothing; the trailing window sets the rate. An agency that
 *      confuses them believes a good morning has already cut their price.
 *   3. THE PER-AGENT TABLE PUTS THE WORST CLOSERS FIRST and carries the
 *      agency's own figure to read them against.
 *   4. A SETTLEMENT EXPANDS TO VALUES THAT RECOMPUTE TO ITS STORED RATE. A
 *      panel that restates the rate proves nothing; this one is checkable.
 *   5. AN AGENT SEES THEIR OWN ROW AND NO MONEY.
 *   6. AN AGENCY CANNOT REACH THE CROSS-AGENCY VIEW, and a platform admin with
 *      no acting tenant CAN, without a 401.
 */

const gate = databaseGate();
announceSkip('Phase 4: the agency portal', gate);

const TEST_JWT_SECRET = 'portal-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Phase 4 suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `portal suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Phase 4: the agency portal', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  let big: { id: string; ownerId: string };
  let small: { id: string; ownerId: string };
  let operatorId: string;

  /** Today, because the live panel is about today and nothing else. */
  let TODAY: string;
  let YESTERDAY: string;

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
      'agent_state_events',
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
      'time_entries',
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
          id: '00000000-0000-4000-8000-00000000d001',
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
        activeCurveVersionId: '00000000-0000-4000-8000-00000000d001',
      },
      update: { activeCurveVersionId: '00000000-0000-4000-8000-00000000d001' },
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

  /** Enrolled and charging unless told otherwise, as in the Phase 3 suite. */
  async function seedTerms(
    tenantId: string,
    overrides: Partial<{ dailyBlockApplications: number; enrolled: boolean }> = {}
  ) {
    const block = overrides.dailyBlockApplications ?? 45;
    const enrolled = overrides.enrolled ?? true;

    const fields = {
      dailyBlockApplications: block,
      maxDailyDebit: maxDailyDebitFor(block, 50, 134),
      ceilingPctBelowThreshold: 50,
      stripeCustomerId: 'cus_fake',
      achPaymentMethodId: 'pm_fake',
      achMandateStatus: 'ACTIVE' as const,
      achMandateVerifiedAt: new Date(),
      achBankName: 'Test Bank',
      achLast4: '6789',
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

  /**
   * A closed availability span on TODAY that has actually already happened.
   *
   * ── Why this is not just `middayOf(TODAY)` ─────────────────────────────────
   *
   * `availableSecondsByUser` clips every span at this instant -- an open state
   * on today runs to now, not to midnight, because reporting an agent as
   * available for hours they have not worked yet is the defect that clip
   * exists for. A fixture anchored at midday is therefore in the FUTURE on any
   * run before local noon, every span clips to nothing, and the test reads 0.
   *
   * It failed exactly that way in CI at 01:29 Eastern and passed on the same
   * code at 23:11 the evening before, which is a test that is wrong twice a
   * day rather than a defect in the read.
   *
   * So the span is anchored BACKWARDS from now instead, clipped into the day,
   * and the caller asserts the length this returns. `seconds` is the length of
   * the span these two rows describe; the read has to arrive at the same
   * number from the rows themselves. On any ordinary run that is the full
   * requested length, and in the first minutes after midnight it is however
   * much of the day has actually elapsed -- which is still the right answer to
   * "how long was this agent available today".
   */
  function pastSpanToday(seconds: number): { start: Date; end: Date; seconds: number } {
    const dayStart = calendarDayBounds(TODAY).start.getTime();
    // A minute back from now, so the route's own `now` -- taken milliseconds
    // after this -- is never earlier than the closing row.
    const end = Math.max(dayStart, Date.now() - 60_000);
    const start = Math.max(dayStart, end - seconds * 1000);
    return {
      start: new Date(start),
      end: new Date(end),
      seconds: Math.round((end - start) / 1000),
    };
  }

  /**
   * An OPEN availability on TODAY: one row and no closing row.
   *
   * The sibling of `pastSpanToday` for the case where the point of the test is
   * that there is nothing to close the span -- the read has to run it to this
   * instant rather than to midnight.
   *
   * `start` is clipped into the day for the same reason the closed span is:
   * `availableSecondsByUser` clips every span to the day being asked about, so
   * a start in yesterday contributes nothing before midnight. A fixture at a
   * flat `now - 1h` is therefore short by however much of that hour fell in
   * yesterday, which is all of it at 00:00 and none of it from 01:00 -- a test
   * that fails for the first hour of every day.
   *
   * `seconds` is what has actually elapsed since `start`, which is the full
   * hour on an ordinary run and less than it just after midnight. Either way it
   * is the right answer to "how long has this agent been available today", and
   * either way it is nowhere near midnight, which is the property under test.
   */
  function openSpanToday(seconds: number): { start: Date; seconds: number } {
    const dayStart = calendarDayBounds(TODAY).start.getTime();
    const now = Date.now();
    const start = Math.max(dayStart, now - seconds * 1000);
    return { start: new Date(start), seconds: Math.round((now - start) / 1000) };
  }

  let callSeq = 0;

  async function seedCall(params: {
    tenantId: string;
    answeredAt: Date | null;
    answeredByUserId?: string | null;
    endedAt?: Date | null;
    connectedDuration?: number;
  }) {
    callSeq += 1;
    return prisma.call.create({
      data: {
        tenantId: params.tenantId,
        callSid: `sid-p4-${callSeq}-${Math.random().toString(36).slice(2, 8)}`,
        toNumber: '+15550000000',
        status: params.answeredAt ? 'COMPLETED' : 'NO_ANSWER',
        direction: 'INBOUND',
        answeredAt: params.answeredAt,
        answeredByUserId: params.answeredByUserId ?? null,
        endedAt: params.endedAt === undefined ? params.answeredAt : params.endedAt,
        connectedDuration: params.connectedDuration ?? (params.answeredAt ? 120 : 0),
        blocked: false,
      },
    });
  }

  async function seedDeliveredCalls(
    tenantId: string,
    day: string,
    count: number,
    answeredByUserId?: string
  ) {
    for (let i = 0; i < count; i++) {
      await seedCall({ tenantId, answeredAt: middayOf(day, i * 1000), answeredByUserId });
    }
  }

  let appSeq = 0;

  async function seedApplication(
    tenantId: string,
    submittedAt: Date | null,
    createdById?: string
  ) {
    appSeq += 1;
    return prisma.insuranceCarrierApplication.create({
      data: {
        tenantId,
        firstName: 'Test',
        lastName: `Applicant ${appSeq}`,
        status: submittedAt ? 'SUBMITTED' : 'PENDING',
        submittedAt,
        createdById: createdById ?? null,
      },
    });
  }

  async function seedAgent(tenantId: string, name: string) {
    return prisma.user.create({
      data: {
        tenantId,
        email: `${name.toLowerCase()}-${Math.random().toString(36).slice(2, 7)}@agent.test`,
        firstName: name,
        lastName: 'Agent',
        status: 'ACTIVE',
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
    await ensureLaunchCurve();

    const now = new Date();
    const { currentCalendarDay, previousCalendarDay } = await import(
      '../services/rating/calendar-day.js'
    );
    TODAY = currentCalendarDay(now);
    YESTERDAY = previousCalendarDay(TODAY);

    const ownerRole = await prisma.role.create({
      data: { name: 'OWNER', description: 'OWNER role', permissions: ['admin:*'] },
    });

    big = await seedAgency('Ridgeline', ownerRole.id);
    small = await seedAgency('Fairhaven', ownerRole.id);

    const operator = await prisma.user.create({
      data: { email: 'operator@netenroll.test', status: 'ACTIVE', tenantId: null },
    });
    operatorId = operator.id;
    await grantPlatformAdmin(operatorId, { note: 'portal suite fixture' });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. The principal's live view
  // ══════════════════════════════════════════════════════════════════════════
  describe("the principal's live view", () => {
    it('shows an unenrolled agency its operational figures and no billing figures', async () => {
      /*
       * THE case for the panel. An unenrolled agency is not gated, not metered
       * and not settled, so every billing figure the server can produce for it
       * is a zero that means "not measured". A principal reading "0 remaining
       * on the block" would reasonably conclude their phones are about to stop,
       * which is the opposite of the truth.
       *
       * So: `enrolled: false`, the operational counts real, and every money
       * figure absent rather than zero.
       */
      const agent = await seedAgent(big.id, 'Dana');
      await seedDeliveredCalls(big.id, TODAY, 12, agent.id);
      await seedApplication(big.id, middayOf(TODAY), agent.id);
      await seedApplication(big.id, middayOf(TODAY, 1000), agent.id);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/delivery/today',
        headers: tokenFor(big.ownerId, big.id),
      });

      expect(response.statusCode).toBe(200);
      const data = response.json().data;

      expect(data.enrolled).toBe(false);

      // The operational figures are real, not suppressed. An agency not in the
      // billing system still runs a floor and still needs to see it.
      expect(data.callsAnswered).toBe(12);
      expect(data.applicationsSubmitted).toBe(2);
      expect(data.todayClosingPct).toBeCloseTo((2 / 12) * 100, 6);

      // And nothing that is about money is a number.
      expect(data.currentRate).toBeNull();
      expect(data.trackingRate).toBeNull();
      expect(data.overrunAmountTonight).toBeNull();
      expect(data.projectedTotalCharge).toBeNull();

      // Nothing was recorded on its behalf by looking at a screen.
      expect(await prisma.deliveryHoldEvent.count({ where: { tenantId: big.id } })).toBe(0);
      expect(await prisma.applicationCreditLedgerEntry.count({ where: { tenantId: big.id } })).toBe(
        0
      );
    });

    it('carries both closing percentages, separately, and neither derived from the other', async () => {
      /*
       * The thing most likely to start an argument. "Today so far" moves all
       * day and prices nothing; the trailing window is what actually set the
       * rate in force. They are different numbers under different names, and
       * the window one names the days it covers so an agency can reconstruct
       * it.
       *
       * Yesterday closes at 15% and today at 5%, so if the two were ever
       * conflated the test would see one number where it expects two very
       * different ones.
       */
      await seedTerms(big.id);
      await seedOpeningAgreement(big.id);
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: YESTERDAY,
        quantity: 45,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });

      await seedDeliveredCalls(big.id, YESTERDAY, 100);
      for (let i = 0; i < 15; i++) await seedApplication(big.id, middayOf(YESTERDAY, i * 1000));

      /*
       * Settle yesterday, so a rate change exists. The window the panel reports
       * is the one that ACTUALLY set the rate in force -- read off the recorded
       * rate change, not recomputed live -- because a recomputation would drift
       * the moment a late call landed and the agency would see a percentage
       * that never matched the row they would be shown in a dispute.
       */
      await settleAgencyForDeliveryDay({ tenantId: big.id, deliveryDay: YESTERDAY, prisma });

      await seedDeliveredCalls(big.id, TODAY, 100);
      for (let i = 0; i < 5; i++) await seedApplication(big.id, middayOf(TODAY, i * 1000));

      const data = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/delivery/today',
          headers: tokenFor(big.ownerId, big.id),
        })
      ).json().data;

      // Two fields, two values, and they are genuinely different.
      expect(data.todayClosingPct).toBeCloseTo(5, 6);
      expect(data.windowClosingPct).not.toBeNull();
      expect(data.windowClosingPct).not.toBeCloseTo(data.todayClosingPct, 6);

      // The window says which days it covered, so the agency can add it up.
      expect(Array.isArray(data.windowDayKeys)).toBe(true);
      expect(data.windowDayKeys).toContain(YESTERDAY);
      expect(data.windowDeliveryDays).toBeGreaterThan(0);
    });

    it('reports the calls connected right now, separately from the day', async () => {
      /*
       * The only figure on the panel about this instant. A call answered and
       * not yet ended is in progress; one that ended is not, however recently.
       */
      await seedTerms(big.id);
      await seedOpeningAgreement(big.id);

      // Two finished, three still up.
      await seedCall({ tenantId: big.id, answeredAt: middayOf(TODAY) });
      await seedCall({ tenantId: big.id, answeredAt: middayOf(TODAY, 1000) });
      for (let i = 0; i < 3; i++) {
        await seedCall({
          tenantId: big.id,
          answeredAt: middayOf(TODAY, 2000 + i * 1000),
          endedAt: null,
        });
      }

      const data = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/delivery/today',
          headers: tokenFor(big.ownerId, big.id),
        })
      ).json().data;

      expect(data.callsInProgress).toBe(3);
      // And it is not the day's total wearing a different name.
      expect(data.callsAnswered).toBe(5);
    });

    it('gives an unenrolled agency the live count too', async () => {
      // Operational, not billing: a floor is a floor whether or not there is a
      // ledger behind it.
      await seedCall({ tenantId: big.id, answeredAt: middayOf(TODAY), endedAt: null });

      const data = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/delivery/today',
          headers: tokenFor(big.ownerId, big.id),
        })
      ).json().data;

      expect(data.enrolled).toBe(false);
      expect(data.callsInProgress).toBe(1);
    });

    it('derives every money figure on the server, from the ledger and the curve', async () => {
      /*
       * The panel's projected charge is not a client-side multiplication of a
       * rate by a count: it comes back already computed, and it agrees with the
       * arithmetic the settlement itself would do.
       *
       * 100 calls, 16 applications: 15 spend the block, 1 overruns, and the
       * window closes at 16% -- above the flat point, so $134.
       */
      await seedTerms(big.id, { dailyBlockApplications: 15 });
      await seedOpeningAgreement(big.id);
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: TODAY,
        quantity: 15,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });

      await seedDeliveredCalls(big.id, TODAY, 100);
      const { consumeCreditForApplication } = await import('../services/billing/credit-ledger.js');
      for (let i = 0; i < 16; i++) {
        const application = await seedApplication(big.id, middayOf(TODAY, i * 1000));
        await consumeCreditForApplication({
          prisma,
          tenantId: big.id,
          applicationId: application.id,
          deliveryDay: TODAY,
        });
      }

      const data = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/delivery/today',
          headers: tokenFor(big.ownerId, big.id),
        })
      ).json().data;

      expect(data.applicationsConsumedToday).toBe(15);
      expect(data.overrunToday).toBe(1);
      expect(data.applicationsRemainingOnBlock).toBe(0);
      expect(data.currentRate).toBe(134);

      // One overrun at $134, and a full 15 block at $134 = $2,010 + $134.
      expect(data.overrunAmountTonight).toBe(134);
      expect(data.projectedNextBlockQuantity).toBe(15);
      expect(data.projectedTotalCharge).toBe(134 + 15 * 134);

      // The ceiling is 50% of 15 = 7, with 1 used.
      expect(data.overrunCeiling).toBe(7);
      expect(data.distanceToCeiling).toBe(6);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. The per-agent table
  // ══════════════════════════════════════════════════════════════════════════
  describe('the per-agent table', () => {
    it('puts the worst closers first and carries the agency figure to read them against', async () => {
      /*
       * This table is the product's lever: an agency that pulls its two worst
       * closers off the queue raises its blended closing percentage, which
       * lowers its rate. So the agents dragging the rate are at the top, and
       * the agency's own figure comes with the rows rather than being left to
       * the browser to sum.
       *
       * It used to sort descending -- a leaderboard on a work list.
       */
      await seedTerms(big.id);
      await seedOpeningAgreement(big.id);

      const strong = await seedAgent(big.id, 'Wren');
      const weak = await seedAgent(big.id, 'Ash');

      // Wren: 20 calls, 6 applications = 30%. Ash: 20 calls, 1 = 5%.
      await seedDeliveredCalls(big.id, TODAY, 20, strong.id);
      for (let i = 0; i < 6; i++) await seedApplication(big.id, middayOf(TODAY, i * 100), strong.id);

      await seedDeliveredCalls(big.id, TODAY, 20, weak.id);
      await seedApplication(big.id, middayOf(TODAY, 9000), weak.id);

      const data = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/delivery/agents',
          headers: tokenFor(big.ownerId, big.id),
        })
      ).json().data;

      const named = data.agents.filter((row: any) => row.userId !== null);
      expect(named[0].name).toContain('Ash');
      expect(named[0].closingPct).toBeCloseTo(5, 6);
      expect(named[1].name).toContain('Wren');
      expect(named[1].closingPct).toBeCloseTo(30, 6);

      /*
       * The reference line, served with the rows. It is the agency's own Phase
       * 2 measurement -- 40 calls, 7 applications -- and it must NOT be a sum
       * of the rows, because the agency figure counts calls no agent is
       * attributed on.
       */
      expect(data.agencyClosingPct).toBeCloseTo((7 / 40) * 100, 6);
      expect(data.agencyCallsTaken).toBe(40);
      expect(data.agencyApplications).toBe(7);
    });

    it('keeps agents with no calls at the bottom, not at the top of a work list', async () => {
      // A null closing percentage sorted ascending would otherwise lead the
      // table, and an agent who took no calls is not the agency's worst closer.
      await seedTerms(big.id);
      const idle = await seedAgent(big.id, 'Quinn');
      const working = await seedAgent(big.id, 'Rowan');

      await seedDeliveredCalls(big.id, TODAY, 10, working.id);
      await seedApplication(big.id, middayOf(TODAY), working.id);
      // Quinn submitted one application and answered nothing.
      await seedApplication(big.id, middayOf(TODAY, 500), idle.id);

      const data = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/delivery/agents',
          headers: tokenFor(big.ownerId, big.id),
        })
      ).json().data;

      expect(data.agents[0].closingPct).not.toBeNull();
      expect(data.agents[data.agents.length - 1].closingPct).toBeNull();
    });

    it('reports time on the queue, and absent rather than zero when nothing was recorded', async () => {
      /*
       * Presence was Redis-only before Phase 4: one key per agent, overwritten
       * on every change, so nothing accumulated and "how long were they
       * available today" had no answer at all.
       *
       * An agent with no transitions recorded reports null, NOT zero. A day
       * nobody measured and a day somebody spent off the queue are different
       * facts, and this is the column a principal decides who to pull from.
       */
      await seedTerms(big.id);
      const measured = await seedAgent(big.id, 'Sage');
      const unmeasured = await seedAgent(big.id, 'Bex');

      await seedDeliveredCalls(big.id, TODAY, 4, measured.id);
      await seedDeliveredCalls(big.id, TODAY, 4, unmeasured.id);

      // Available for two hours, then away -- in a window of today that has
      // already elapsed. See `pastSpanToday`.
      const span = pastSpanToday(2 * 3600);
      await prisma.agentStateEvent.create({
        data: { userId: measured.id, status: 'available', occurredAt: span.start },
      });
      await prisma.agentStateEvent.create({
        data: { userId: measured.id, status: 'away', occurredAt: span.end },
      });

      const data = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/delivery/agents',
          headers: tokenFor(big.ownerId, big.id),
        })
      ).json().data;

      const sage = data.agents.find((row: any) => row.userId === measured.id);
      const bex = data.agents.find((row: any) => row.userId === unmeasured.id);

      expect(sage.availableSeconds).toBe(span.seconds);
      expect(bex.availableSeconds).toBeNull();
    });

    it('counts an availability that carried in from before the day started', async () => {
      /*
       * An agent who went available yesterday evening and never signed out is
       * available at midnight. The state in force at the start of a day is set
       * by the last row BEFORE it, so the read has to look back past the day's
       * own rows or that agent reports nothing.
       */
      await seedTerms(big.id);
      const agent = await seedAgent(big.id, 'Frey');
      await seedDeliveredCalls(big.id, TODAY, 3, agent.id);

      // Went available mid-yesterday; the only other row is an hour into today.
      await prisma.agentStateEvent.create({
        data: { userId: agent.id, status: 'available', occurredAt: middayOf(YESTERDAY) },
      });
      const oneHourIn = new Date(calendarDayBounds(TODAY).start.getTime() + 3600_000);
      await prisma.agentStateEvent.create({
        data: { userId: agent.id, status: 'away', occurredAt: oneHourIn },
      });

      const data = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/delivery/agents',
          headers: tokenFor(big.ownerId, big.id),
        })
      ).json().data;

      const row = data.agents.find((r: any) => r.userId === agent.id);
      // The first hour of today, and not a second of yesterday.
      expect(row.availableSeconds).toBe(3600);
    });

    it('never runs an open availability past this instant', async () => {
      // An agent available since an hour ago with no closing row has been
      // available for an hour, not until midnight. See `openSpanToday` for why
      // the start is clipped into the day rather than a flat `now - 1h`.
      await seedTerms(big.id);
      const agent = await seedAgent(big.id, 'Nico');
      await seedDeliveredCalls(big.id, TODAY, 2, agent.id);

      const span = openSpanToday(3600);
      await prisma.agentStateEvent.create({
        data: { userId: agent.id, status: 'available', occurredAt: span.start },
      });

      const data = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/delivery/agents',
          headers: tokenFor(big.ownerId, big.id),
        })
      ).json().data;

      const row = data.agents.find((r: any) => r.userId === agent.id);

      /*
       * The span is open, so it runs to the route's own `now` -- a moment after
       * this fixture was built. The measured figure is therefore at or just
       * above `span.seconds`, never below it by more than rounding.
       *
       * The upper bound is what the test is actually for. Midnight-to-midnight
       * would be up to 86,400 seconds and the elapsed part of the day is at
       * least `span.seconds`, so anything within a hundred seconds of the
       * fixture is the read stopping at this instant rather than running on.
       */
      expect(row.availableSeconds).toBeGreaterThanOrEqual(span.seconds - 5);
      expect(row.availableSeconds).toBeLessThan(span.seconds + 100);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. An agent's own view
  // ══════════════════════════════════════════════════════════════════════════
  describe("an agent's own view", () => {
    it('shows an agent their own row, no other agent, and no money at all', async () => {
      await seedTerms(big.id);
      await seedOpeningAgreement(big.id);

      const mine = await seedAgent(big.id, 'Ellis');
      const theirs = await seedAgent(big.id, 'Marlow');

      await seedDeliveredCalls(big.id, TODAY, 10, mine.id);
      await seedApplication(big.id, middayOf(TODAY), mine.id);

      await seedDeliveredCalls(big.id, TODAY, 30, theirs.id);
      for (let i = 0; i < 9; i++) await seedApplication(big.id, middayOf(TODAY, 5000 + i * 100), theirs.id);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/delivery/me',
        headers: tokenFor(mine.id, big.id),
      });

      expect(response.statusCode).toBe(200);
      const data = response.json().data;

      // Their own numbers.
      expect(data.callsTaken).toBe(10);
      expect(data.applications).toBe(1);
      expect(data.closingPct).toBeCloseTo(10, 6);

      // The agency's total, which is a fair thing to be measured against.
      expect(data.agencyCallsTaken).toBe(40);

      // But not the other agent, by id, name or figures.
      const serialised = JSON.stringify(data);
      expect(serialised).not.toContain(theirs.id);
      expect(serialised).not.toContain('Marlow');

      // And no money, anywhere. Not rendered-and-hidden: absent.
      for (const forbidden of ['rate', 'Rate', 'balance', 'overrun', 'charge', 'amount']) {
        expect(serialised).not.toContain(forbidden);
      }
    });

    it('gives an agent their own time on the queue', async () => {
      await seedTerms(big.id);
      const agent = await seedAgent(big.id, 'Tam');
      await seedDeliveredCalls(big.id, TODAY, 3, agent.id);

      const span = pastSpanToday(1800);
      await prisma.agentStateEvent.create({
        data: { userId: agent.id, status: 'available', occurredAt: span.start },
      });
      await prisma.agentStateEvent.create({
        data: { userId: agent.id, status: 'offline', occurredAt: span.end },
      });

      const data = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/delivery/me',
          headers: tokenFor(agent.id, big.id),
        })
      ).json().data;

      expect(data.availableSeconds).toBe(span.seconds);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Settlement history and the derivation
  // ══════════════════════════════════════════════════════════════════════════
  describe('the settlement derivation', () => {
    /** A settled yesterday, priced off a window that includes it. */
    async function settleYesterday() {
      await seedTerms(big.id, { dailyBlockApplications: 45 });
      await seedOpeningAgreement(big.id);
      await recordPurchase(prisma, {
        tenantId: big.id,
        deliveryDay: YESTERDAY,
        quantity: 45,
        unitRate: 134,
        stripePaymentIntentId: 'pi_block',
      });
      await seedDeliveredCalls(big.id, YESTERDAY, 440);
      for (let i = 0; i < 67; i++) await seedApplication(big.id, middayOf(YESTERDAY, i * 100));

      return settleAgencyForDeliveryDay({
        tenantId: big.id,
        deliveryDay: YESTERDAY,
        prisma,
      });
    }

    it('expands to values that recompute to the rate stored on the settlement', async () => {
      /*
       * THE property. A panel that reprints the stored rate proves nothing to
       * an agency disputing a charge. This one re-measures the Delivery Days
       * the window named, sums them, prices the result against the curve
       * version the settlement itself names, and lands on the stored rate.
       */
      const settled = await settleYesterday();

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/delivery/settlements/${settled.settlementId}/derivation`,
        headers: tokenFor(big.ownerId, big.id),
      });

      expect(response.statusCode).toBe(200);
      const data = response.json().data;

      const stored = await prisma.dailySettlement.findUniqueOrThrow({
        where: { id: settled.settlementId! },
      });

      // The per-day rows are the window the settlement named, and they add up.
      expect(data.window.map((row: any) => row.deliveryDay)).toEqual(stored.windowDayKeys);
      expect(data.recomputed.deliveredCalls).toBe(
        data.window.reduce((total: number, row: any) => total + row.deliveredCalls, 0)
      );
      expect(data.recomputed.submittedApplications).toBe(
        data.window.reduce((total: number, row: any) => total + row.submittedApplications, 0)
      );

      // 440 calls to 67 applications is 15.23%, above the flat point: $134.
      expect(data.recomputed.closingPct).toBeCloseTo((67 / 440) * 100, 4);
      expect(data.recomputed.rate).toBe(Number(stored.rate));
      expect(data.matchesStoredRate).toBe(true);

      // And it names the curve points the answer came from.
      expect(data.stored.curveVersion).toBe(1);
      expect(data.recomputed.anchors).not.toBeNull();
      expect(data.recomputed.flatFromClosingPct).toBe(15);
      expect(data.recomputed.minimumClosingPct).toBe(5);
    });

    it('prices against the curve the settlement names, not whichever is active now', async () => {
      /*
       * A new curve published tomorrow must not change what a six-week-old
       * settlement appears to have been priced at. Pricing history against
       * today's curve produces a confident, wrong number on the one screen
       * whose whole purpose is to be trusted.
       */
      const settled = await settleYesterday();

      // A second, much cheaper curve, made active.
      await prisma.rateCurveVersion.create({
        data: {
          id: '00000000-0000-4000-8000-00000000d002',
          version: 2,
          label: 'Cheaper curve',
          minimumClosingPct: 5,
          flatFromClosingPct: 15,
          anchors: { create: [{ closingPct: 5, rate: 10 }, { closingPct: 15, rate: 20 }] },
        },
      });
      await prisma.ratingSettings.update({
        where: { id: 'global' },
        data: { activeCurveVersionId: '00000000-0000-4000-8000-00000000d002' },
      });

      const data = (
        await app.inject({
          method: 'GET',
          url: `/api/v1/delivery/settlements/${settled.settlementId}/derivation`,
          headers: tokenFor(big.ownerId, big.id),
        })
      ).json().data;

      // Still v1's answer, still matching.
      expect(data.stored.curveVersion).toBe(1);
      expect(data.recomputed.rate).toBe(134);
      expect(data.matchesStoredRate).toBe(true);
    });

    it('refuses one agency the derivation of another agency settlement', async () => {
      const settled = await settleYesterday();

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/delivery/settlements/${settled.settlementId}/derivation`,
        headers: tokenFor(small.ownerId, small.id),
      });

      // Not "forbidden" -- as far as this agency is concerned it does not
      // exist, which is the answer that leaks nothing about whether it does.
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain(big.id);
    });

    it('exports the agency history over a date range, and refuses a malformed one', async () => {
      await seedTerms(big.id);
      for (const day of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']) {
        await prisma.dailySettlement.create({
          data: {
            tenantId: big.id,
            deliveryDay: day,
            deliveredCalls: 400,
            submittedApplications: 60,
            windowDeliveryDays: 3,
            windowDaysFound: 3,
            windowDayKeys: [day],
            totalCharged: 8040,
            maxDailyDebit: 8978,
            paymentStatus: 'SUCCEEDED',
          },
        });
      }

      const inRange = await app.inject({
        method: 'GET',
        url: '/api/v1/delivery/settlements.csv?from=2026-09-02&to=2026-09-03',
        headers: tokenFor(big.ownerId, big.id),
      });

      expect(inRange.statusCode).toBe(200);
      const lines = inRange.body.trim().split('\n');
      expect(lines).toHaveLength(3); // header plus two days
      expect(inRange.body).toContain('2026-09-02');
      expect(inRange.body).toContain('2026-09-03');
      expect(inRange.body).not.toContain('2026-09-04');

      // A bad date is refused rather than quietly ignored: an export that
      // widened its own range is one somebody reconciles from.
      const bad = await app.inject({
        method: 'GET',
        url: '/api/v1/delivery/settlements.csv?from=01-09-2026',
        headers: tokenFor(big.ownerId, big.id),
      });
      expect(bad.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. The cross-agency view
  // ══════════════════════════════════════════════════════════════════════════
  describe('the cross-agency view', () => {
    it('refuses an agency principal', async () => {
      await seedTerms(big.id);
      await seedTerms(small.id);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/platform/delivery/overview',
        headers: tokenFor(big.ownerId, big.id),
      });

      expect(response.statusCode).toBe(403);
      // And it does not leak the other agency on the way out.
      expect(response.body).not.toContain(small.id);
    });

    it('serves a platform admin who has entered no agency, without a 401', async () => {
      /*
       * The login loop, pinned on the server side. A platform operator with no
       * acting tenant used to get 401 from agency-scoped routes; the web client
       * reads 401 as a dead session, cleared the token and redirected to
       * /login, which loaded the app, which called an agency-scoped route.
       *
       * This route is not agency-scoped and must answer them normally. A 401
       * here is the loop.
       */
      await seedTerms(big.id);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/platform/delivery/overview',
        headers: tokenFor(operatorId, null),
      });

      expect(response.statusCode).toBe(200);
      expect(response.statusCode).not.toBe(401);
      expect(response.json().data.agencies.length).toBeGreaterThan(0);
    });

    it('flags an enrolled agency that has never been settled', async () => {
      /*
       * An agency enrolled days ago with nothing in `daily_settlements` is a
       * nightly run that is not reaching it. It is invisible in every other
       * column on this screen: they all read a settlement that does not exist
       * and render an em dash that looks like a quiet day.
       */
      await seedTerms(big.id);
      await seedTerms(small.id);
      await prisma.dailySettlement.create({
        data: {
          tenantId: small.id,
          deliveryDay: YESTERDAY,
          deliveredCalls: 100,
          submittedApplications: 15,
          windowDeliveryDays: 3,
          windowDaysFound: 3,
          windowDayKeys: [YESTERDAY],
          totalCharged: 2010,
          maxDailyDebit: 8978,
          paymentStatus: 'SUCCEEDED',
        },
      });

      const agencies = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/platform/delivery/overview',
          headers: tokenFor(operatorId, null),
        })
      ).json().data.agencies;

      const never = agencies.find((row: any) => row.tenantId === big.id);
      const settled = agencies.find((row: any) => row.tenantId === small.id);

      expect(never.flags.enrolledNeverSettled).toBe(true);
      expect(settled.flags.enrolledNeverSettled).toBe(false);
    });

    it('raises no flags at all for an agency that is not enrolled', async () => {
      // An unenrolled agency has no mandate and no rate by definition. Flagging
      // it would put red badges on every tenant not yet onboarded and bury the
      // one that needs attention.
      await seedTerms(big.id, { enrolled: false });

      const row = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/platform/delivery/overview',
          headers: tokenFor(operatorId, null),
        })
      )
        .json()
        .data.agencies.find((r: any) => r.tenantId === big.id);

      expect(row.enrolled).toBe(false);
      expect(Object.values(row.flags).some(Boolean)).toBe(false);
      expect(row.settlement.status).toBe('NOT_ENROLLED');
    });

    it('calls a halted settlement halted rather than failed', async () => {
      /*
       * A halt is not a decline. The run worked and deliberately placed no
       * debit because the total breached the maximum daily debit. Calling it
       * FAILED sends an operator to retry a payment instead of to explain the
       * day.
       */
      await seedTerms(big.id);
      await prisma.dailySettlement.create({
        data: {
          tenantId: big.id,
          deliveryDay: YESTERDAY,
          deliveredCalls: 900,
          submittedApplications: 140,
          windowDeliveryDays: 3,
          windowDaysFound: 3,
          windowDayKeys: [YESTERDAY],
          totalCharged: 20000,
          maxDailyDebit: 8978,
          paymentStatus: 'HALTED_MAX_DEBIT',
        },
      });

      const row = (
        await app.inject({
          method: 'GET',
          url: `/api/v1/platform/delivery/overview?day=${YESTERDAY}`,
          headers: tokenFor(operatorId, null),
        })
      )
        .json()
        .data.agencies.find((r: any) => r.tenantId === big.id);

      expect(row.settlement.status).toBe('HALTED');
      expect(row.settlement.status).not.toBe('FAILED');
    });

    it('reports revenue per call rising as the rate falls', async () => {
      /*
       * The economics of the curve, stated directly rather than left to be
       * inferred. A higher closing percentage prices lower per application and
       * still earns more per call, which is why an agency raising its closing
       * percentage is good for both sides.
       *
       * Both agencies take 100 calls. Ridgeline closes 20 at $134; Fairhaven
       * closes 5 at $264.
       */
      await seedTerms(big.id);
      await seedTerms(small.id);

      for (const [tenant, applications, total] of [
        [big, 20, 20 * 134],
        [small, 5, 5 * 264],
      ] as const) {
        await seedDeliveredCalls(tenant.id, YESTERDAY, 100);
        await prisma.dailySettlement.create({
          data: {
            tenantId: tenant.id,
            deliveryDay: YESTERDAY,
            deliveredCalls: 100,
            submittedApplications: applications,
            windowDeliveryDays: 3,
            windowDaysFound: 3,
            windowDayKeys: [YESTERDAY],
            totalCharged: total,
            maxDailyDebit: 100000,
            paymentStatus: 'SUCCEEDED',
          },
        });
      }

      const agencies = (
        await app.inject({
          method: 'GET',
          url: `/api/v1/platform/delivery/overview?day=${YESTERDAY}`,
          headers: tokenFor(operatorId, null),
        })
      ).json().data.agencies;

      const high = agencies.find((r: any) => r.tenantId === big.id);
      const low = agencies.find((r: any) => r.tenantId === small.id);

      expect(high.revenuePerCall).toBeCloseTo(26.8, 4);
      expect(low.revenuePerCall).toBeCloseTo(13.2, 4);
      // The better closer pays less per application and earns more per call.
      expect(high.revenuePerCall).toBeGreaterThan(low.revenuePerCall);
    });
  });
});
