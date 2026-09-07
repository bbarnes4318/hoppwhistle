/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { hash } from 'bcryptjs';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { calendarDayBounds } from '../services/rating/calendar-day.js';
import { measureTrailingDeliveryDays } from '../services/rating/delivery-day.js';
import { measureCalendarDay } from '../services/rating/measurement.js';
import { rateFor } from '../services/rating/rate-curve.js';
import {
  loadActiveCurve,
  rateAgencyForClosedDay,
  recomputeFromRecord,
  runDailyRating,
} from '../services/rating/rating-engine.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Measurement and the daily rate engine.
 *
 * ── What this suite is for ──────────────────────────────────────────────────
 *
 * These are the inputs to money. Phase 3 charges from them, so the arithmetic
 * is asserted against a real database rather than a mock: the definitions live
 * partly in Prisma `where` clauses and partly in a timezone, and a fake for
 * either would let both drift without a test noticing.
 *
 * Four properties, in order of what they would cost if wrong:
 *
 *   1. The two counts are what the definitions say. An application counted
 *      twice, or a ringing call counted as delivered, is a wrong price.
 *   2. Days are reckoned in America/New_York. Two applications four seconds
 *      apart across midnight belong to different days and different windows.
 *   3. Agencies do not mix. Two agencies running side by side produce two
 *      independent closing percentages, rates and records.
 *   4. A rating decision recomputes to the same rate from its own stored
 *      values, and a later curve version does not change it. That is the
 *      dispute answer.
 */

const gate = databaseGate();
announceSkip('Rating: measurement and the daily rate engine', gate);

