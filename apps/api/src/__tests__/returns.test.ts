/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { CallDirection, CallStatus, Prisma, RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';
import { registerStaffOnly } from '../middleware/staff-only.js';
import { buyerBillingService } from '../services/buyer-billing-service.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Returns, end to end against a real database.
 *
 * A white-label agency with an UPFRONT (prepaid) buyer and a TERMS buyer, and
 * a normal agency beside it with a disputed call of its own. Each open return
 * is shaped for one branch of the decision: a charged prepaid call (refund), a
 * call whose publisher was already paid (payout stands, flagged), a held
 * payout (denied, payable again).
 *
 *   GET  /api/v1/returns                   OPEN by default, openCount, filters, callId
 *   POST /api/v1/returns/:callId/decision  money, wallet, audit, 409, 404, 403
 *   and afterwards, the dispute reads as closed on Payouts and Sales.
 */

const gate = databaseGate();
announceSkip('Returns', gate);

const TEST_JWT_SECRET = 'returns-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Returns suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `returns suite cannot run: ${gate.reason}`).toBe(true);
  });
});

/** 11:00 New York on 10 September 2026, clear of either midnight. */
const DAY1 = new Date('2026-09-10T15:00:00Z');
const DAY2 = new Date('2026-09-11T15:00:00Z');
const PERIOD = 'period=CUSTOM&from=2026-09-10&to=2026-09-11';

