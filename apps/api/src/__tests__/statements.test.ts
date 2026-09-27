/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { existsSync, readdirSync } from 'node:fs';

import { CallDirection, CallStatus, Prisma, RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';
import { registerStaffOnly } from '../middleware/staff-only.js';
import { getWhiteLabelToday } from '../routes/white-label-today.js';
import { resolvePeriod } from '../services/leaderboard/period.js';
import { getCallSalesSummary } from '../services/reporting/call-sales.js';
import { currentMonth } from '../services/statements/statement-month.js';
import { closeMonth, renderStatement } from '../services/statements/statements.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Monthly statements, end to end against a real database, and the one money
 * definition every screen shares.
 *
 *   consistency   one month's revenue, payout, profit and billable counts are
 *                 identical on Sales, the three reports, Today and the agency
 *                 statement
 *   late return   a return accepted after a month closed leaves that month's
 *                 statement alone and appears on the month it was accepted in
 *   close         idempotent; `rebuild` rewrites
 *   wallet        an UPFRONT buyer's wallet must reconcile or nothing renders
 *   render        each party's PDF and CSV
 *   access        who may read which party's statement
 *   brand         a branded agency's statements never say NetEnroll
 */

const gate = databaseGate();
announceSkip('Statements', gate);

const TEST_JWT_SECRET = 'statements-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

/** Puppeteer's own Chrome, or the one this machine already has. */
function chromeForPdf(): void {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return;
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return;
  for (const dir of readdirSync(root)) {
    const candidate = `${root}/${dir}/chrome-linux/chrome`;
    if (dir.startsWith('chromium-') && existsSync(candidate)) {
      process.env.PUPPETEER_EXECUTABLE_PATH = candidate;
      return;
    }
  }
}

/** A July 2026 call, well clear of either New York midnight. */
const JULY = new Date('2026-07-15T16:00:00Z');

describe('Statements suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `statements suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Monthly statements', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let seq = 0;

  let wl: {
    id: string;
    ownerId: string;
    acme: string;
    zen: string;
    alpha: string;
    beta: string;
    acmeUser: string;
    zenUser: string;
    alphaUser: string;
    betaUser: string;
    agentId: string;
    julyCall: string;
  };
  let child: { id: string; ownerId: string };
  let sibling: { id: string; ownerId: string };
  let other: { id: string; ownerId: string; buyer: string };
  let operatorId: string;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);
    registerStaffOnly(instance);

    const { registerStatementRoutes } = await import('../routes/statements.js');
    const { registerCallSalesRoutes } = await import('../routes/call-sales.js');
    const { registerReturnRoutes } = await import('../routes/returns.js');
    const { registerReportingRoutes } = await import('../routes/index.js');
    await instance.register(registerStatementRoutes);
    await instance.register(registerCallSalesRoutes);
    await instance.register(registerReturnRoutes);
    await instance.register(registerReportingRoutes);
    await instance.ready();
    return instance;
  }

  function get(userId: string, tenantId: string | null, url: string) {
    return app.inject({
      method: 'GET',
      url,
      headers: {
        authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${userId}@test.local` })}`,
      },
    });
  }

  async function call(
    tenantId: string,
    data: Partial<Prisma.CallUncheckedCreateInput> & { createdAt: Date }
  ) {
    return prisma.call.create({
      data: {
        tenantId,
        toNumber: '+15550000000',
        callSid: `st-call-${++seq}-${Date.now()}`,
        status: CallStatus.COMPLETED,
        direction: CallDirection.INBOUND,
        callerId: '+15125550142',
        campaignName: 'Final Expense',
        ...data,
      },
    });
  }

  beforeAll(async () => {
    chromeForPdf();
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    prisma = getPrismaClient();
    for (const table of ['audit_logs', 'roles', 'tenants']) {
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
      roleIds[name] = (
        await prisma.role.create({ data: { name, description: name, permissions: [] } })
      ).id;
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    async function user(
      tenantId: string,
      role: RoleName,
      label: string,
      link: { buyerId?: string; publisherId?: string } = {}
    ) {
      return (
        await prisma.user.create({
          data: {
            tenantId,
            email: `${label}-${stamp}@agency.test`,
            status: 'ACTIVE',
            ...link,
            roles: { create: { roleId: roleIds[role] } },
          },
        })
      ).id;
    }

    const llp = await prisma.tenant.create({
      data: {
        name: 'Life Leads Plus LLC',
        slug: `llp-${stamp}`,
        status: 'ACTIVE',
        brandTheme: 'life-leads-plus',
        brandName: 'Life Leads Plus',
        whiteLabel: true,
        domain: `portal-${stamp}.lifeleadsplus.test`,
      },
    });
    const acme = await prisma.buyer.create({
      data: { tenantId: llp.id, name: 'Acme Senior', code: `acme-${++seq}`, billingType: 'TERMS' },
    });
    const zen = await prisma.buyer.create({
      data: {
        tenantId: llp.id,
        name: 'Zen Health',
        code: `zen-${++seq}`,
        billingType: 'UPFRONT',
        walletBalance: new Prisma.Decimal('60'),
      },
    });
    const alpha = await prisma.publisher.create({
      data: { tenantId: llp.id, name: 'Alpha Media', code: `alpha-${++seq}` },
    });
    const beta = await prisma.publisher.create({
      data: { tenantId: llp.id, name: 'Beta Leads', code: `beta-${++seq}` },
    });

    const childTenant = await prisma.tenant.create({
      data: { name: 'Downline One', slug: `down1-${stamp}`, parentTenantId: llp.id },
    });
    const siblingTenant = await prisma.tenant.create({
      data: { name: 'Downline Two', slug: `down2-${stamp}`, parentTenantId: llp.id },
    });
    const ridge = await prisma.tenant.create({
      data: { name: 'Ridgeline Insurance', slug: `ridge-${stamp}` },
    });
    const ridgeBuyer = await prisma.buyer.create({
      data: { tenantId: ridge.id, name: 'Ridgeline Buyer', code: `rb-${++seq}` },
    });

    /* ── This month's calls: all of them now, so Today and the month agree. ── */
    const now = new Date(Date.now() - 60_000);
    const agentId = await user(llp.id, RoleName.AGENT, 'agent');
    const c1 = await call(llp.id, {
      createdAt: now,
      publisherId: alpha.id,
      buyerId: acme.id,
      buyerName: acme.name,
      billable: true,
      buyerBillableAmount: new Prisma.Decimal('50'),
      publisherPayoutAmount: new Prisma.Decimal('20'),
      publisherPayoutStatus: 'PAYABLE',
      buyerChargeStatus: 'CHARGED',
      cost: new Prisma.Decimal('0.50'),
      connectedDuration: 200,
    });
    await call(llp.id, {
      createdAt: now,
      publisherId: alpha.id,
      buyerId: acme.id,
      buyerName: acme.name,
      billable: false,
      buyerBillableAmount: new Prisma.Decimal('0'),
      publisherPayoutAmount: new Prisma.Decimal('0'),
      publisherPayoutStatus: 'NOT_PAYABLE',
      cost: new Prisma.Decimal('0.10'),
      connectedDuration: 30,
    });
    const c3 = await call(llp.id, {
      createdAt: now,
      publisherId: beta.id,
      buyerId: zen.id,
      buyerName: zen.name,
      billable: true,
      buyerBillableAmount: new Prisma.Decimal('40'),
      publisherPayoutAmount: new Prisma.Decimal('15'),
      publisherPayoutStatus: 'PAYABLE',
      buyerChargeStatus: 'CHARGED',
      cost: new Prisma.Decimal('0.40'),
      connectedDuration: 120,
    });
    await call(llp.id, {
      createdAt: now,
      publisherId: beta.id,
      answeredByUserId: agentId,
      billable: true,
      buyerBillableAmount: new Prisma.Decimal('0'),
      publisherPayoutAmount: new Prisma.Decimal('10'),
      publisherPayoutStatus: 'PAYABLE',
      cost: new Prisma.Decimal('0.30'),
      connectedDuration: 300,
    });
    await call(llp.id, { createdAt: now, publisherId: alpha.id, blocked: true });
    // Outbound carries no money and is on no statement.
    await call(llp.id, {
      createdAt: now,
      direction: CallDirection.OUTBOUND,
      buyerBillableAmount: new Prisma.Decimal('999'),
    });

    const account = await prisma.billingAccount.create({
      data: { tenantId: llp.id, name: 'Life Leads Plus' },
    });
    await prisma.accrualLedger.create({
      data: {
        tenantId: llp.id,
        billingAccountId: account.id,
        callId: c1.id,
        type: 'RECORDING_FEE',
        amount: new Prisma.Decimal('0.05'),
        description: 'fixture',
        periodDate: now,
        idempotencyKey: `st-${c1.id}-fee`,
      },
    });

    // Zen's wallet: a $100 top-up and the $40 charge for its call. Balance 60.
    await prisma.buyerTransaction.create({
      data: {
        buyerId: zen.id,
        amount: new Prisma.Decimal('100'),
        type: 'CREDIT',
        description: 'Top-up',
        createdAt: now,
      },
    });
    await prisma.buyerTransaction.create({
      data: {
        buyerId: zen.id,
        amount: new Prisma.Decimal('-40'),
        type: 'DEBIT',
        description: `Call ${c3.id}`,
        callId: c3.id,
        createdAt: now,
      },
    });

    /* ── July: one call Acme was billed for, its publisher already paid. ───── */
    const ownerId = await user(llp.id, RoleName.OWNER, 'owner');
    const july = await call(llp.id, {
      createdAt: JULY,
      publisherId: alpha.id,
      buyerId: acme.id,
      buyerName: acme.name,
      billable: true,
      buyerBillableAmount: new Prisma.Decimal('30'),
      publisherPayoutAmount: new Prisma.Decimal('12'),
      publisherPayoutStatus: 'PAID',
      buyerChargeStatus: 'CHARGED',
      cost: new Prisma.Decimal('0.20'),
      connectedDuration: 150,
    });

    wl = {
      id: llp.id,
      ownerId,
      acme: acme.id,
      zen: zen.id,
      alpha: alpha.id,
      beta: beta.id,
      acmeUser: await user(llp.id, RoleName.BUYER, 'acme', { buyerId: acme.id }),
      zenUser: await user(llp.id, RoleName.BUYER, 'zen', { buyerId: zen.id }),
      alphaUser: await user(llp.id, RoleName.PUBLISHER, 'alpha', { publisherId: alpha.id }),
      betaUser: await user(llp.id, RoleName.PUBLISHER, 'beta', { publisherId: beta.id }),
      agentId,
      julyCall: july.id,
    };
    child = { id: childTenant.id, ownerId: await user(childTenant.id, RoleName.OWNER, 'child') };
    sibling = {
      id: siblingTenant.id,
      ownerId: await user(siblingTenant.id, RoleName.OWNER, 'sibling'),
    };
    other = {
      id: ridge.id,
      ownerId: await user(ridge.id, RoleName.OWNER, 'ridge'),
      buyer: ridgeBuyer.id,
    };

    const operator = await prisma.user.create({
      data: { email: `operator-${stamp}@platform.test`, status: 'ACTIVE', tenantId: null },
    });
    operatorId = operator.id;
    await grantPlatformAdmin(operatorId, { note: 'statements suite fixture' });
  });

  /* ── One money definition ─────────────────────────────────────────────── */

  it('gives one month the same revenue, payout, profit and billable counts on every screen', async () => {
    const sales = await getCallSalesSummary(wl.id, resolvePeriod('THIS_MONTH'), { prisma });
    const t = sales.totals;
    expect(t).toMatchObject({
      inboundCalls: 5,
      billable: 3,
      billableToBuyers: 2,
      billableAgentAnswered: 1,
      revenue: 90,
      publisherPayouts: 45,
      profit: 43.65,
    });

    const profitability = (
      await get(wl.ownerId, wl.id, '/api/v1/reports/campaign-profitability?period=THIS_MONTH')
    ).json().totals;
    expect(Number(profitability.buyerRevenue)).toBe(t.revenue);
    expect(Number(profitability.publisherPayout)).toBe(t.publisherPayouts);
    expect(Number(profitability.profit)).toBe(t.profit);
    expect(profitability.billableCalls).toBe(t.billable);

    const buyerCosts = (
      await get(wl.ownerId, wl.id, '/api/v1/reports/buyer-costs?period=THIS_MONTH')
    ).json();
    expect(Number(buyerCosts.totals.buyerCost)).toBe(t.revenue);
    expect(buyerCosts.totals.billableCalls).toBe(t.billableToBuyers);
    // Only calls a buyer took: no "Unknown Buyer" row.
    expect(buyerCosts.rows.map((r: any) => r.buyerName).sort()).toEqual([
      'Acme Senior',
      'Zen Health',
    ]);

    const publisherRevenue = (
      await get(wl.ownerId, wl.id, '/api/v1/reports/publisher-revenue?period=THIS_MONTH')
    ).json().totals;
    expect(Number(publisherRevenue.earnings)).toBe(t.publisherPayouts);
    expect(publisherRevenue.billableCalls).toBe(t.billable);

    const today = await getWhiteLabelToday(wl.id, {
      prisma,
      readStatuses: () => Promise.resolve(new Map()),
    });
    expect(today.today.revenue).toBe(t.revenue);
    expect(today.today.profit).toBe(t.profit);
    expect(today.today.inbound).toBe(t.inboundCalls);

    const agency = await renderStatement(
      prisma,
      { tenantId: wl.id, partyType: 'AGENCY', partyId: wl.id },
      currentMonth()
    );
    if (agency.data.partyType !== 'AGENCY') throw new Error('not an agency statement');
    expect(agency.data.totals).toMatchObject({
      revenue: t.revenue,
      publisherPayouts: t.publisherPayouts,
      profit: t.profit,
      billable: t.billable,
      billableToBuyers: t.billableToBuyers,
      billableAgentAnswered: t.billableAgentAnswered,
      inboundCalls: t.inboundCalls,
    });
  });

  it('reads the report period as call-sales does and refuses one it does not know', async () => {
    expect(
      (await get(wl.ownerId, wl.id, '/api/v1/reports/buyer-costs?period=FOREVER')).statusCode
    ).toBe(400);
    const july = (
      await get(
        wl.ownerId,
        wl.id,
        '/api/v1/reports/campaign-profitability?period=CUSTOM&from=2026-07-01&to=2026-07-31'
      )
    ).json().totals;
    expect(Number(july.buyerRevenue)).toBe(30);
  });

  /* ── Closing a month ──────────────────────────────────────────────────── */

  it('closes a month once, and leaves it alone on a second run', async () => {
    const first = await closeMonth(prisma, '2026-07', { tenantIds: [wl.id] });
    // The agency, two buyers, two publishers, two child agencies.
    expect(first).toMatchObject({ written: 7, skipped: 0, errors: [] });

    const stored = await prisma.statement.findMany({
      where: { tenantId: wl.id, month: '2026-07' },
    });
    expect(stored).toHaveLength(7);

    const second = await closeMonth(prisma, '2026-07', { tenantIds: [wl.id] });
    expect(second).toMatchObject({ written: 0, skipped: 7 });

    const rebuilt = await closeMonth(prisma, '2026-07', { tenantIds: [wl.id], rebuild: true });
    expect(rebuilt).toMatchObject({ written: 7, skipped: 0 });
    expect(await prisma.statement.count({ where: { tenantId: wl.id, month: '2026-07' } })).toBe(7);
  });

  it('refuses to close a month that has not ended', async () => {
    await expect(closeMonth(prisma, currentMonth(), { tenantIds: [wl.id] })).rejects.toThrow(
      /has not ended/
    );
  });

  it('puts a return accepted after the month closed on the next statement, not the closed one', async () => {
    await closeMonth(prisma, '2026-07', { tenantIds: [wl.id] });
    const julyBefore = await prisma.statement.findFirstOrThrow({
      where: { tenantId: wl.id, partyType: 'BUYER', partyId: wl.acme, month: '2026-07' },
    });
    expect((julyBefore.totals as any).totals).toMatchObject({
      billableCalls: 1,
      amountBilled: 30,
      returnsAccepted: 0,
      amountDue: 30,
    });

    // Acme asks for the July call back, and the owner accepts it this month.
    await prisma.call.update({
      where: { id: wl.julyCall },
      data: {
        disputeStatus: 'DISPUTED',
        metadata: { disputeReason: 'wrong state', disputedAt: new Date().toISOString() },
      },
    });
    const decision = await app.inject({
      method: 'POST',
      url: `/api/v1/returns/${wl.julyCall}/decision`,
      headers: {
        authorization: `Bearer ${app.jwt.sign({ userId: wl.ownerId, tenantId: wl.id, email: 'o@test.local' })}`,
      },
      payload: { decision: 'ACCEPT', note: 'Out of state' },
    });
    expect(decision.statusCode, decision.body).toBe(200);

    // July is closed: its statement is exactly what it was.
    await closeMonth(prisma, '2026-07', { tenantIds: [wl.id] });
    const julyAfter = await prisma.statement.findFirstOrThrow({
      where: { tenantId: wl.id, partyType: 'BUYER', partyId: wl.acme, month: '2026-07' },
    });
    expect(julyAfter.html).toBe(julyBefore.html);
    expect(julyAfter.totals).toEqual(julyBefore.totals);
    expect(julyAfter.createdAt).toEqual(julyBefore.createdAt);

    // This month carries it, as a line of its own.
    const running = await renderStatement(
      prisma,
      { tenantId: wl.id, partyType: 'BUYER', partyId: wl.acme },
      currentMonth()
    );
    if (running.data.partyType !== 'BUYER') throw new Error('not a buyer statement');
    expect(running.data.lateReturns).toEqual([
      expect.objectContaining({ label: 'Return accepted for a call in July 2026', amount: 30 }),
    ]);
    expect(running.data.totals.returnsAccepted).toBe(1);
    expect(running.data.totals.amountDue).toBe(50 - 30);
    expect(running.html).toContain('Return accepted for a call in July 2026');

    const csv = await get(
      wl.acmeUser,
      wl.id,
      `/api/v1/statements/current.csv?partyType=BUYER&partyId=${wl.acme}`
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('Return accepted for a call in July 2026');

    // A rebuilt July still bills the call: on the day July closed, it was billed.
    await closeMonth(prisma, '2026-07', { tenantIds: [wl.id], rebuild: true });
    const julyRebuilt = await prisma.statement.findFirstOrThrow({
      where: { tenantId: wl.id, partyType: 'BUYER', partyId: wl.acme, month: '2026-07' },
    });
    expect((julyRebuilt.totals as any).totals).toMatchObject({
      amountBilled: 30,
      returnsAccepted: 0,
    });
  });

  /* ── The UPFRONT wallet ───────────────────────────────────────────────── */

  it("reconciles an UPFRONT buyer's wallet: opening + credits − debits = closing", async () => {
    const statement = await renderStatement(
      prisma,
      { tenantId: wl.id, partyType: 'BUYER', partyId: wl.zen },
      currentMonth()
    );
    if (statement.data.partyType !== 'BUYER') throw new Error('not a buyer statement');
    expect(statement.data.wallet).toEqual({
      opening: 0,
      topUps: 100,
      refunds: 0,
      callCharges: 40,
      closing: 60,
    });
  });

  it('refuses a statement whose wallet does not reconcile, and the close reports it', async () => {
    await prisma.buyer.update({
      where: { id: wl.zen },
      data: { walletBalance: new Prisma.Decimal('75') },
    });
    const live = await get(
      wl.zenUser,
      wl.id,
      `/api/v1/statements/current.csv?partyType=BUYER&partyId=${wl.zen}`
    );
    expect(live.statusCode).toBe(409);
    expect(live.json().error.code).toBe('STATEMENT_DOES_NOT_RECONCILE');

    // A July debit written with the wrong sign: the month cannot add up.
    await prisma.buyerTransaction.create({
      data: {
        buyerId: wl.zen,
        amount: new Prisma.Decimal('5'),
        type: 'DEBIT',
        description: 'bad row',
        createdAt: JULY,
      },
    });
    const result = await closeMonth(prisma, '2026-07', { tenantIds: [wl.id] });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].party).toMatchObject({ partyType: 'BUYER', partyId: wl.zen });
    expect(result.errors[0].message).toMatch(/does not reconcile/);
    // Everybody else's statement was still written.
    expect(result.written).toBe(6);
  });

  /* ── Rendering ────────────────────────────────────────────────────────── */

  it("renders each party's PDF and CSV", { timeout: 120_000 }, async () => {
    const parties: Array<[string, string, string]> = [
      ['BUYER', wl.acme, 'Caller'],
      ['PUBLISHER', wl.alpha, 'Payout'],
      ['AGENCY', wl.id, 'Revenue by buyer'],
      ['CHILD_AGENCY', child.id, 'Calls taken'],
    ];
    for (const [partyType, partyId, csvWord] of parties) {
      const query = `partyType=${partyType}&partyId=${partyId}`;
      const csv = await get(operatorId, null, `/api/v1/statements/current.csv?${query}`);
      expect(csv.statusCode, `${partyType} csv: ${csv.body}`).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.body).toContain(csvWord);

      const pdf = await get(operatorId, null, `/api/v1/statements/current.pdf?${query}`);
      expect(pdf.statusCode, `${partyType} pdf`).toBe(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
      expect(String(pdf.headers['content-disposition'])).toMatch(/statement-.*-to-date\.pdf/);
    }
  });

  it('shows the caller as the last four digits only', async () => {
    const csv = await get(
      wl.acmeUser,
      wl.id,
      `/api/v1/statements/current.csv?partyType=BUYER&partyId=${wl.acme}`
    );
    expect(csv.body).toContain('…0142');
    expect(csv.body).not.toContain('5125550142');
  });

  it('lists the closed months newest first, under "Month to date"', async () => {
    await closeMonth(prisma, '2026-06', { tenantIds: [wl.id] });
    await closeMonth(prisma, '2026-07', { tenantIds: [wl.id] });
    const list = await get(wl.acmeUser, wl.id, '/api/v1/statements');
    expect(list.statusCode).toBe(200);
    const months = list.json().data.months.map((m: any) => m.month);
    expect(months).toEqual(['current', '2026-07', '2026-06']);
    expect(list.json().data.party).toMatchObject({ partyType: 'BUYER', partyId: wl.acme });

    const stored = await get(
      wl.acmeUser,
      wl.id,
      `/api/v1/statements/2026-07.csv?partyType=BUYER&partyId=${wl.acme}`
    );
    expect(stored.statusCode).toBe(200);
    // A month nobody closed is not made up on the spot.
    expect(
      (
        await get(
          wl.acmeUser,
          wl.id,
          `/api/v1/statements/2026-05.csv?partyType=BUYER&partyId=${wl.acme}`
        )
      ).statusCode
    ).toBe(404);
  });

  /* ── Access ───────────────────────────────────────────────────────────── */

  it('lets each party read exactly the statements the rules allow', async () => {
    const may = async (
      userId: string,
      tenantId: string | null,
      partyType: string,
      partyId: string
    ) =>
      (await get(userId, tenantId, `/api/v1/statements?partyType=${partyType}&partyId=${partyId}`))
        .statusCode;

    // A buyer: their own only.
    expect(await may(wl.acmeUser, wl.id, 'BUYER', wl.acme)).toBe(200);
    expect(await may(wl.acmeUser, wl.id, 'BUYER', wl.zen)).toBe(404);
    expect(await may(wl.acmeUser, wl.id, 'AGENCY', wl.id)).toBe(404);
    expect(await may(wl.acmeUser, wl.id, 'PUBLISHER', wl.alpha)).toBe(404);

    // A publisher: their own only.
    expect(await may(wl.alphaUser, wl.id, 'PUBLISHER', wl.alpha)).toBe(200);
    expect(await may(wl.alphaUser, wl.id, 'PUBLISHER', wl.beta)).toBe(404);
    expect(await may(wl.alphaUser, wl.id, 'BUYER', wl.acme)).toBe(404);

    // The owner: the agency, its buyers and publishers, and its children.
    for (const [type, id] of [
      ['AGENCY', wl.id],
      ['BUYER', wl.acme],
      ['BUYER', wl.zen],
      ['PUBLISHER', wl.beta],
      ['CHILD_AGENCY', child.id],
      ['CHILD_AGENCY', sibling.id],
    ] as const) {
      expect(await may(wl.ownerId, wl.id, type, id), `${type} ${id}`).toBe(200);
    }
    // ...and nobody else's.
    expect(await may(wl.ownerId, wl.id, 'BUYER', other.buyer)).toBe(404);
    expect(await may(wl.ownerId, wl.id, 'AGENCY', other.id)).toBe(404);

    // An agent is not an owner.
    expect(await may(wl.agentId, wl.id, 'AGENCY', wl.id)).toBe(404);

    // A child agency's owner: its own CHILD_AGENCY statement, not its sibling's or the parent's.
    expect(await may(child.ownerId, child.id, 'CHILD_AGENCY', child.id)).toBe(200);
    expect(await may(child.ownerId, child.id, 'CHILD_AGENCY', sibling.id)).toBe(404);
    expect(await may(child.ownerId, child.id, 'AGENCY', wl.id)).toBe(404);

    // Another agency's owner sees none of it.
    expect(await may(other.ownerId, other.id, 'AGENCY', wl.id)).toBe(404);
    expect(await may(other.ownerId, other.id, 'BUYER', wl.acme)).toBe(404);
    expect(await may(other.ownerId, other.id, 'CHILD_AGENCY', child.id)).toBe(404);

    // A platform admin, everything.
    for (const [type, id] of [
      ['AGENCY', wl.id],
      ['AGENCY', other.id],
      ['BUYER', wl.acme],
      ['PUBLISHER', wl.alpha],
      ['CHILD_AGENCY', child.id],
    ] as const) {
      expect(await may(operatorId, null, type, id), `${type} ${id}`).toBe(200);
    }

    // The files obey the same rules.
    expect(
      (
        await get(
          wl.acmeUser,
          wl.id,
          `/api/v1/statements/current.csv?partyType=BUYER&partyId=${wl.zen}`
        )
      ).statusCode
    ).toBe(404);
  });

  /* ── Brand ────────────────────────────────────────────────────────────── */

  it("never says NetEnroll on a branded agency's statements", async () => {
    for (const [partyType, partyId] of [
      ['BUYER', wl.acme],
      ['BUYER', wl.zen],
      ['PUBLISHER', wl.alpha],
      ['AGENCY', wl.id],
      ['CHILD_AGENCY', child.id],
    ] as const) {
      const statement = await renderStatement(
        prisma,
        { tenantId: wl.id, partyType, partyId },
        currentMonth()
      );
      expect(statement.html, `${partyType}`).toContain('Life Leads Plus');
      expect(statement.html, `${partyType}`).not.toMatch(/netenroll/i);
      expect(statement.html).toContain('lifeleadsplus.test');
    }
  });
});