const TEST_JWT_SECRET = 'rating-engine-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Rating suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `rating suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Rating: measurement and the daily rate engine', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  /** The larger launch agency: ~450 delivered calls a day, 45 agents. */
  let big: { id: string; ownerId: string };
  /** The smaller one: ~150 a day, 15 agents. */
  let small: { id: string; ownerId: string };
  /** A NetEnroll operator, no tenant of their own. */
  let operatorId: string;

  /** The day the fixtures are built on, and the day the engine rates. */
  const CLOSED_DAY = '2026-09-07';
  const EFFECTIVE_DAY = '2026-09-08';

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);

    const { registerRatingRoutes } = await import('../routes/rating.js');
    const { registerPlatformRoutes } = await import('../routes/platform.js');
    await instance.register(registerRatingRoutes);
    await instance.register(registerPlatformRoutes);

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
      'rating_review_flags',
      'rate_changes',
      'agency_rating_states',
      // The curve too: these tests publish new versions, and a version number
      // carried over from the previous test would make "v2" mean whatever the
      // run order happened to produce.
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

  /**
   * The curve and settings rows the migration seeds. Recreated here because
   * `TRUNCATE tenants CASCADE` does not touch them but a previous suite's
   * cleanup might, and because the assertions below quote the launch numbers.
   */
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
      update: {
        windowDeliveryDays: 3,
        activeCurveVersionId: '00000000-0000-4000-8000-00000000c001',
      },
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

  /** Noon Eastern on a business day, plus an offset in milliseconds. */
  function middayOf(day: string, offsetMs = 0): Date {
    return new Date(calendarDayBounds(day).start.getTime() + 12 * 3600_000 + offsetMs);
  }

  let callSeq = 0;

  /**
   * One call. `answeredAt: null` is a call that rang and was never picked up.
   */
  async function seedCall(params: {
    tenantId: string;
    answeredAt: Date | null;
    direction?: 'INBOUND' | 'OUTBOUND';
    durationSeconds?: number;
    blocked?: boolean;
  }) {
    callSeq += 1;
    return prisma.call.create({
      data: {
        tenantId: params.tenantId,
        callSid: `sid-${callSeq}-${Math.random().toString(36).slice(2, 8)}`,
        toNumber: '+15550000000',
        status: params.answeredAt ? 'COMPLETED' : 'NO_ANSWER',
        direction: params.direction ?? 'INBOUND',
        answeredAt: params.answeredAt,
        duration: params.durationSeconds ?? (params.answeredAt ? 60 : 0),
        blocked: params.blocked ?? false,
      },
    });
  }

  async function seedDeliveredCalls(tenantId: string, day: string, count: number) {
    for (let i = 0; i < count; i++) {
      // Spread across the day so nothing depends on all of them sharing an
      // instant.
      await seedCall({ tenantId, answeredAt: middayOf(day, i * 1000) });
    }
  }

  let appSeq = 0;

  async function seedApplication(params: {
    tenantId: string;
    submittedAt: Date | null;
    status?: string;
  }) {
    appSeq += 1;
    return prisma.insuranceCarrierApplication.create({
      data: {
        tenantId: params.tenantId,
        firstName: 'Test',
        lastName: `Applicant ${appSeq}`,
        status: params.status ?? (params.submittedAt ? 'SUBMITTED' : 'PENDING'),
        submittedAt: params.submittedAt,
      },
    });
  }

  async function seedSubmittedApplications(tenantId: string, day: string, count: number) {
    for (let i = 0; i < count; i++) {
      await seedApplication({ tenantId, submittedAt: middayOf(day, i * 1000) });
    }
  }

  const deps = () => ({
    calls: prisma.call,
    applications: prisma.insuranceCarrierApplication,
  });

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

    const ownerRole = await prisma.role.create({
      data: { name: 'OWNER', description: 'OWNER role', permissions: ['admin:*'] },
    });

    big = await seedAgency('Ridgeline', ownerRole.id);
    small = await seedAgency('Fairhaven', ownerRole.id);

    const operator = await prisma.user.create({
      data: { email: 'operator@netenroll.test', status: 'ACTIVE', tenantId: null },
    });
    operatorId = operator.id;
    await grantPlatformAdmin(operatorId, { note: 'rating suite fixture' });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. Delivered calls
  // ══════════════════════════════════════════════════════════════════════════
  describe('delivered calls', () => {
    it('counts a call answered and immediately dropped', async () => {
      // The brief's case. There is no minimum duration: the agency was given
      // the opportunity, and a duration threshold is a lever on the price that
      // nobody agreed to.
      await seedCall({
        tenantId: big.id,
        answeredAt: middayOf(CLOSED_DAY),
        durationSeconds: 0,
      });

      const measured = await measureCalendarDay(deps(), big.id, CLOSED_DAY);
      expect(measured.deliveredCalls).toBe(1);
    });

    it('does not count a call that rang unanswered', async () => {
      await seedCall({ tenantId: big.id, answeredAt: null });

      const measured = await measureCalendarDay(deps(), big.id, CLOSED_DAY);
      expect(measured.deliveredCalls).toBe(0);
    });

    it('does not count the agency’s own outbound dialling', async () => {
      // Counting it would inflate the denominator, depress the measured
      // closing percentage and RAISE the agency's price.
      await seedCall({
        tenantId: big.id,
        answeredAt: middayOf(CLOSED_DAY),
        direction: 'OUTBOUND',
      });

      const measured = await measureCalendarDay(deps(), big.id, CLOSED_DAY);
      expect(measured.deliveredCalls).toBe(0);
    });

    it('does not count a blocked call', async () => {
      await seedCall({
        tenantId: big.id,
        answeredAt: middayOf(CLOSED_DAY),
        blocked: true,
      });

      const measured = await measureCalendarDay(deps(), big.id, CLOSED_DAY);
      expect(measured.deliveredCalls).toBe(0);
    });

    it('attributes delivery by when the agent answered, not when the call arrived', async () => {
      // Rings at 23:59:58 on the 7th, answered at 00:00:02 on the 8th.
      const { endExclusive } = calendarDayBounds(CLOSED_DAY);
      await prisma.call.create({
        data: {
          tenantId: big.id,
          callSid: `sid-straddle-${Date.now()}`,
          toNumber: '+15550000000',
          status: 'COMPLETED',
          direction: 'INBOUND',
          createdAt: new Date(endExclusive.getTime() - 2000),
          answeredAt: new Date(endExclusive.getTime() + 2000),
        },
      });

      expect((await measureCalendarDay(deps(), big.id, CLOSED_DAY)).deliveredCalls).toBe(0);
      expect((await measureCalendarDay(deps(), big.id, EFFECTIVE_DAY)).deliveredCalls).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Submitted applications
  // ══════════════════════════════════════════════════════════════════════════
  describe('submitted applications', () => {
    it('counts an application that reaches submitted state twice exactly once', async () => {
      const { markAutomationCompleted } = await import(
        '../services/carrier-rpa/application-store.js'
      );

      const application = await seedApplication({
        tenantId: big.id,
        submittedAt: null,
        status: 'SUBMITTING',
      });

      await markAutomationCompleted(application.id, 'CARRIER-1');
      const first = await prisma.insuranceCarrierApplication.findUnique({
        where: { id: application.id },
      });

      // A retried automation run, or a redelivered completion.
      await markAutomationCompleted(application.id, 'CARRIER-1');
      const second = await prisma.insuranceCarrierApplication.findUnique({
        where: { id: application.id },
      });

      // One row, and the FIRST submission timestamp survives: a retry must not
      // be able to move an application across a business-day boundary.
      expect(second!.submittedAt?.toISOString()).toBe(first!.submittedAt?.toISOString());

      const day = (await import('../services/rating/calendar-day.js')).calendarDayOf(
        first!.submittedAt as Date
      );
      const measured = await measureCalendarDay(deps(), big.id, day);
      expect(measured.submittedApplications).toBe(1);
    });

    it('does not count an application that has not been submitted', async () => {
      await seedApplication({ tenantId: big.id, submittedAt: null });

      const measured = await measureCalendarDay(deps(), big.id, CLOSED_DAY);
      expect(measured.submittedApplications).toBe(0);
    });

    it('ignores what the carrier decided afterwards', async () => {
      // Issued, declined, rescinded, lapsed: none of it is an input to the
      // closing percentage, and none of it returns a credit.
      for (const status of ['ISSUED', 'DECLINED', 'RESCINDED', 'LAPSED']) {
        await seedApplication({
          tenantId: big.id,
          submittedAt: middayOf(CLOSED_DAY),
          status,
        });
      }

      const measured = await measureCalendarDay(deps(), big.id, CLOSED_DAY);
      expect(measured.submittedApplications).toBe(4);
    });

    it('lands 23:59:58 and 00:00:02 on different business days', async () => {
      const { endExclusive } = calendarDayBounds(CLOSED_DAY);

      await seedApplication({
        tenantId: big.id,
        submittedAt: new Date(endExclusive.getTime() - 2000),
      });
      await seedApplication({
        tenantId: big.id,
        submittedAt: new Date(endExclusive.getTime() + 2000),
      });

      expect((await measureCalendarDay(deps(), big.id, CLOSED_DAY)).submittedApplications).toBe(1);
      expect(
        (await measureCalendarDay(deps(), big.id, EFFECTIVE_DAY)).submittedApplications
      ).toBe(1);
    });

    it('attributes by submission, not by the call that produced it', async () => {
      // The brief's case: a 4pm call, submitted at 9am the next day, belongs to
      // the next day.
      const call = await seedCall({
        tenantId: big.id,
        answeredAt: new Date(calendarDayBounds(CLOSED_DAY).start.getTime() + 16 * 3600_000),
      });

      await prisma.insuranceCarrierApplication.create({
        data: {
          tenantId: big.id,
          firstName: 'Next',
          lastName: 'Morning',
          status: 'SUBMITTED',
          callId: call.id,
          createdAt: new Date(calendarDayBounds(CLOSED_DAY).start.getTime() + 16 * 3600_000),
          submittedAt: new Date(calendarDayBounds(EFFECTIVE_DAY).start.getTime() + 9 * 3600_000),
        },
      });

      expect((await measureCalendarDay(deps(), big.id, CLOSED_DAY)).submittedApplications).toBe(0);
      expect(
        (await measureCalendarDay(deps(), big.id, EFFECTIVE_DAY)).submittedApplications
      ).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Two agencies never mix
  // ══════════════════════════════════════════════════════════════════════════
  describe('two agencies running simultaneously', () => {
    it('produce independent closing percentages', async () => {
      // Ridgeline: 100 calls, 12 applications -> 12%.
      await seedDeliveredCalls(big.id, CLOSED_DAY, 100);
      await seedSubmittedApplications(big.id, CLOSED_DAY, 12);

      // Fairhaven: 50 calls, 3 applications -> 6%.
      await seedDeliveredCalls(small.id, CLOSED_DAY, 50);
      await seedSubmittedApplications(small.id, CLOSED_DAY, 3);

      const bigMeasured = await measureCalendarDay(deps(), big.id, CLOSED_DAY);
      const smallMeasured = await measureCalendarDay(deps(), small.id, CLOSED_DAY);

      expect(bigMeasured).toMatchObject({
        deliveredCalls: 100,
        submittedApplications: 12,
        closingPct: 12,
      });
      expect(smallMeasured).toMatchObject({
        deliveredCalls: 50,
        submittedApplications: 3,
        closingPct: 6,
      });
    });

    it('rate independently on the same day, at different volumes', async () => {
      // The two launch agencies, at their stated volumes over a 3-day window.
      await seedDeliveredCalls(big.id, CLOSED_DAY, 450);
      await seedSubmittedApplications(big.id, CLOSED_DAY, 45); // 10%
      await seedDeliveredCalls(small.id, CLOSED_DAY, 150);
      await seedSubmittedApplications(small.id, CLOSED_DAY, 9); // 6%

      const run = await runDailyRating({ closedCalendarDay: CLOSED_DAY, prisma });
      expect(run.failures).toEqual([]);

      const byTenant = new Map(run.results.map(r => [r.tenantId, r]));

      expect(byTenant.get(big.id)).toMatchObject({
        deliveredCalls: 450,
        submittedApplications: 45,
        closingPct: 10,
        newRate: 159,
        status: 'APPLIED',
      });
      expect(byTenant.get(small.id)).toMatchObject({
        deliveredCalls: 150,
        submittedApplications: 9,
        closingPct: 6,
        newRate: 234,
        status: 'APPLIED',
      });

      // Two rows, one each, and neither names the other's numbers.
      const changes = await prisma.rateChange.findMany({
        where: { effectiveCalendarDay: EFFECTIVE_DAY },
      });
      expect(changes).toHaveLength(2);
    });

    it('never lets one agency read another’s rating history', async () => {
      await seedDeliveredCalls(big.id, CLOSED_DAY, 100);
      await seedSubmittedApplications(big.id, CLOSED_DAY, 10);
      await runDailyRating({ closedCalendarDay: CLOSED_DAY, prisma });

      const bigChange = await prisma.rateChange.findFirst({ where: { tenantId: big.id } });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/rating/history/${bigChange!.id}/recompute`,
        headers: tokenFor(small.ownerId, small.id),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. The rating engine
  // ══════════════════════════════════════════════════════════════════════════
  describe('the daily rating engine', () => {
    it('rates from the trailing window, not from the closed day alone', async () => {
      // 100 calls a day for three days, 10 applications on the last day only:
      // 10/300 = 3.33% over the window, which is below the minimum, whereas the
      // last day alone would read 10%.
      for (const day of ['2026-09-05', '2026-09-06', '2026-09-07']) {
        await seedDeliveredCalls(big.id, day, 100);
      }
      await seedSubmittedApplications(big.id, CLOSED_DAY, 10);

      const measured = await measureTrailingDeliveryDays(deps(), big.id, CLOSED_DAY, 3);
      expect(measured).not.toBeNull();
      expect(measured!.deliveredCalls).toBe(300);
      expect(measured!.window.dayKeys).toEqual(['2026-09-05', '2026-09-06', '2026-09-07']);
      expect(measured!.closingPct).toBeCloseTo(3.3333, 3);
    });

    it('applies the rate to the day AFTER the window closed', async () => {
      await seedDeliveredCalls(big.id, CLOSED_DAY, 100);
      await seedSubmittedApplications(big.id, CLOSED_DAY, 10);

      const result = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: CLOSED_DAY,
        prisma,
      });

      expect(result.effectiveCalendarDay).toBe(EFFECTIVE_DAY);
      expect(result.newRate).toBe(159);
    });

    it('writes a record that recomputes to the same rate from its own values', async () => {
      // The dispute answer. `recomputeFromRecord` reads the row and the curve
      // version it names, and nothing else.
      await seedDeliveredCalls(big.id, CLOSED_DAY, 200);
      await seedSubmittedApplications(big.id, CLOSED_DAY, 19); // 9.5% -> $164

      const result = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: CLOSED_DAY,
        prisma,
      });
      expect(result.newRate).toBe(164);

      const recomputed = await recomputeFromRecord(result.rateChangeId, prisma);
      expect(recomputed.closingPct).toBeCloseTo(9.5, 6);
      expect(recomputed.rate).toBe(164);
      expect(recomputed.matchesStoredRate).toBe(true);
    });

    it('records every value needed to recompute the rate from the row alone', async () => {
      // Three Delivery Days, so the row carries a full window.
      for (const day of ['2026-09-05', '2026-09-06', CLOSED_DAY]) {
        await seedDeliveredCalls(big.id, day, 100);
        await seedSubmittedApplications(big.id, day, 8);
      }

      const result = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: CLOSED_DAY,
        prisma,
      });

      const row = await prisma.rateChange.findUnique({ where: { id: result.rateChangeId } });

      expect(row).toMatchObject({
        tenantId: big.id,
        effectiveCalendarDay: EFFECTIVE_DAY,
        windowDeliveryDays: 3,
        deliveredCalls: 300,
        submittedApplications: 24,
        curveVersion: 1,
      });
      expect(row!.windowDayKeys).toEqual(['2026-09-05', '2026-09-06', '2026-09-07']);
      expect(row!.windowDaysFound).toBe(3);
      expect(Number(row!.closingPct)).toBeCloseTo(8, 6);
      expect(Number(row!.newRate)).toBe(184);
    });

    it('records a one-day window as one day when that is all there was', async () => {
      // The complement of the case above, and the reason `windowDaysFound`
      // exists: an agency delivered on exactly one day is priced on one day of
      // evidence, and the row says one rather than implying three.
      await seedDeliveredCalls(big.id, CLOSED_DAY, 100);
      await seedSubmittedApplications(big.id, CLOSED_DAY, 8);

      const result = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: CLOSED_DAY,
        prisma,
      });

      expect(result.windowDayKeys).toEqual([CLOSED_DAY]);
      expect(result.windowDaysFound).toBe(1);
      expect(result.newRate).toBe(184);
    });

    it('flags an agency below 5% and gives it no rate', async () => {
      // 4.9%: below the curve's minimum.
      await seedDeliveredCalls(big.id, CLOSED_DAY, 1000);
      await seedSubmittedApplications(big.id, CLOSED_DAY, 49);

      const result = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: CLOSED_DAY,
        prisma,
      });

      expect(result.status).toBe('BELOW_MINIMUM');
      // Not zero. There is no rate at all below the floor.
      expect(result.newRate).toBeNull();

      const state = await prisma.agencyRatingState.findUnique({ where: { tenantId: big.id } });
      expect(state?.status).toBe('UNDER_REVIEW');
      expect(state?.currentRate).toBeNull();

      const flag = await prisma.ratingReviewFlag.findFirst({
        where: { tenantId: big.id, clearedAt: null },
      });
      expect(flag).not.toBeNull();
      expect(Number(flag!.closingPct)).toBeCloseTo(4.9, 6);
    });

    it('does not flag an agency at exactly 5%', async () => {
      await seedDeliveredCalls(big.id, CLOSED_DAY, 1000);
      await seedSubmittedApplications(big.id, CLOSED_DAY, 50);

      const result = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: CLOSED_DAY,
        prisma,
      });

      expect(result.status).toBe('APPLIED');
      expect(result.newRate).toBe(264);
    });

    it('raises one flag for a run of days below the minimum, not one a day', async () => {
      await seedDeliveredCalls(big.id, '2026-09-05', 100);
      await seedDeliveredCalls(big.id, '2026-09-06', 100);
      await seedDeliveredCalls(big.id, CLOSED_DAY, 100);
      await seedSubmittedApplications(big.id, CLOSED_DAY, 6); // 2% over the window

      await rateAgencyForClosedDay({ tenantId: big.id, closedCalendarDay: '2026-09-06', prisma });
      await rateAgencyForClosedDay({ tenantId: big.id, closedCalendarDay: CLOSED_DAY, prisma });

      const flags = await prisma.ratingReviewFlag.findMany({ where: { tenantId: big.id } });
      expect(flags).toHaveLength(1);
    });

    it('keeps the previous rate, and says so, when the window had no calls', async () => {
      // Day one: a real rate.
      await seedDeliveredCalls(big.id, '2026-09-01', 100);
      await seedSubmittedApplications(big.id, '2026-09-01', 10);
      await rateAgencyForClosedDay({ tenantId: big.id, closedCalendarDay: '2026-09-01', prisma });

      // A later window with nothing in it at all: the lookback is 60 days, so
      // this reaches back past the September 1st delivery and finds nothing.
      const quiet = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: '2026-12-20',
        prisma,
      });

      expect(quiet.status).toBe('NO_DATA');
      // Not a rate of zero, and not a review flag: an agency that was closed is
      // not an agency performing below the floor.
      expect(quiet.closingPct).toBeNull();
      expect(quiet.newRate).toBe(159);

      const flags = await prisma.ratingReviewFlag.findMany({ where: { tenantId: big.id } });
      expect(flags).toHaveLength(0);
    });

    it('is idempotent: a second run for the same day writes nothing', async () => {
      await seedDeliveredCalls(big.id, CLOSED_DAY, 100);
      await seedSubmittedApplications(big.id, CLOSED_DAY, 10);

      const first = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: CLOSED_DAY,
        prisma,
      });
      const second = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: CLOSED_DAY,
        prisma,
      });

      expect(second.alreadyRated).toBe(true);
      expect(second.rateChangeId).toBe(first.rateChangeId);

      const rows = await prisma.rateChange.findMany({ where: { tenantId: big.id } });
      expect(rows).toHaveLength(1);
    });

    it('honours a configured window length other than three', async () => {
      await prisma.ratingSettings.update({
        where: { id: 'global' },
        data: { windowDeliveryDays: 5 },
      });

      // Five Delivery Days need five days that actually had a delivery.
      for (const day of ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', CLOSED_DAY]) {
        await seedDeliveredCalls(big.id, day, 20);
      }
      await seedSubmittedApplications(big.id, CLOSED_DAY, 10);

      const result = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: CLOSED_DAY,
        prisma,
      });

      const row = await prisma.rateChange.findUnique({ where: { id: result.rateChangeId } });
      expect(row!.windowDeliveryDays).toBe(5);
      expect(row!.windowDaysFound).toBe(5);
      expect(row!.windowDayKeys).toHaveLength(5);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4b. Delivery Days — the window adapts to the agency's schedule
  //
  // The property the Delivery Day exists for: the same definition is right for
  // an agency that works five days a week and one that works seven, and it does
  // not depend on anyone telling the system which.
  //
  // Calendar context. 2026-09-07 is a Monday (and Labor Day, which is a federal
  // holiday and therefore not a BUSINESS Day -- irrelevant here, and pinned
  // elsewhere, because the rating window does not use Business Days).
  //   2026-09-03 Thu   2026-09-04 Fri   2026-09-05 Sat
  //   2026-09-06 Sun   2026-09-07 Mon
  // ══════════════════════════════════════════════════════════════════════════
  describe('the rating window follows what was delivered, not the calendar', () => {
    const THU = '2026-09-03';
    const FRI = '2026-09-04';
    const SAT = '2026-09-05';
    const SUN = '2026-09-06';
    const MON = '2026-09-07';

    it('rates a weekday-only agency off Thursday, Friday and Monday', async () => {
      // Nothing delivered at the weekend, so the weekend is not a Delivery Day
      // and the window reaches back past it. Under the old calendar-day window
      // this agency's Monday was priced off Sat + Sun + Mon: two empty days, a
      // third of the denominator zero for reasons unconnected to how it closes.
      await seedDeliveredCalls(big.id, THU, 100);
      await seedSubmittedApplications(big.id, THU, 10);
      await seedDeliveredCalls(big.id, FRI, 100);
      await seedSubmittedApplications(big.id, FRI, 10);
      await seedDeliveredCalls(big.id, MON, 100);
      await seedSubmittedApplications(big.id, MON, 10);

      const result = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: MON,
        prisma,
      });

      expect(result.windowDayKeys).toEqual([THU, FRI, MON]);
      expect(result.windowDaysFound).toBe(3);
      expect(result.deliveredCalls).toBe(300);
      expect(result.submittedApplications).toBe(30);
      expect(result.closingPct).toBeCloseTo(10, 6);
      expect(result.newRate).toBe(159);
    });

    it('rates a seven-day agency off Saturday, Sunday and Monday', async () => {
      // Same definition, different agency, different window. Nobody told the
      // system which schedule either of them runs.
      for (const day of [THU, FRI, SAT, SUN, MON]) {
        await seedDeliveredCalls(small.id, day, 100);
        await seedSubmittedApplications(small.id, day, 10);
      }

      const result = await rateAgencyForClosedDay({
        tenantId: small.id,
        closedCalendarDay: MON,
        prisma,
      });

      expect(result.windowDayKeys).toEqual([SAT, SUN, MON]);
      expect(result.deliveredCalls).toBe(300);
    });

    it('gives two agencies different windows on the same rating day', async () => {
      // Both properties above, at once, which is the whole claim: the window is
      // a property of what each agency was given.
      for (const day of [THU, FRI, MON]) {
        await seedDeliveredCalls(big.id, day, 100);
        await seedSubmittedApplications(big.id, day, 12);
      }
      for (const day of [SAT, SUN, MON]) {
        await seedDeliveredCalls(small.id, day, 50);
        await seedSubmittedApplications(small.id, day, 3);
      }

      const run = await runDailyRating({ closedCalendarDay: MON, prisma });
      expect(run.failures).toEqual([]);

      const byTenant = new Map(run.results.map(r => [r.tenantId, r]));

      expect(byTenant.get(big.id)!.windowDayKeys).toEqual([THU, FRI, MON]);
      expect(byTenant.get(big.id)!.closingPct).toBeCloseTo(12, 6);

      expect(byTenant.get(small.id)!.windowDayKeys).toEqual([SAT, SUN, MON]);
      expect(byTenant.get(small.id)!.closingPct).toBeCloseTo(6, 6);
    });

    it('does not count a day whose only calls rang unanswered', async () => {
      // A Delivery Day is a day we DELIVERED a call, which is the same
      // predicate the denominator uses. A day of ring-outs is not one.
      await seedDeliveredCalls(big.id, THU, 50);
      await seedDeliveredCalls(big.id, FRI, 50);
      for (let i = 0; i < 20; i++) {
        await seedCall({ tenantId: big.id, answeredAt: null });
      }
      await seedDeliveredCalls(big.id, MON, 50);

      const result = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: MON,
        prisma,
      });

      expect(result.windowDayKeys).toEqual([THU, FRI, MON]);
      expect(result.deliveredCalls).toBe(150);
    });

    it('records a short window as short rather than padding it', async () => {
      // A brand new agency with two Delivery Days. The row says three were
      // asked for and two were found: a smaller sample, and the record an
      // agency is shown in a dispute should say so rather than implying three
      // days of evidence.
      await seedDeliveredCalls(big.id, FRI, 100);
      await seedSubmittedApplications(big.id, FRI, 10);
      await seedDeliveredCalls(big.id, MON, 100);
      await seedSubmittedApplications(big.id, MON, 10);

      const result = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: MON,
        prisma,
      });

      expect(result.windowDayKeys).toEqual([FRI, MON]);
      expect(result.windowDaysFound).toBe(2);

      const row = await prisma.rateChange.findUnique({ where: { id: result.rateChangeId } });
      expect(row!.windowDeliveryDays).toBe(3);
      expect(row!.windowDaysFound).toBe(2);
      // Still priced, on what there is.
      expect(result.newRate).toBe(159);
    });

    it('surfaces the window days to the agency, so it can reconstruct its own price', async () => {
      for (const day of [THU, FRI, MON]) {
        await seedDeliveredCalls(big.id, day, 100);
        await seedSubmittedApplications(big.id, day, 8);
      }
      await rateAgencyForClosedDay({ tenantId: big.id, closedCalendarDay: MON, prisma });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/rating/history',
        headers: tokenFor(big.ownerId, big.id),
      });

      expect(response.statusCode).toBe(200);
      const [row] = response.json().data;
      // "3 days" would not tell the agency whether the weekend was in it.
      expect(row.windowDayKeys).toEqual([THU, FRI, MON]);
      expect(row.windowDeliveryDays).toBe(3);
      expect(row.windowDaysFound).toBe(3);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. Curve versioning
  // ══════════════════════════════════════════════════════════════════════════
  describe('curve versioning', () => {
    it('a new curve version does not alter a rate already applied', async () => {
      await seedDeliveredCalls(big.id, CLOSED_DAY, 100);
      await seedSubmittedApplications(big.id, CLOSED_DAY, 10);

      const settled = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: CLOSED_DAY,
        prisma,
      });
      expect(settled.newRate).toBe(159);
      expect(settled.curveVersion).toBe(1);

      // Publish a version that prices 10% at $99 instead of $159.
      const publish = await app.inject({
        method: 'POST',
        url: '/api/v1/platform/rating/curve',
        headers: tokenFor(operatorId, null),
        payload: {
          label: 'Repriced',
          minimumClosingPct: 5,
          flatFromClosingPct: 15,
          anchors: [
            { closingPct: 5, rate: 120 },
            { closingPct: 15, rate: 80 },
          ],
        },
      });
      expect(publish.statusCode).toBe(201);

      // The settled row still recomputes to $159, because it names v1.
      const recomputed = await recomputeFromRecord(settled.rateChangeId, prisma);
      expect(recomputed.rate).toBe(159);
      expect(recomputed.matchesStoredRate).toBe(true);

      // And the stored row is untouched.
      const row = await prisma.rateChange.findUnique({ where: { id: settled.rateChangeId } });
      expect(Number(row!.newRate)).toBe(159);
      expect(row!.curveVersion).toBe(1);

      // New pricing uses the new version.
      const curve = await loadActiveCurve(prisma);
      expect(curve.version).toBe(2);
      expect(rateFor(curve, 10)).toEqual({ kind: 'RATE', rate: 100 });
    });

    it('publishes a curve with no introductory package, because there is no such thing', async () => {
      /*
       * Phase 2 required `introductoryRate` and `introductoryApplications` on
       * every published curve and answered 400 without them. Phase 3 removed the
       * introductory package entirely -- an agency's opening rate and block are
       * agreed per tenant before its first Delivery Day -- so a curve that names
       * only its anchors is now the normal shape, and this asserts the old
       * refusal is gone rather than merely untested.
       */
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/platform/rating/curve',
        headers: tokenFor(operatorId, null),
        payload: {
          anchors: [
            { closingPct: 5, rate: 200 },
            { closingPct: 15, rate: 100 },
          ],
        },
      });

      expect(response.statusCode).toBe(201);

      // And nothing on the published version quotes an introductory price.
      const published = await prisma.rateCurveVersion.findUnique({
        where: { id: response.json().data.id as string },
      });
      expect(Number(published!.introductoryRate)).toBe(0);
      expect(published!.introductoryApplications).toBe(0);
    });

    it('refuses an agency OWNER publishing a curve', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/platform/rating/curve',
        headers: tokenFor(big.ownerId, big.id),
        payload: {
          anchors: [
            { closingPct: 5, rate: 1 },
            { closingPct: 15, rate: 1 },
          ],
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. Review flags are cleared by NetEnroll, never by the agency
  // ══════════════════════════════════════════════════════════════════════════
  describe('review flags', () => {
    async function flagBigAgency(): Promise<string> {
      await seedDeliveredCalls(big.id, CLOSED_DAY, 100);
      await seedSubmittedApplications(big.id, CLOSED_DAY, 2); // 2%
      await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: CLOSED_DAY,
        prisma,
      });
      const flag = await prisma.ratingReviewFlag.findFirstOrThrow({
        where: { tenantId: big.id, clearedAt: null },
      });
      return flag.id;
    }

    it('cannot be cleared by the agency it was raised against', async () => {
      const flagId = await flagBigAgency();

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/platform/rating/review-flags/${flagId}/clear`,
        headers: tokenFor(big.ownerId, big.id),
        payload: {},
      });

      expect(response.statusCode).toBe(403);

      const still = await prisma.ratingReviewFlag.findUnique({ where: { id: flagId } });
      expect(still?.clearedAt).toBeNull();
    });

    it('is cleared by a platform admin, and records who did it', async () => {
      const flagId = await flagBigAgency();

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/platform/rating/review-flags/${flagId}/clear`,
        headers: tokenFor(operatorId, null),
        payload: { note: 'Coaching plan agreed' },
      });

      expect(response.statusCode).toBe(200);

      const cleared = await prisma.ratingReviewFlag.findUnique({ where: { id: flagId } });
      expect(cleared?.clearedAt).not.toBeNull();
      expect(cleared?.clearedByUserId).toBe(operatorId);
      expect(cleared?.clearedNote).toBe('Coaching plan agreed');

      // Clearing does not hand the agency a rate: the next run prices it.
      const state = await prisma.agencyRatingState.findUnique({ where: { tenantId: big.id } });
      expect(state?.status).toBe('RATED');
      expect(state?.currentRate).toBeNull();
    });

    it('stays under review when the next window recovers, until someone clears it', async () => {
      // "Only a platform admin can clear it" would mean nothing if the next
      // day's numbers could do it instead.
      const flagId = await flagBigAgency();

      // A much better following window.
      await seedDeliveredCalls(big.id, EFFECTIVE_DAY, 100);
      await seedSubmittedApplications(big.id, EFFECTIVE_DAY, 30);
      const recovered = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: EFFECTIVE_DAY,
        prisma,
      });

      // The measurement is still recorded — the operator reviewing the flag
      // needs to be able to see the recovery.
      expect(recovered.status).toBe('APPLIED');

      const state = await prisma.agencyRatingState.findUnique({ where: { tenantId: big.id } });
      expect(state?.status).toBe('UNDER_REVIEW');
      expect(state?.currentRate).toBeNull();

      const flag = await prisma.ratingReviewFlag.findUnique({ where: { id: flagId } });
      expect(flag?.clearedAt).toBeNull();
    });

    it('refuses to clear the same flag twice', async () => {
      const flagId = await flagBigAgency();

      await app.inject({
        method: 'POST',
        url: `/api/v1/platform/rating/review-flags/${flagId}/clear`,
        headers: tokenFor(operatorId, null),
        payload: {},
      });

      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/platform/rating/review-flags/${flagId}/clear`,
        headers: tokenFor(operatorId, null),
        payload: {},
      });

      expect(second.statusCode).toBe(409);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6b. The opening package
  // ══════════════════════════════════════════════════════════════════════════
  describe('the opening package', () => {
    it('leaves an agreed opening rate in force while the block is unsettled', async () => {
      // An opening rate and block are agreed before the agency's first Delivery
      // Day and recorded per tenant; daily rating begins from the first settled
      // day. Until then the engine records the measurement and does not reprice
      // the agency out from under the agreement.
      const agreed = await app.inject({
        method: 'PUT',
        url: `/api/v1/platform/rating/agencies/${big.id}/opening`,
        headers: tokenFor(operatorId, null),
        payload: { openingRate: 175, openingBlockApplications: 40, note: 'Signed 2026-09-01' },
      });
      expect(agreed.statusCode).toBe(200);

      await seedDeliveredCalls(big.id, CLOSED_DAY, 100);
      await seedSubmittedApplications(big.id, CLOSED_DAY, 14); // curve says $139

      const result = await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: CLOSED_DAY,
        prisma,
      });

      // The rate change records what the CURVE returned. That is the
      // measurement record and it exists whatever commercial arrangement is in
      // force.
      expect(result.newRate).toBe(139);

      // What the agency is actually priced at is unchanged.
      const state = await prisma.agencyRatingState.findUnique({ where: { tenantId: big.id } });
      expect(state?.status).toBe('OPENING_BLOCK');
      expect(Number(state?.openingRate)).toBe(175);

      const { getRatingSummary } = await import('../services/rating/rating-summary.js');
      const summary = await getRatingSummary(big.id, { prisma });
      expect(summary.currentRate).toBe(175);
      expect(summary.openingBlock).toMatchObject({ rate: 175, applications: 40 });
      expect(summary).not.toHaveProperty('introductory');
    });

    it('quotes no rate at all to an agency with no opening agreement', async () => {
      /*
       * Phase 2 quoted $159 here -- the introductory rate, for the first five
       * applications. There is no such rate now. An agency whose opening terms
       * have not been agreed and recorded has no price, and the portal shows an
       * em dash rather than a number nobody signed. The delivery gate refuses
       * the same agency with NO_OPENING_AGREEMENT.
       */
      await seedSubmittedApplications(big.id, CLOSED_DAY, 3);

      const { getRatingSummary } = await import('../services/rating/rating-summary.js');
      const summary = await getRatingSummary(big.id, { prisma });

      expect(summary.currentRate).toBeNull();
      expect(summary.openingBlock).toBeNull();
      expect(summary).not.toHaveProperty('introductory');
    });

    it('an agency cannot record its own opening rate', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/platform/rating/agencies/${big.id}/opening`,
        headers: tokenFor(big.ownerId, big.id),
        payload: { openingRate: 900 },
      });

      expect(response.statusCode).toBe(403);
      expect(await prisma.agencyRatingState.findUnique({ where: { tenantId: big.id } })).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7. The agency portal
  // ══════════════════════════════════════════════════════════════════════════
  describe('the agency portal summary', () => {
    it("distinguishes today's live percentage from the one that set the rate", async () => {
      // Window: 300 calls, 24 applications -> 8%, priced at $184.
      for (const day of ['2026-09-05', '2026-09-06', '2026-09-07']) {
        await seedDeliveredCalls(big.id, day, 100);
        await seedSubmittedApplications(big.id, day, 8);
      }
      await rateAgencyForClosedDay({
        tenantId: big.id,
        closedCalendarDay: CLOSED_DAY,
        prisma,
      });

      // Today (the effective day) is running much better: 100 calls, 14 apps.
      await seedDeliveredCalls(big.id, EFFECTIVE_DAY, 100);
      await seedSubmittedApplications(big.id, EFFECTIVE_DAY, 14);

      const { getRatingSummary } = await import('../services/rating/rating-summary.js');
      const summary = await getRatingSummary(big.id, {
        prisma,
        now: new Date(calendarDayBounds(EFFECTIVE_DAY).start.getTime() + 18 * 3600_000),
      });

      // Today, which prices nothing.
      expect(summary.today.calendarDay).toBe(EFFECTIVE_DAY);
      expect(summary.today.closingPct).toBeCloseTo(14, 6);

      // The window that actually set the rate in force.
      expect(summary.ratingWindow.closingPct).toBeCloseTo(8, 6);
      expect(summary.currentRate).toBe(184);

      // Where tomorrow is heading: the window ending today is
      // 100+100+100 calls (6th, 7th, 8th) and 8+8+14 applications = 10%.
      expect(summary.trackingRate).toBe(159);
      expect(summary.trackingBelowMinimum).toBe(false);
    });

    it('answers the agency, and only for the agency asking', async () => {
      // Seeded at the real current instant, because the route reads today's
      // business day from the clock rather than from a parameter -- there is
      // deliberately no way for a caller to ask about another day or another
      // agency.
      const now = new Date();
      for (let i = 0; i < 4; i++) {
        await seedCall({ tenantId: big.id, answeredAt: new Date(now.getTime() - i * 1000) });
      }
      await seedApplication({ tenantId: big.id, submittedAt: now });
      for (let i = 0; i < 2; i++) {
        await seedCall({ tenantId: small.id, answeredAt: new Date(now.getTime() - i * 1000) });
      }

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/rating/summary',
        headers: tokenFor(small.ownerId, small.id),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json().data;
      expect(body.tenantId).toBe(small.id);
      // Its own two calls, none of the other agency's four, and none of the
      // other agency's application.
      expect(body.today.deliveredCalls).toBe(2);
      expect(body.today.submittedApplications).toBe(0);
      expect(body.today.closingPct).toBe(0);
    });

    it('refuses an anonymous caller', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/rating/summary' });
      expect(response.statusCode).toBe(401);
    });

    it('tells a platform operator with no agency to pick one, not to log in again', async () => {
      // The failure that locked the owner out of production: this must never be
      // 401, because the web client reads 401 as a dead session.
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/rating/summary',
        headers: tokenFor(operatorId, null),
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('NO_ACTING_TENANT');
    });
  });
});