describe.skipIf(!gate.available)('Returns', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let seq = 0;

  let wl: {
    id: string;
    ownerId: string;
    ownerEmail: string;
    agentId: string;
    publisherId: string;
    upfrontBuyerId: string;
    termsBuyerId: string;
  };
  let normal: { id: string; ownerId: string };
  /** The fixture calls, by what each is for. */
  let calls: {
    charged: string;
    paid: string;
    held: string;
    accepted: string;
    denied: string;
    undisputed: string;
    foreign: string;
  };

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);
    registerStaffOnly(instance);

    const { registerReturnRoutes } = await import('../routes/returns.js');
    const { registerPayoutRoutes } = await import('../routes/payouts.js');
    const { registerCallSalesRoutes } = await import('../routes/call-sales.js');
    await instance.register(registerReturnRoutes);
    await instance.register(registerPayoutRoutes);
    await instance.register(registerCallSalesRoutes);

    await instance.ready();
    return instance;
  }

  function tokenFor(userId: string, tenantId: string): Record<string, string> {
    return {
      authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${userId}@test.local` })}`,
    };
  }

  function get(userId: string, tenantId: string, url: string) {
    return app.inject({ method: 'GET', url, headers: tokenFor(userId, tenantId) });
  }

  function decide(userId: string, tenantId: string, callId: string, payload: unknown) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/returns/${callId}/decision`,
      headers: tokenFor(userId, tenantId),
      payload: payload as Record<string, unknown>,
    });
  }

  async function call(
    tenantId: string,
    data: Partial<Prisma.CallUncheckedCreateInput> & { createdAt: Date }
  ) {
    const row = await prisma.call.create({
      data: {
        tenantId,
        toNumber: '+15550000000',
        callSid: `returns-call-${++seq}-${Date.now()}`,
        status: CallStatus.COMPLETED,
        direction: CallDirection.INBOUND,
        ...data,
      },
    });
    return row.id;
  }

  const disputeMeta = (reason: string) => ({
    disputeReason: reason,
    disputedAt: '2026-09-12T14:00:00.000Z',
    disputedBy: 'buyer@acme.test',
  });

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    prisma = getPrismaClient();
    for (const table of ['audit_logs', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }

    const roleIds: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.ADMIN, RoleName.AGENT]) {
      roleIds[name] = (
        await prisma.role.create({ data: { name, description: `${name} role`, permissions: [] } })
      ).id;
    }

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    async function user(tenantId: string, role: RoleName, label: string) {
      return prisma.user.create({
        data: {
          tenantId,
          email: `${label}-${stamp}@agency.local`,
          status: 'ACTIVE',
          roles: { create: { roleId: roleIds[role] } },
        },
      });
    }

    const llp = await prisma.tenant.create({
      data: { name: 'Life Leads Plus', slug: `llp-${stamp}`, status: 'ACTIVE', whiteLabel: true },
    });
    const owner = await user(llp.id, RoleName.OWNER, 'wl-owner');
    const publisher = await prisma.publisher.create({
      data: { tenantId: llp.id, name: 'Alpha Media', code: `pub-${++seq}` },
    });
    const upfront = await prisma.buyer.create({
      data: {
        tenantId: llp.id,
        name: 'Acme Senior',
        code: `buy-${++seq}`,
        billingType: 'UPFRONT',
        walletBalance: new Prisma.Decimal('100.00'),
      },
    });
    const terms = await prisma.buyer.create({
      data: { tenantId: llp.id, name: 'Zen Health', code: `buy-${++seq}`, billingType: 'TERMS' },
    });
    wl = {
      id: llp.id,
      ownerId: owner.id,
      ownerEmail: owner.email,
      agentId: (await user(llp.id, RoleName.AGENT, 'wl-agent')).id,
      publisherId: publisher.id,
      upfrontBuyerId: upfront.id,
      termsBuyerId: terms.id,
    };

    const ridge = await prisma.tenant.create({
      data: { name: 'Ridgeline', slug: `ridge-${stamp}`, status: 'ACTIVE' },
    });
    normal = { id: ridge.id, ownerId: (await user(ridge.id, RoleName.OWNER, 'ridge-owner')).id };

    calls = {
      // A prepaid buyer's wallet was charged $40; the publisher's $15 is held.
      charged: await call(wl.id, {
        createdAt: DAY1,
        startedAt: DAY1,
        callerId: '+15125550101',
        connectedDuration: 184,
        campaignName: 'Final Expense',
        publisherId: wl.publisherId,
        buyerId: wl.upfrontBuyerId,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('40'),
        revenue: new Prisma.Decimal('40'),
        publisherPayoutAmount: new Prisma.Decimal('15'),
        payout: new Prisma.Decimal('15'),
        profit: new Prisma.Decimal('24.5'),
        cost: new Prisma.Decimal('0.5'),
        publisherPayoutStatus: 'HELD',
        buyerChargeStatus: 'CHARGED',
        primaryRecordingId: 'rec-charged',
        disputeStatus: 'DISPUTED',
        metadata: disputeMeta('Caller was out of state'),
      }),
      // The publisher was already paid $20 for this one.
      paid: await call(wl.id, {
        createdAt: DAY1,
        publisherId: wl.publisherId,
        buyerId: wl.termsBuyerId,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('50'),
        revenue: new Prisma.Decimal('50'),
        publisherPayoutAmount: new Prisma.Decimal('20'),
        payout: new Prisma.Decimal('20'),
        cost: new Prisma.Decimal('0.25'),
        publisherPayoutStatus: 'PAID',
        buyerChargeStatus: 'INVOICED',
        disputeStatus: 'DISPUTED',
        metadata: disputeMeta('Duplicate caller'),
      }),
      // Held for the dispute; denying it makes the $10 payable again.
      held: await call(wl.id, {
        createdAt: DAY2,
        publisherId: wl.publisherId,
        buyerId: wl.termsBuyerId,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('30'),
        revenue: new Prisma.Decimal('30'),
        publisherPayoutAmount: new Prisma.Decimal('10'),
        payout: new Prisma.Decimal('10'),
        publisherPayoutStatus: 'HELD',
        disputeStatus: 'DISPUTED',
        metadata: disputeMeta('Hung up at once'),
      }),
      accepted: await call(wl.id, {
        createdAt: DAY1,
        buyerId: wl.termsBuyerId,
        disputeStatus: 'ACCEPTED',
        metadata: { ...disputeMeta('Old'), disputeDecision: 'ACCEPT', decidedBy: 'x@y.test' },
      }),
      denied: await call(wl.id, {
        createdAt: DAY1,
        buyerId: wl.termsBuyerId,
        disputeStatus: 'DENIED',
        metadata: { ...disputeMeta('Older'), disputeDecision: 'DENY' },
      }),
      undisputed: await call(wl.id, { createdAt: DAY1, buyerId: wl.termsBuyerId }),
      foreign: await call(normal.id, { createdAt: DAY1, disputeStatus: 'DISPUTED' }),
    };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // The list
  // ══════════════════════════════════════════════════════════════════════════
  describe('GET /api/v1/returns', () => {
    it('lists the OPEN returns by default, with openCount, in this tenant only', async () => {
      const response = await get(wl.ownerId, wl.id, '/api/v1/returns');
      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.data.map((row: any) => row.callId).sort()).toEqual(
        [calls.charged, calls.paid, calls.held].sort()
      );
      expect(body.meta).toEqual({ page: 1, limit: 50, total: 3, totalPages: 1, openCount: 3 });
      expect(response.body).not.toContain(calls.foreign);
    });

    it('answers the documented row shape', async () => {
      const data = (await get(wl.ownerId, wl.id, '/api/v1/returns')).json().data;
      const row = data.find((r: any) => r.callId === calls.charged);
      expect(row).toEqual({
        callId: calls.charged,
        startedAt: DAY1.toISOString(),
        status: 'OPEN',
        buyer: { id: wl.upfrontBuyerId, name: 'Acme Senior' },
        publisher: { id: wl.publisherId, name: 'Alpha Media' },
        campaignName: 'Final Expense',
        callerId: '+15125550101',
        connectedDuration: 184,
        buyerBillableAmount: 40,
        publisherPayoutAmount: 15,
        publisherPayoutStatus: 'HELD',
        buyerChargeStatus: 'CHARGED',
        buyerBillingType: 'UPFRONT',
        reason: 'Caller was out of state',
        disputedAt: '2026-09-12T14:00:00.000Z',
        disputedBy: 'buyer@acme.test',
        recordingId: 'rec-charged',
        decision: null,
        returnAfterPublisherPaid: false,
      });
    });

    it('filters ACCEPTED and DENIED, keeps openCount, and refuses an unknown status', async () => {
      const accepted = (await get(wl.ownerId, wl.id, '/api/v1/returns?status=ACCEPTED')).json();
      expect(accepted.data.map((r: any) => r.callId)).toEqual([calls.accepted]);
      expect(accepted.data[0]).toMatchObject({
        status: 'ACCEPTED',
        decision: { decision: 'ACCEPT', decidedBy: 'x@y.test' },
      });
      expect(accepted.meta.openCount).toBe(3);

      const denied = (await get(wl.ownerId, wl.id, '/api/v1/returns?status=DENIED')).json();
      expect(denied.data.map((r: any) => r.callId)).toEqual([calls.denied]);

      expect((await get(wl.ownerId, wl.id, '/api/v1/returns?status=BOGUS')).statusCode).toBe(400);
    });

    it('filters on the call date, a bare day covering all of it', async () => {
      const day1 = (await get(wl.ownerId, wl.id, '/api/v1/returns?from=2026-09-10&to=2026-09-10'))
        .json()
        .data.map((r: any) => r.callId)
        .sort();
      expect(day1).toEqual([calls.charged, calls.paid].sort());

      const day2 = (await get(wl.ownerId, wl.id, '/api/v1/returns?from=2026-09-11')).json().data;
      expect(day2.map((r: any) => r.callId)).toEqual([calls.held]);

      expect((await get(wl.ownerId, wl.id, '/api/v1/returns?from=yesterday')).statusCode).toBe(400);
    });

    it("answers one call's return by callId, in any state, and nothing for anything else", async () => {
      const decided = (
        await get(wl.ownerId, wl.id, `/api/v1/returns?callId=${calls.accepted}`)
      ).json();
      expect(decided.data).toHaveLength(1);
      expect(decided.data[0]).toMatchObject({ callId: calls.accepted, status: 'ACCEPTED' });
      expect(decided.meta.openCount).toBe(3);

      const open = (
        await get(wl.ownerId, wl.id, `/api/v1/returns?status=DENIED&callId=${calls.charged}`)
      ).json();
      expect(open.data.map((r: any) => r.callId)).toEqual([calls.charged]);

      for (const id of [calls.undisputed, calls.foreign]) {
        const none = await get(wl.ownerId, wl.id, `/api/v1/returns?callId=${id}`);
        expect(none.statusCode).toBe(200);
        expect(none.json().data).toEqual([]);
      }
    });

    it('refuses a normal agency owner and a white-label agent', async () => {
      expect((await get(normal.ownerId, normal.id, '/api/v1/returns')).statusCode).toBe(403);
      expect((await get(wl.agentId, wl.id, '/api/v1/returns')).statusCode).toBe(403);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // The decision
  // ══════════════════════════════════════════════════════════════════════════
  describe('POST /api/v1/returns/:callId/decision', () => {
    it('ACCEPT on a charged prepaid call refunds the wallet inside the same transaction and zeroes the money', async () => {
      const spy = vi.spyOn(buyerBillingService, 'addCredits');

      const response = await decide(wl.ownerId, wl.id, calls.charged, {
        decision: 'ACCEPT',
        note: 'Agreed, out of state',
      });
      expect(response.statusCode, response.body).toBe(200);

      // Credited once, with the ORIGINAL amount, through a transaction client
      // rather than the base client -- i.e. inside the decision's transaction.
      expect(spy).toHaveBeenCalledTimes(1);
      const args = spy.mock.calls[0];
      expect(args[0]).toBe(wl.upfrontBuyerId);
      expect(args[1]).toBe(40);
      expect(args[3]).toBe(`Return accepted for call ${calls.charged}`);
      expect(args[4]).toBeDefined();
      expect(args[4]).not.toBe(prisma);

      const buyer = await prisma.buyer.findUniqueOrThrow({ where: { id: wl.upfrontBuyerId } });
      expect(buyer.walletBalance.toFixed(2)).toBe('140.00');
      const credit = await prisma.buyerTransaction.findFirstOrThrow({
        where: { buyerId: wl.upfrontBuyerId, type: 'CREDIT' },
      });
      expect(credit.amount.toFixed(2)).toBe('40.00');
      expect(credit.description).toBe(`Return accepted for call ${calls.charged}`);

      const after = await prisma.call.findUniqueOrThrow({ where: { id: calls.charged } });
      expect(after).toMatchObject({
        disputeStatus: 'ACCEPTED',
        billable: false,
        publisherPayoutStatus: 'NOT_PAYABLE',
        buyerChargeStatus: 'REFUNDED',
      });
      expect(after.revenue?.toFixed(2)).toBe('0.00');
      expect(after.buyerBillableAmount?.toFixed(2)).toBe('0.00');
      expect(after.payout?.toFixed(2)).toBe('0.00');
      expect(after.publisherPayoutAmount?.toFixed(2)).toBe('0.00');
      expect(after.profit?.toFixed(2)).toBe('-0.50');
      expect(after.metadata).toMatchObject({
        disputeReason: 'Caller was out of state',
        disputeDecision: 'ACCEPT',
        decidedBy: wl.ownerEmail,
        decisionNote: 'Agreed, out of state',
      });

      const row = response.json().data;
      expect(row).toMatchObject({
        callId: calls.charged,
        status: 'ACCEPTED',
        buyerBillableAmount: 0,
        publisherPayoutAmount: 0,
        publisherPayoutStatus: 'NOT_PAYABLE',
        buyerChargeStatus: 'REFUNDED',
        decision: { decision: 'ACCEPT', decidedBy: wl.ownerEmail, note: 'Agreed, out of state' },
        returnAfterPublisherPaid: false,
      });
      expect(Number.isNaN(Date.parse(row.decision.decidedAt))).toBe(false);
    });

    it('ACCEPT after the publisher was paid leaves the payout and flags the call', async () => {
      const response = await decide(wl.ownerId, wl.id, calls.paid, { decision: 'ACCEPT' });
      expect(response.statusCode, response.body).toBe(200);

      const after = await prisma.call.findUniqueOrThrow({ where: { id: calls.paid } });
      expect(after.publisherPayoutStatus).toBe('PAID');
      expect(after.publisherPayoutAmount?.toFixed(2)).toBe('20.00');
      expect(after.payout?.toFixed(2)).toBe('20.00');
      expect(after.revenue?.toFixed(2)).toBe('0.00');
      expect(after.profit?.toFixed(2)).toBe('-20.25');
      // A TERMS buyer's charge is waived, not refunded to a wallet.
      expect(after.buyerChargeStatus).toBe('WAIVED');
      expect(after.metadata).toMatchObject({ returnAfterPublisherPaid: true, decisionNote: null });
      expect(response.json().data).toMatchObject({
        returnAfterPublisherPaid: true,
        publisherPayoutAmount: 20,
      });
      expect(await prisma.buyerTransaction.count()).toBe(0);
    });

    it('DENY puts a held payout back to payable and leaves the money', async () => {
      const response = await decide(wl.ownerId, wl.id, calls.held, { decision: 'DENY' });
      expect(response.statusCode, response.body).toBe(200);

      const after = await prisma.call.findUniqueOrThrow({ where: { id: calls.held } });
      expect(after).toMatchObject({
        disputeStatus: 'DENIED',
        publisherPayoutStatus: 'PAYABLE',
        billable: true,
      });
      expect(after.revenue?.toFixed(2)).toBe('30.00');
      expect(after.publisherPayoutAmount?.toFixed(2)).toBe('10.00');
      expect(response.json().data).toMatchObject({
        status: 'DENIED',
        decision: { decision: 'DENY' },
      });
    });

    it('refuses a second decision with 409, and changes nothing more', async () => {
      expect(
        (await decide(wl.ownerId, wl.id, calls.charged, { decision: 'ACCEPT' })).statusCode
      ).toBe(200);
      const again = await decide(wl.ownerId, wl.id, calls.charged, { decision: 'DENY' });
      expect(again.statusCode).toBe(409);

      const buyer = await prisma.buyer.findUniqueOrThrow({ where: { id: wl.upfrontBuyerId } });
      expect(buyer.walletBalance.toFixed(2)).toBe('140.00');
      expect(
        (await prisma.call.findUniqueOrThrow({ where: { id: calls.charged } })).disputeStatus
      ).toBe('ACCEPTED');
    });

    it('lets exactly one of two concurrent decisions win', async () => {
      const [first, second] = await Promise.all([
        decide(wl.ownerId, wl.id, calls.charged, { decision: 'ACCEPT' }),
        decide(wl.ownerId, wl.id, calls.charged, { decision: 'ACCEPT' }),
      ]);
      expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
      expect(await prisma.buyerTransaction.count({ where: { type: 'CREDIT' } })).toBe(1);
      const buyer = await prisma.buyer.findUniqueOrThrow({ where: { id: wl.upfrontBuyerId } });
      expect(buyer.walletBalance.toFixed(2)).toBe('140.00');
    });

    it('refuses a call that has no open return with 409', async () => {
      for (const id of [calls.undisputed, calls.denied]) {
        expect((await decide(wl.ownerId, wl.id, id, { decision: 'DENY' })).statusCode).toBe(409);
      }
    });

    it("answers 404 for another tenant's call, and for one that does not exist", async () => {
      expect(
        (await decide(wl.ownerId, wl.id, calls.foreign, { decision: 'ACCEPT' })).statusCode
      ).toBe(404);
      expect(
        (
          await decide(wl.ownerId, wl.id, '00000000-0000-0000-0000-000000000000', {
            decision: 'ACCEPT',
          })
        ).statusCode
      ).toBe(404);
      expect(
        (await prisma.call.findUniqueOrThrow({ where: { id: calls.foreign } })).disputeStatus
      ).toBe('DISPUTED');
    });

    it('refuses a normal agency owner and a white-label agent with 403', async () => {
      expect(
        (await decide(normal.ownerId, normal.id, calls.foreign, { decision: 'ACCEPT' })).statusCode
      ).toBe(403);
      expect((await decide(wl.agentId, wl.id, calls.held, { decision: 'DENY' })).statusCode).toBe(
        403
      );
      expect(
        (await prisma.call.findUniqueOrThrow({ where: { id: calls.held } })).disputeStatus
      ).toBe('DISPUTED');
    });

    it('refuses a bad body with 400', async () => {
      for (const payload of [
        {},
        { decision: 'MAYBE' },
        { decision: 'ACCEPT', note: 'x'.repeat(501) },
        { decision: 'DENY', note: 42 },
      ]) {
        expect((await decide(wl.ownerId, wl.id, calls.held, payload)).statusCode).toBe(400);
      }
    });

    it('writes an audit row with the money before and after', async () => {
      await decide(wl.ownerId, wl.id, calls.charged, { decision: 'ACCEPT' });
      await decide(wl.ownerId, wl.id, calls.held, { decision: 'DENY', note: 'Stands' });

      const accepted = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'return.accepted' },
      });
      expect(accepted).toMatchObject({
        tenantId: wl.id,
        userId: wl.ownerId,
        entityType: 'Call',
        entityId: calls.charged,
      });
      expect(accepted.changes).toMatchObject({
        decision: 'ACCEPT',
        walletRefund: '40.00',
        before: { revenue: '40.0000', payout: '15.0000', buyerChargeStatus: 'CHARGED' },
        after: { revenue: '0.0000', payout: '0.0000', buyerChargeStatus: 'REFUNDED' },
      });

      const denied = await prisma.auditLog.findFirstOrThrow({ where: { action: 'return.denied' } });
      expect(denied).toMatchObject({ entityId: calls.held });
      expect(denied.changes).toMatchObject({
        note: 'Stands',
        before: { publisherPayoutStatus: 'HELD' },
        after: { publisherPayoutStatus: 'PAYABLE' },
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // A decided return is not an open dispute anywhere else
  // ══════════════════════════════════════════════════════════════════════════
  describe('after a decision', () => {
    it('a denied return counts as payable on Payouts and is not disputed on Sales', async () => {
      const payoutsBefore = (await get(wl.ownerId, wl.id, `/api/v1/payouts/summary?${PERIOD}`))
        .json()
        .data.publishers.find((row: any) => row.publisherId === wl.publisherId);
      // charged (15) and held (10) are held; paid (20) is paid.
      expect(payoutsBefore).toMatchObject({ payable: 0, payableCalls: 0, held: 25, paid: 20 });

      const salesBefore = (
        await get(wl.ownerId, wl.id, `/api/v1/call-sales/summary?${PERIOD}`)
      ).json().data.totals;
      expect(salesBefore.disputedCalls).toBe(3);

      expect((await decide(wl.ownerId, wl.id, calls.held, { decision: 'DENY' })).statusCode).toBe(
        200
      );

      const payoutsAfter = (await get(wl.ownerId, wl.id, `/api/v1/payouts/summary?${PERIOD}`))
        .json()
        .data.publishers.find((row: any) => row.publisherId === wl.publisherId);
      expect(payoutsAfter).toMatchObject({ payable: 10, payableCalls: 1, held: 15, paid: 20 });

      const salesAfter = (
        await get(wl.ownerId, wl.id, `/api/v1/call-sales/summary?${PERIOD}`)
      ).json().data.totals;
      expect(salesAfter.disputedCalls).toBe(2);

      // And a payment can now be recorded for it.
      const payment = await app.inject({
        method: 'POST',
        url: '/api/v1/payouts',
        headers: tokenFor(wl.ownerId, wl.id),
        payload: {
          publisherId: wl.publisherId,
          periodFrom: '2026-09-10T04:00:00.000Z',
          periodTo: '2026-09-12T03:59:59.999Z',
          method: 'ACH',
        },
      });
      expect(payment.statusCode, payment.body).toBe(201);
      expect(payment.json().data).toMatchObject({ amount: 10, calls: 1 });
    });
  });
});
