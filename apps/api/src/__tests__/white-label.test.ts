/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { CallDirection, CallStatus, Prisma, RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';
import { registerStaffOnly } from '../middleware/staff-only.js';
import { settleAgencyForDeliveryDay } from '../services/billing/settlement.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The white-label tier, end to end against a real database.
 *
 * Two agencies share every table: Life Leads Plus, on the white-label tier,
 * and Ridgeline, a normal agency. Both have calls in the same period with
 * very different money on them, so any figure that leaks across the tenant
 * line shows up as a wrong number rather than as an extra row somebody has to
 * notice.
 *
 *   /api/v1/call-sales/summary     hand-computed totals, buyers, publishers, days
 *   /api/v1/payouts                exactly the right calls, once, in one tenant
 *   /api/v1/network/agencies       children only, aggregates only
 *   /api/auth/me                   whiteLabel
 *   PATCH .../branding             whiteLabel, staff only
 *   settlement                     skips a child agency
 */

const gate = databaseGate();
announceSkip('White-label tier', gate);

const TEST_JWT_SECRET = 'white-label-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('White-label suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `white-label suite cannot run: ${gate.reason}`).toBe(true);
  });
});

/** The period every fixture call is measured over: two New York days. */
const PERIOD = 'period=CUSTOM&from=2026-09-10&to=2026-09-11';
/** 11:00 and 15:00 New York on each day, well clear of either midnight. */
const DAY1 = new Date('2026-09-10T15:00:00Z');
const DAY1_LATER = new Date('2026-09-10T19:00:00Z');
const DAY2 = new Date('2026-09-11T15:00:00Z');
const AFTER = new Date('2026-09-12T15:00:00Z');
/** The instants a payment for exactly that period names. */
const PERIOD_FROM = '2026-09-10T04:00:00.000Z';
const PERIOD_TO = '2026-09-12T03:59:59.999Z';

describe.skipIf(!gate.available)('White-label tier', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  let wl: {
    id: string;
    ownerId: string;
    adminId: string;
    agentId: string;
    alpha: string;
    beta: string;
    acme: string;
    zen: string;
  };
  let normal: { id: string; ownerId: string; publisherId: string; buyerId: string };
  let operatorId: string;
  let seq = 0;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);
    registerStaffOnly(instance);

    const { registerPlatformRoutes } = await import('../routes/platform.js');
    const { registerAuthRoutes } = await import('../routes/auth.js');
    const { registerCallSalesRoutes } = await import('../routes/call-sales.js');
    const { registerPayoutRoutes } = await import('../routes/payouts.js');
    const { registerNetworkRoutes } = await import('../routes/network.js');
    const { registerReportingRoutes } = await import('../routes/index.js');
    await instance.register(registerPlatformRoutes);
    await instance.register(registerAuthRoutes);
    await instance.register(registerCallSalesRoutes);
    await instance.register(registerPayoutRoutes);
    await instance.register(registerNetworkRoutes);
    await instance.register(registerReportingRoutes);

    await instance.ready();
    return instance;
  }

  function tokenFor(userId: string, tenantId: string | null): Record<string, string> {
    return {
      authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${userId}@test.local` })}`,
    };
  }

  function get(userId: string, tenantId: string | null, url: string) {
    return app.inject({ method: 'GET', url, headers: tokenFor(userId, tenantId) });
  }

  function post(userId: string, tenantId: string | null, url: string, payload: unknown) {
    return app.inject({
      method: 'POST',
      url,
      headers: tokenFor(userId, tenantId),
      payload: payload as Record<string, unknown>,
    });
  }

  async function enter(tenantId: string) {
    const response = await post(operatorId, null, '/api/v1/platform/acting-tenant', { tenantId });
    expect(response.statusCode, 'the operator could not enter the agency').toBe(200);
  }

  async function call(
    tenantId: string,
    data: Partial<Prisma.CallUncheckedCreateInput> & { createdAt: Date }
  ) {
    return prisma.call.create({
      data: {
        tenantId,
        toNumber: '+15550000000',
        callSid: `wl-call-${++seq}-${Date.now()}`,
        status: CallStatus.COMPLETED,
        direction: CallDirection.INBOUND,
        ...data,
      },
    });
  }

  async function cleanDatabase() {
    for (const table of ['audit_logs', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
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
    await cleanDatabase();

    const roleIds: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.ADMIN, RoleName.AGENT]) {
      const role = await prisma.role.create({
        data: { name, description: `${name} role`, permissions: [] },
      });
      roleIds[name] = role.id;
    }

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    async function user(tenantId: string, role: RoleName, label: string) {
      const row = await prisma.user.create({
        data: {
          tenantId,
          email: `${label}-${stamp}@agency.local`,
          status: 'ACTIVE',
          roles: { create: { roleId: roleIds[role] } },
        },
      });
      return row.id;
    }

    async function publisher(tenantId: string, name: string) {
      return (
        await prisma.publisher.create({
          data: { tenantId, name, code: `pub-${++seq}` },
        })
      ).id;
    }

    async function buyer(tenantId: string, name: string) {
      return (await prisma.buyer.create({ data: { tenantId, name, code: `buy-${++seq}` } })).id;
    }

    const llp = await prisma.tenant.create({
      data: {
        name: 'Life Leads Plus LLC',
        slug: `llp-${stamp}`,
        status: 'ACTIVE',
        brandTheme: 'life-leads-plus',
        brandName: 'Life Leads Plus',
        whiteLabel: true,
      },
    });
    wl = {
      id: llp.id,
      ownerId: await user(llp.id, RoleName.OWNER, 'wl-owner'),
      adminId: await user(llp.id, RoleName.ADMIN, 'wl-admin'),
      agentId: await user(llp.id, RoleName.AGENT, 'wl-agent'),
      alpha: await publisher(llp.id, 'Alpha Media'),
      beta: await publisher(llp.id, 'Beta Leads'),
      acme: await buyer(llp.id, 'Acme Senior'),
      zen: await buyer(llp.id, 'Zen Health'),
    };
    await prisma.buyerStats.create({ data: { buyerId: wl.acme, capConsumedToday: 7 } });

    const ridge = await prisma.tenant.create({
      data: { name: 'Ridgeline Insurance', slug: `ridge-${stamp}`, status: 'ACTIVE' },
    });
    normal = {
      id: ridge.id,
      ownerId: await user(ridge.id, RoleName.OWNER, 'ridge-owner'),
      publisherId: await publisher(ridge.id, 'Ridgeline Source'),
      buyerId: await buyer(ridge.id, 'Ridgeline Buyer'),
    };

    const operator = await prisma.user.create({
      data: { email: `operator-${stamp}@netenroll.test`, status: 'ACTIVE', tenantId: null },
    });
    operatorId = operator.id;
    await grantPlatformAdmin(operatorId, { note: 'white-label suite fixture' });

    /* ── Life Leads Plus's calls. The expected figures below are from these. ── */
    const c1 = await call(wl.id, {
      createdAt: DAY1,
      publisherId: wl.alpha,
      buyerId: wl.acme,
      billable: true,
      buyerBillableAmount: new Prisma.Decimal('50'),
      publisherPayoutAmount: new Prisma.Decimal('20'),
      publisherPayoutStatus: 'PAYABLE',
      cost: new Prisma.Decimal('0.50'),
      connectedDuration: 200,
    });
    await call(wl.id, {
      createdAt: DAY1_LATER,
      publisherId: wl.alpha,
      buyerId: wl.acme,
      billable: false,
      buyerBillableAmount: new Prisma.Decimal('0'),
      publisherPayoutAmount: new Prisma.Decimal('0'),
      publisherPayoutStatus: 'NOT_PAYABLE',
      cost: new Prisma.Decimal('0.10'),
      connectedDuration: 30,
    });
    const c3 = await call(wl.id, {
      createdAt: DAY2,
      publisherId: wl.beta,
      buyerId: wl.zen,
      billable: true,
      buyerBillableAmount: new Prisma.Decimal('40'),
      publisherPayoutAmount: new Prisma.Decimal('15'),
      publisherPayoutStatus: 'PAYABLE',
      disputeStatus: 'OPEN',
      cost: new Prisma.Decimal('0.40'),
      connectedDuration: 120,
    });
    await call(wl.id, {
      createdAt: DAY2,
      publisherId: wl.beta,
      answeredByUserId: wl.agentId,
      billable: true,
      buyerBillableAmount: new Prisma.Decimal('0'),
      publisherPayoutAmount: new Prisma.Decimal('10'),
      publisherPayoutStatus: 'PAYABLE',
      cost: new Prisma.Decimal('0.30'),
      connectedDuration: 300,
    });
    await call(wl.id, {
      createdAt: DAY2,
      publisherId: wl.alpha,
      blocked: true,
      isDuplicate: true,
      cost: new Prisma.Decimal('0'),
    });
    // Outbound: not a call that was sold, and carries no money.
    await call(wl.id, { createdAt: DAY1, direction: CallDirection.OUTBOUND });
    // Inbound and payable, but the day after the period.
    await call(wl.id, {
      createdAt: AFTER,
      publisherId: wl.alpha,
      billable: true,
      buyerBillableAmount: new Prisma.Decimal('0'),
      publisherPayoutAmount: new Prisma.Decimal('5'),
      publisherPayoutStatus: 'PAYABLE',
    });

    const account = await prisma.billingAccount.create({
      data: { tenantId: wl.id, name: 'Life Leads Plus' },
    });
    for (const [callId, type, amount] of [
      [c1.id, 'RECORDING_FEE', '0.05'],
      [c3.id, 'ADJUSTMENT', '-2.00'],
    ] as const) {
      await prisma.accrualLedger.create({
        data: {
          tenantId: wl.id,
          billingAccountId: account.id,
          callId,
          type,
          amount: new Prisma.Decimal(amount),
          description: 'fixture',
          periodDate: DAY1,
          idempotencyKey: `wl-${callId}-${type}`,
        },
      });
    }

    /* ── Ridgeline's calls: same period, very different money. ─────────────── */
    for (const createdAt of [DAY1, DAY2]) {
      await call(normal.id, {
        createdAt,
        publisherId: normal.publisherId,
        buyerId: normal.buyerId,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('1000'),
        publisherPayoutAmount: new Prisma.Decimal('700'),
        publisherPayoutStatus: 'PAYABLE',
        cost: new Prisma.Decimal('9'),
        connectedDuration: 900,
      });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Sales
  // ══════════════════════════════════════════════════════════════════════════
  describe('GET /api/v1/call-sales/summary', () => {
    it('answers the hand-computed totals for the acting tenant only', async () => {
      const response = await get(wl.ownerId, wl.id, `/api/v1/call-sales/summary?${PERIOD}`);
      expect(response.statusCode).toBe(200);
      const data = response.json().data;

      expect(data.period).toMatchObject({ key: 'CUSTOM', from: '2026-09-10', to: '2026-09-11' });
      expect(data.totals).toEqual({
        inboundCalls: 5,
        answeredByAgents: 1,
        sentToBuyers: 3,
        billableToBuyers: 2,
        sellThroughPct: 66.67,
        revenue: 90,
        publisherPayouts: 45,
        callCost: 1.3,
        otherCosts: 0.05,
        adjustments: -2,
        disputes: 40,
        profit: 43.65,
        marginPct: 48.5,
        revenuePerBillableCall: 45,
        disputedCalls: 1,
        duplicates: 1,
        blocked: 1,
      });
      expect(data.disposition).toEqual({ yourAgents: 1, buyers: 3, unanswered: 0, blocked: 1 });
    });

    it('breaks it down by buyer, by publisher and by day', async () => {
      const data = (await get(wl.adminId, wl.id, `/api/v1/call-sales/summary?${PERIOD}`)).json()
        .data;

      expect(data.byBuyer).toEqual([
        {
          buyerId: wl.acme,
          buyerName: 'Acme Senior',
          calls: 2,
          billable: 1,
          billablePct: 50,
          revenue: 50,
          avgConnectedSeconds: 115,
          disputed: 0,
          capConsumedToday: 7,
        },
        {
          buyerId: wl.zen,
          buyerName: 'Zen Health',
          calls: 1,
          billable: 1,
          billablePct: 100,
          revenue: 40,
          avgConnectedSeconds: 120,
          disputed: 1,
          capConsumedToday: 0,
        },
      ]);

      expect(data.byPublisher).toEqual([
        {
          publisherId: wl.alpha,
          publisherName: 'Alpha Media',
          calls: 3,
          answeredByAgents: 0,
          sentToBuyers: 2,
          billable: 1,
          payout: 20,
          revenue: 50,
          profit: 29.35,
        },
        {
          publisherId: wl.beta,
          publisherName: 'Beta Leads',
          calls: 2,
          answeredByAgents: 1,
          sentToBuyers: 1,
          billable: 1,
          payout: 25,
          revenue: 40,
          profit: 14.3,
        },
      ]);

      expect(data.byDay).toEqual([
        {
          day: '2026-09-10',
          inbound: 2,
          sentToBuyers: 2,
          billable: 1,
          revenue: 50,
          payout: 20,
          profit: 29.35,
        },
        {
          day: '2026-09-11',
          inbound: 3,
          sentToBuyers: 1,
          billable: 1,
          revenue: 40,
          payout: 25,
          profit: 14.3,
        },
      ]);
    });

    it("never shows the other tenant's calls, buyers or publishers", async () => {
      const body = (await get(wl.ownerId, wl.id, `/api/v1/call-sales/summary?${PERIOD}`)).body;
      expect(body).not.toContain(normal.buyerId);
      expect(body).not.toContain(normal.publisherId);
      expect(body).not.toContain('Ridgeline');
      expect(body).not.toContain('1000');
    });

    it('reconciles with the campaign profitability report for the same period', async () => {
      const sales = (await get(wl.ownerId, wl.id, `/api/v1/call-sales/summary?${PERIOD}`)).json()
        .data.totals;
      const report = (
        await get(
          wl.ownerId,
          wl.id,
          `/api/v1/reports/campaign-profitability?startDate=${PERIOD_FROM}&endDate=${PERIOD_TO}`
        )
      ).json().totals;

      expect(Number(report.buyerRevenue)).toBe(sales.revenue);
      expect(Number(report.publisherPayout)).toBe(sales.publisherPayouts);
      expect(Number(report.callCost)).toBe(sales.callCost);
      expect(Number(report.otherCosts)).toBe(sales.otherCosts);
      expect(Number(report.profit)).toBe(sales.profit);
    });

    it('exports buyers and publishers as CSV', async () => {
      const response = await get(wl.ownerId, wl.id, `/api/v1/call-sales/summary.csv?${PERIOD}`);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.body).toContain('"Acme Senior",2,1,50,50.00');
      expect(response.body).toContain('"Beta Leads",2,1,1,1,25.00,40.00,14.30');
    });

    it('guards a name that reads as a formula', async () => {
      await prisma.buyer.update({ where: { id: wl.acme }, data: { name: '=HYPERLINK("x")' } });
      const response = await get(wl.ownerId, wl.id, `/api/v1/call-sales/summary.csv?${PERIOD}`);
      expect(response.body).toContain(`"'=HYPERLINK(""x"")"`);
    });

    it('refuses a normal agency owner, and a white-label agent', async () => {
      expect(
        (await get(normal.ownerId, normal.id, `/api/v1/call-sales/summary?${PERIOD}`)).statusCode
      ).toBe(403);
      expect(
        (await get(wl.agentId, wl.id, `/api/v1/call-sales/summary?${PERIOD}`)).statusCode
      ).toBe(403);
    });

    it('serves a platform admin inside the agency, and asks one outside to pick', async () => {
      expect((await get(operatorId, null, `/api/v1/call-sales/summary?${PERIOD}`)).statusCode).toBe(
        409
      );
      await enter(wl.id);
      const response = await get(operatorId, null, `/api/v1/call-sales/summary?${PERIOD}`);
      expect(response.statusCode).toBe(200);
      expect(response.json().data.totals.revenue).toBe(90);
    });

    it('refuses a period it does not know', async () => {
      expect(
        (await get(wl.ownerId, wl.id, '/api/v1/call-sales/summary?period=FOREVER')).statusCode
      ).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Payouts
  // ══════════════════════════════════════════════════════════════════════════
  describe('payouts', () => {
    const record = (userId: string, tenantId: string, publisherId: string) =>
      post(userId, tenantId, '/api/v1/payouts', {
        publisherId,
        periodFrom: PERIOD_FROM,
        periodTo: PERIOD_TO,
        method: 'ACH',
        reference: 'TRX-1',
      });

    async function summaryRow(publisherId: string) {
      const data = (await get(wl.ownerId, wl.id, `/api/v1/payouts/summary?${PERIOD}`)).json().data;
      return data.publishers.find((row: any) => row.publisherId === publisherId);
    }

    it("reads each publisher's payable, held and paid", async () => {
      expect(await summaryRow(wl.alpha)).toMatchObject({ payable: 20, held: 0, paid: 0 });
      // Beta's disputed call is held, not payable.
      expect(await summaryRow(wl.beta)).toMatchObject({ payable: 10, held: 15, paid: 0 });
      const body = (await get(wl.ownerId, wl.id, `/api/v1/payouts/summary?${PERIOD}`)).body;
      expect(body).not.toContain(normal.publisherId);
    });

    it("marks exactly that publisher's payable, undisputed calls in range, and audits it", async () => {
      const response = await record(wl.ownerId, wl.id, wl.alpha);
      expect(response.statusCode).toBe(201);
      expect(response.json().data).toMatchObject({ amount: 20, calls: 1, method: 'ACH' });

      const paid = await prisma.call.findMany({
        where: { publisherPayoutStatus: 'PAID' },
        select: { tenantId: true, publisherId: true, createdAt: true, paidOut: true },
      });
      expect(paid).toHaveLength(1);
      expect(paid[0]).toMatchObject({ tenantId: wl.id, publisherId: wl.alpha, paidOut: true });
      expect(paid[0].createdAt.toISOString()).toBe(DAY1.toISOString());

      // Out of range, another publisher's, and another tenant's: all untouched.
      expect(
        await prisma.call.count({ where: { publisherPayoutStatus: 'PAYABLE', tenantId: wl.id } })
      ).toBe(3);
      expect(
        await prisma.call.count({
          where: { publisherPayoutStatus: 'PAYABLE', tenantId: normal.id },
        })
      ).toBe(2);

      expect(await prisma.publisherPayment.count()).toBe(1);
      const audit = await prisma.auditLog.findMany({
        where: { action: 'payouts.publisher_payment.recorded' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ tenantId: wl.id, userId: wl.ownerId });

      // Payable drops to zero; paid rises by the same amount.
      expect(await summaryRow(wl.alpha)).toMatchObject({ payable: 0, paid: 20 });
      expect((await summaryRow(wl.alpha)).lastPayment).toMatchObject({ amount: 20 });
    });

    it('refuses the same range a second time with 409', async () => {
      expect((await record(wl.ownerId, wl.id, wl.alpha)).statusCode).toBe(201);
      const again = await record(wl.ownerId, wl.id, wl.alpha);
      expect(again.statusCode).toBe(409);
      expect(await prisma.publisherPayment.count()).toBe(1);
    });

    it("answers 404 for another tenant's publisher, and changes nothing", async () => {
      const response = await record(wl.ownerId, wl.id, normal.publisherId);
      expect(response.statusCode).toBe(404);
      expect(await prisma.call.count({ where: { publisherPayoutStatus: 'PAID' } })).toBe(0);
    });

    it('refuses a normal agency owner on both routes', async () => {
      expect(
        (await get(normal.ownerId, normal.id, `/api/v1/payouts/summary?${PERIOD}`)).statusCode
      ).toBe(403);
      expect((await record(normal.ownerId, normal.id, normal.publisherId)).statusCode).toBe(403);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Agency Network
  // ══════════════════════════════════════════════════════════════════════════
  describe('agency network', () => {
    const CHILD = {
      name: 'Downline One',
      legalName: 'Downline One LLC',
      state: 'tx',
      contactName: 'Dana Down',
      contactEmail: 'Dana@Downline.test',
      contactPhone: '+15125550100',
      licensedAgents: 4,
      deliveryDays: ['mon', 'tue', 'wed'],
      deliveryStart: '09:00',
      deliveryEnd: '17:00',
      timezone: 'America/Chicago',
    };

    async function createChild(payload: Record<string, unknown> = CHILD) {
      const response = await post(wl.ownerId, wl.id, '/api/v1/network/agencies', payload);
      expect(response.statusCode, response.body).toBe(201);
      return response.json().data.tenantId as string;
    }

    it("creates a child with the parent, the parent's brand and no billing profile", async () => {
      const childId = await createChild();
      const child = await prisma.tenant.findUnique({ where: { id: childId } });
      expect(child).toMatchObject({
        parentTenantId: wl.id,
        brandTheme: 'life-leads-plus',
        brandName: 'Life Leads Plus',
        whiteLabel: false,
        status: 'ACTIVE',
      });
      expect(await prisma.agencyBillingProfile.count({ where: { tenantId: childId } })).toBe(0);
      expect(await prisma.agencyProfile.findUnique({ where: { tenantId: childId } })).toMatchObject(
        {
          legalName: 'Downline One LLC',
          state: 'TX',
          contactEmail: 'dana@downline.test',
          licensedAgentCount: 4,
          deliveryDays: ['MON', 'TUE', 'WED'],
          deliveryStartTime: '09:00',
          deliveryEndTime: '17:00',
          deliveryTimeZone: 'America/Chicago',
        }
      );

      const audits = await prisma.auditLog.findMany({
        where: { action: { startsWith: 'network.agency.created' } },
        select: { tenantId: true },
      });
      expect(audits.map(a => a.tenantId).sort()).toEqual([childId, wl.id].sort());
    });

    it('validates with the onboarding rules, every problem at once', async () => {
      const response = await post(wl.ownerId, wl.id, '/api/v1/network/agencies', {
        ...CHILD,
        state: 'Texas',
        contactEmail: 'nope',
        deliveryDays: ['FUNDAY'],
        deliveryEnd: '08:00',
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.problems).toHaveLength(4);
    });

    it('invites the owner of a child, and 404s for anything else', async () => {
      const childId = await createChild();

      const foreign = await post(wl.ownerId, wl.id, `/api/v1/network/agencies/${normal.id}/owner`, {
        email: 'someone@ridge.test',
      });
      expect(foreign.statusCode).toBe(404);
      const self = await post(wl.ownerId, wl.id, `/api/v1/network/agencies/${wl.id}/owner`, {
        email: 'someone@llp.test',
      });
      expect(self.statusCode).toBe(404);
      expect(await prisma.tenantActivationGrant.count()).toBe(0);

      const invited = await post(wl.ownerId, wl.id, `/api/v1/network/agencies/${childId}/owner`, {
        email: 'owner@downline.test',
      });
      expect(invited.statusCode).toBe(201);
      expect(invited.json().data.activationToken).toEqual(expect.any(String));
      const grant = await prisma.tenantActivationGrant.findFirst();
      expect(grant).toMatchObject({
        tenantId: childId,
        roleName: 'OWNER',
        email: 'owner@downline.test',
      });
    });

    it('lists only children, and only aggregates', async () => {
      const childId = await createChild();
      await call(childId, { createdAt: DAY1, answeredByUserId: null });
      // Another white-label agency's child must not appear.
      const other = await prisma.tenant.create({
        data: { name: 'Elsewhere', slug: `else-${Date.now()}`, whiteLabel: true },
      });
      await prisma.tenant.create({
        data: { name: 'Not yours', slug: `notyours-${Date.now()}`, parentTenantId: other.id },
      });

      const response = await get(wl.ownerId, wl.id, `/api/v1/network/agencies?${PERIOD}`);
      expect(response.statusCode).toBe(200);
      const agencies = response.json().data.agencies;
      expect(agencies).toHaveLength(1);
      expect(Object.keys(agencies[0]).sort()).toEqual(
        [
          'agents',
          'answeredByAgents',
          'applications',
          'closingPct',
          'createdAt',
          'inboundCalls',
          'name',
          'owner',
          'status',
          'tenantId',
        ].sort()
      );
      expect(agencies[0]).toMatchObject({
        tenantId: childId,
        name: 'Downline One',
        inboundCalls: 1,
        answeredByAgents: 0,
        applications: 0,
        closingPct: null,
        owner: { status: 'NOT_INVITED' },
      });
    });

    it('refuses a normal agency 403 on every network route', async () => {
      const childId = await createChild();
      expect(
        (await get(normal.ownerId, normal.id, `/api/v1/network/agencies?${PERIOD}`)).statusCode
      ).toBe(403);
      expect(
        (await post(normal.ownerId, normal.id, '/api/v1/network/agencies', CHILD)).statusCode
      ).toBe(403);
      expect(
        (
          await post(normal.ownerId, normal.id, `/api/v1/network/agencies/${childId}/owner`, {
            email: 'x@y.test',
          })
        ).statusCode
      ).toBe(403);
    });

    it('skips a child agency in the settlement run', async () => {
      const childId = await createChild();
      const result = await settleAgencyForDeliveryDay({
        tenantId: childId,
        deliveryDay: '2026-09-10',
        prisma,
      });
      expect(result.settlementId).toBeNull();
      expect(result.skippedReason).toBe('billed by its parent agency, not by NetEnroll');
      expect(await prisma.dailySettlement.count({ where: { tenantId: childId } })).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // The flag itself
  // ══════════════════════════════════════════════════════════════════════════
  describe('/api/auth/me', () => {
    it('says whether the tenant is white-label', async () => {
      expect((await get(wl.ownerId, wl.id, '/api/auth/me')).json().whiteLabel).toBe(true);
      expect((await get(wl.agentId, wl.id, '/api/auth/me')).json().whiteLabel).toBe(true);
      expect((await get(normal.ownerId, normal.id, '/api/auth/me')).json().whiteLabel).toBe(false);
    });

    it("gives a platform admin the entered agency's value, and false with none", async () => {
      expect((await get(operatorId, null, '/api/auth/me')).json().whiteLabel).toBe(false);
      await enter(wl.id);
      expect((await get(operatorId, null, '/api/auth/me')).json().whiteLabel).toBe(true);
      await enter(normal.id);
      expect((await get(operatorId, null, '/api/auth/me')).json().whiteLabel).toBe(false);
    });
  });

  describe('PATCH /api/v1/admin/tenants/:id/branding with whiteLabel', () => {
    const setTier = (userId: string, tenantId: string | null, target: string, payload: unknown) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/tenants/${target}/branding`,
        headers: tokenFor(userId, tenantId),
        payload: payload as Record<string, unknown>,
      });

    it('lets a platform admin set it, and audits the change', async () => {
      const response = await setTier(operatorId, null, normal.id, { whiteLabel: true });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({ tenantId: normal.id, whiteLabel: true });
      expect((await prisma.tenant.findUnique({ where: { id: normal.id } }))?.whiteLabel).toBe(true);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'platform.tenant.brand_changed', tenantId: normal.id },
      });
      expect(audit?.changes).toMatchObject({
        before: { whiteLabel: false },
        after: { whiteLabel: true },
      });

      // And the owner's next request carries it.
      expect((await get(normal.ownerId, normal.id, '/api/auth/me')).json().whiteLabel).toBe(true);
      expect(
        (await get(normal.ownerId, normal.id, `/api/v1/call-sales/summary?${PERIOD}`)).statusCode
      ).toBe(200);
    });

    it("refuses an agency's own OWNER, white-label or not", async () => {
      expect((await setTier(wl.ownerId, wl.id, wl.id, { whiteLabel: false })).statusCode).toBe(403);
      expect(
        (await setTier(normal.ownerId, normal.id, normal.id, { whiteLabel: true })).statusCode
      ).toBe(403);
      expect((await prisma.tenant.findUnique({ where: { id: normal.id } }))?.whiteLabel).toBe(
        false
      );
    });

    it('refuses anything but a boolean', async () => {
      expect((await setTier(operatorId, null, normal.id, { whiteLabel: 'true' })).statusCode).toBe(
        400
      );
    });
  });
});
