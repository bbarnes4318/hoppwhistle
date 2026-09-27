/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { CallDirection, CallStatus, Prisma, RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';
import { registerStaffOnly } from '../middleware/staff-only.js';
import { buyerBillingService } from '../services/buyer-billing-service.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The buyer portal's account state, end to end against a real database.
 *
 *   Pause reasons   the wallet pausing a buyer records WALLET_EMPTY and a
 *                   credit lifts it; an owner pausing one records MANUAL and a
 *                   credit does not.
 *   GET /api/v1/buyers/:buyerId        pauseReason, pausedBy, lowBalance
 *   POST /api/v1/buyers/:buyerId/top-up-request   emails the agency's owner,
 *                   only for the caller's own buyer
 *   A decided return keeps the call's original amount, and the buyer reads it
 *   and the owner's note on its own calls.
 */

const sendMail = vi.fn<[message: any], Promise<{ accepted: string[] }>>();
vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail }),
  default: { createTransport: () => ({ sendMail }) },
}));

const gate = databaseGate();
announceSkip('Buyer portal', gate);

const TEST_JWT_SECRET = 'buyer-portal-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Buyer portal suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `buyer portal suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Buyer portal', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let seq = 0;

  let agency: {
    id: string;
    ownerId: string;
    ownerEmail: string;
    buyerId: string;
    buyerUserId: string;
    otherBuyerId: string;
    otherBuyerUserId: string;
  };

  const SMTP_KEYS = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'APP_URL'] as const;
  const savedEnv: Record<string, string | undefined> = {};

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);
    registerStaffOnly(instance);

    const { registerBuyerBillingRoutes } = await import('../routes/buyer-billing.js');
    const { registerReturnRoutes } = await import('../routes/returns.js');
    const { registerCallRoutes } = await import('../routes/index.js');
    await instance.register(registerBuyerBillingRoutes);
    await instance.register(registerReturnRoutes);
    await instance.register(registerCallRoutes);

    await instance.ready();
    return instance;
  }

  function as(userId: string): Record<string, string> {
    return {
      authorization: `Bearer ${app.jwt.sign({ userId, tenantId: agency.id, email: `${userId}@test.local` })}`,
    };
  }

  async function call(data: Partial<Prisma.CallUncheckedCreateInput>) {
    const row = await prisma.call.create({
      data: {
        tenantId: agency.id,
        toNumber: '+15550000000',
        callSid: `buyer-portal-call-${++seq}-${Date.now()}`,
        status: CallStatus.COMPLETED,
        direction: CallDirection.INBOUND,
        ...data,
      },
    });
    return row.id;
  }

  const buyerRow = (id: string) => prisma.buyer.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    for (const key of SMTP_KEYS) savedEnv[key] = process.env[key];
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_USER = 'mailer';
    process.env.SMTP_PASSWORD = 'secret';
    process.env.SMTP_FROM = 'noreply@netenroll.com';
    process.env.APP_URL = 'https://agents.netenroll.com';
    app = await buildApp();
  });

  afterAll(async () => {
    for (const key of SMTP_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await app?.close();
  });

  beforeEach(async () => {
    sendMail.mockReset().mockResolvedValue({ accepted: ['x'] });
    prisma = getPrismaClient();
    for (const table of ['audit_logs', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }

    const roleIds: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.BUYER]) {
      roleIds[name] = (
        await prisma.role.create({ data: { name, description: `${name} role`, permissions: [] } })
      ).id;
    }

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Ridgeline Marketing',
        slug: `ridge-${stamp}`,
        status: 'ACTIVE',
        whiteLabel: true,
        brandTheme: 'life-leads-plus',
        brandName: 'Sunrise Leads',
      },
    });
    const owner = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `owner-${stamp}@agency.local`,
        status: 'ACTIVE',
        roles: { create: { roleId: roleIds[RoleName.OWNER] } },
      },
    });

    async function buyerWithUser(name: string, label: string) {
      const buyer = await prisma.buyer.create({
        data: {
          tenantId: tenant.id,
          name,
          code: `buy-${++seq}`,
          billingType: 'UPFRONT',
          walletBalance: new Prisma.Decimal('10.00'),
        },
      });
      const user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: `${label}-${stamp}@buyer.local`,
          status: 'ACTIVE',
          buyerId: buyer.id,
          roles: { create: { roleId: roleIds[RoleName.BUYER] } },
        },
      });
      return { buyerId: buyer.id, userId: user.id };
    }

    const acme = await buyerWithUser('Acme Senior', 'acme');
    const zen = await buyerWithUser('Zen Health', 'zen');
    agency = {
      id: tenant.id,
      ownerId: owner.id,
      ownerEmail: owner.email,
      buyerId: acme.buyerId,
      buyerUserId: acme.userId,
      otherBuyerId: zen.buyerId,
      otherBuyerUserId: zen.userId,
    };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Why a buyer is paused
  // ══════════════════════════════════════════════════════════════════════════
  describe('pause reasons', () => {
    it('records WALLET_EMPTY when the wallet pauses a buyer, and a credit lifts it', async () => {
      const callId = await call({
        buyerId: agency.buyerId,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('25'),
      });

      const billed = await buyerBillingService.processCallBilling(callId);
      expect(billed.deducted).toBe(false);

      let buyer = await buyerRow(agency.buyerId);
      expect(buyer.status).toBe('PAUSED');
      expect(buyer.metadata).toMatchObject({ pauseReason: 'WALLET_EMPTY' });

      const profile = await app.inject({
        method: 'GET',
        url: `/api/v1/buyers/${agency.buyerId}`,
        headers: as(agency.buyerUserId),
      });
      expect(profile.statusCode, profile.body).toBe(200);
      expect(profile.json()).toMatchObject({
        status: 'PAUSED',
        pauseReason: 'WALLET_EMPTY',
        pausedBy: null,
      });

      const credited = await buyerBillingService.addCredits(agency.buyerId, 100, agency.ownerId);
      expect(credited.success).toBe(true);

      buyer = await buyerRow(agency.buyerId);
      expect(buyer.status).toBe('ACTIVE');
      expect((buyer.metadata as any)?.pauseReason).toBeUndefined();
    });

    it('records MANUAL when an owner pauses a buyer, and a credit does not lift it', async () => {
      const paused = await app.inject({
        method: 'PATCH',
        url: `/api/v1/buyers/${agency.buyerId}`,
        headers: as(agency.ownerId),
        payload: { status: 'PAUSED' },
      });
      expect(paused.statusCode, paused.body).toBe(200);
      expect((await buyerRow(agency.buyerId)).metadata).toMatchObject({ pauseReason: 'MANUAL' });

      await buyerBillingService.addCredits(agency.buyerId, 500, agency.ownerId);
      const buyer = await buyerRow(agency.buyerId);
      expect(buyer.status).toBe('PAUSED');
      expect(buyer.walletBalance.toFixed(2)).toBe('510.00');

      // The buyer reads who paused it by the agency's brand.
      const profile = (
        await app.inject({
          method: 'GET',
          url: `/api/v1/buyers/${agency.buyerId}`,
          headers: as(agency.buyerUserId),
        })
      ).json();
      expect(profile).toMatchObject({ pauseReason: 'MANUAL', pausedBy: 'Sunrise Leads' });

      // Resuming clears the reason.
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/buyers/${agency.buyerId}`,
        headers: as(agency.ownerId),
        payload: { status: 'ACTIVE' },
      });
      const resumed = await buyerRow(agency.buyerId);
      expect(resumed.status).toBe('ACTIVE');
      expect((resumed.metadata as any)?.pauseReason).toBeUndefined();
    });

    it('re-saving a wallet-paused buyer as PAUSED keeps it a wallet pause', async () => {
      await prisma.buyer.update({
        where: { id: agency.buyerId },
        data: { status: 'PAUSED', metadata: { pauseReason: 'WALLET_EMPTY' } },
      });
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/buyers/${agency.buyerId}`,
        headers: as(agency.ownerId),
        payload: { name: 'Acme Senior Co', status: 'PAUSED' },
      });
      expect((await buyerRow(agency.buyerId)).metadata).toMatchObject({
        pauseReason: 'WALLET_EMPTY',
      });
    });

    it('a buyer paused before reasons were recorded is resolved from its audit trail', async () => {
      await prisma.buyer.update({ where: { id: agency.buyerId }, data: { status: 'PAUSED' } });

      // Nothing on record either way: stays paused.
      await buyerBillingService.addCredits(agency.buyerId, 50, agency.ownerId);
      expect((await buyerRow(agency.buyerId)).status).toBe('PAUSED');

      // The billing service paused it: the wallet's pause, lifted by a credit.
      await prisma.auditLog.create({
        data: {
          tenantId: agency.id,
          action: 'buyer.status.autopaused',
          entityType: 'Buyer',
          entityId: agency.buyerId,
          changes: { previous: 'ACTIVE', new: 'PAUSED' },
        },
      });
      await buyerBillingService.addCredits(agency.buyerId, 50, agency.ownerId);
      expect((await buyerRow(agency.buyerId)).status).toBe('ACTIVE');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Low balance
  // ══════════════════════════════════════════════════════════════════════════
  describe('low balance', () => {
    it('warns below five calls at the average price of the last 30 days', async () => {
      for (const amount of ['20', '30']) {
        await call({
          buyerId: agency.buyerId,
          billable: true,
          buyerBillableAmount: new Prisma.Decimal(amount),
          buyerChargeStatus: 'CHARGED',
        });
      }
      // Older than the window, and another buyer's: neither counts.
      await call({
        buyerId: agency.buyerId,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('500'),
        createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
      });
      await call({
        buyerId: agency.otherBuyerId,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('500'),
      });

      await prisma.buyer.update({
        where: { id: agency.buyerId },
        data: { walletBalance: new Prisma.Decimal('100') },
      });
      const low = (
        await app.inject({
          method: 'GET',
          url: `/api/v1/buyers/${agency.buyerId}`,
          headers: as(agency.buyerUserId),
        })
      ).json();
      expect(low.lowBalance).toEqual({
        isLow: true,
        threshold: 125,
        averageCallPrice: 25,
        basis: 'RECENT_CALLS',
      });

      await prisma.buyer.update({
        where: { id: agency.buyerId },
        data: { walletBalance: new Prisma.Decimal('125') },
      });
      const ok = (
        await app.inject({
          method: 'GET',
          url: `/api/v1/buyers/${agency.buyerId}`,
          headers: as(agency.buyerUserId),
        })
      ).json();
      expect(ok.lowBalance.isLow).toBe(false);
    });

    it('falls back to the configured campaign price when there are no recent calls', async () => {
      const publisher = await prisma.publisher.create({
        data: { tenantId: agency.id, name: 'Alpha', code: `pub-${++seq}` },
      });
      const campaign = await prisma.campaign.create({
        data: {
          tenantId: agency.id,
          publisherId: publisher.id,
          name: 'Final Expense',
          buyerPricePerBillableCall: new Prisma.Decimal('40'),
        },
      });
      await prisma.campaignBuyer.create({
        data: {
          tenantId: agency.id,
          campaignId: campaign.id,
          buyerId: agency.buyerId,
          destinationNumber: '+15550001111',
        },
      });

      const profile = (
        await app.inject({
          method: 'GET',
          url: `/api/v1/buyers/${agency.buyerId}`,
          headers: as(agency.buyerUserId),
        })
      ).json();
      expect(profile.lowBalance).toEqual({
        isLow: true,
        threshold: 200,
        averageCallPrice: 40,
        basis: 'CONFIGURED_PRICE',
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Top-up request
  // ══════════════════════════════════════════════════════════════════════════
  describe('POST /api/v1/buyers/:buyerId/top-up-request', () => {
    it("emails the agency's owner the buyer's name and the amount, and audits it", async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/buyers/${agency.buyerId}/top-up-request`,
        headers: as(agency.buyerUserId),
        payload: { amount: 250 },
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json().data).toEqual({
        buyerId: agency.buyerId,
        amount: 250,
        emailedOwners: 1,
      });

      expect(sendMail).toHaveBeenCalledTimes(1);
      const message = sendMail.mock.calls[0][0];
      expect(message.to).toBe(agency.ownerEmail);
      expect(message.subject).toContain('Acme Senior');
      expect(message.subject).toContain('$250.00');
      expect(message.text).toContain('Acme Senior');
      expect(message.text).toContain('$250.00');
      // In the agency's brand, not the platform's.
      expect(message.from).toContain('Sunrise Leads');

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'buyer.topup.requested', entityId: agency.buyerId },
      });
      expect(audit).toMatchObject({ userId: agency.buyerUserId, success: true });
      expect(audit.changes).toMatchObject({ amount: '250.00', emailedOwners: 1 });

      // A second request inside the minute is refused, and sends nothing.
      const again = await app.inject({
        method: 'POST',
        url: `/api/v1/buyers/${agency.buyerId}/top-up-request`,
        headers: as(agency.buyerUserId),
        payload: { amount: 250 },
      });
      expect(again.statusCode).toBe(429);
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it("refuses a buyer asking for another buyer's account, and the owner", async () => {
      for (const userId of [agency.otherBuyerUserId, agency.ownerId]) {
        const response = await app.inject({
          method: 'POST',
          url: `/api/v1/buyers/${agency.buyerId}/top-up-request`,
          headers: as(userId),
          payload: { amount: 250 },
        });
        expect(response.statusCode).toBe(403);
      }
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('refuses an amount that is not a positive number', async () => {
      for (const amount of [0, -5, 'lots', null]) {
        const response = await app.inject({
          method: 'POST',
          url: `/api/v1/buyers/${agency.buyerId}/top-up-request`,
          headers: as(agency.buyerUserId),
          payload: { amount },
        });
        expect(response.statusCode).toBe(400);
      }
      expect(sendMail).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Decided returns, as the buyer reads them
  // ══════════════════════════════════════════════════════════════════════════
  describe('decided returns', () => {
    it('keeps the original amount on the call and shows the buyer it with the note', async () => {
      const disputed = await call({
        buyerId: agency.buyerId,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('40'),
        revenue: new Prisma.Decimal('40'),
        buyerChargeStatus: 'CHARGED',
        disputeStatus: 'DISPUTED',
        metadata: { disputeReason: 'Out of state', disputedAt: '2026-09-12T14:00:00.000Z' },
      });
      const denied = await call({
        buyerId: agency.buyerId,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('30'),
        revenue: new Prisma.Decimal('30'),
        buyerChargeStatus: 'CHARGED',
        disputeStatus: 'DISPUTED',
        metadata: { disputeReason: 'Too short' },
      });
      // Another buyer's decided return, which this buyer must not see.
      const foreign = await call({
        buyerId: agency.otherBuyerId,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('55'),
        disputeStatus: 'DISPUTED',
      });

      for (const [callId, decision, note] of [
        [disputed, 'ACCEPT', 'Agreed, caller was out of state'],
        [denied, 'DENY', 'Connected past the threshold'],
        [foreign, 'ACCEPT', 'Not yours'],
      ] as const) {
        const response = await app.inject({
          method: 'POST',
          url: `/api/v1/returns/${callId}/decision`,
          headers: as(agency.ownerId),
          payload: { decision, note },
        });
        expect(response.statusCode, response.body).toBe(200);
      }

      const accepted = await prisma.call.findUniqueOrThrow({ where: { id: disputed } });
      expect(accepted.buyerBillableAmount?.toFixed(2)).toBe('0.00');
      expect(
        new Prisma.Decimal((accepted.metadata as any).originalBuyerBillableAmount).toFixed(2)
      ).toBe('40.00');
      const stood = await prisma.call.findUniqueOrThrow({ where: { id: denied } });
      expect(
        new Prisma.Decimal((stood.metadata as any).originalBuyerBillableAmount).toFixed(2)
      ).toBe('30.00');

      const list = await app.inject({
        method: 'GET',
        url: `/api/v1/calls?buyerId=${agency.buyerId}&disputeStatus=ANY&limit=50`,
        headers: as(agency.buyerUserId),
      });
      expect(list.statusCode, list.body).toBe(200);
      const rows = list.json().data as any[];
      expect(rows.map(r => r.id).sort()).toEqual([disputed, denied].sort());

      const acceptedRow = rows.find(r => r.id === disputed);
      expect(acceptedRow.disputeStatus).toBe('ACCEPTED');
      expect(acceptedRow.buyerBillableAmount).toBe(0);
      expect(acceptedRow.metadata).toMatchObject({
        decisionNote: 'Agreed, caller was out of state',
      });
      expect(Number(acceptedRow.metadata.originalBuyerBillableAmount)).toBe(40);

      const deniedRow = rows.find(r => r.id === denied);
      expect(deniedRow.metadata).toMatchObject({ decisionNote: 'Connected past the threshold' });
      expect(list.body).not.toContain('Not yours');
    });

    it("shows the buyer its return's decision, and none of the agency's own metadata", async () => {
      const publisher = await prisma.publisher.create({
        data: { tenantId: agency.id, name: 'Alpha Media', code: `pub-${++seq}` },
      });
      // Paid to the publisher already, so accepting the return writes a clawback.
      const callId = await call({
        buyerId: agency.buyerId,
        publisherId: publisher.id,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('45'),
        revenue: new Prisma.Decimal('45'),
        publisherPayoutAmount: new Prisma.Decimal('18'),
        payout: new Prisma.Decimal('18'),
        publisherPayoutStatus: 'PAID',
        buyerChargeStatus: 'CHARGED',
        disputeStatus: 'DISPUTED',
        metadata: {
          disputeReason: 'Out of state',
          disputedAt: '2026-09-12T14:00:00.000Z',
          rtb: { pingId: 'ping-1', buyerBidId: 'bid-1', bidAmount: 45 },
        },
      });
      const decided = await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${callId}/decision`,
        headers: as(agency.ownerId),
        payload: { decision: 'ACCEPT', note: 'Caller was out of the licensed states' },
      });
      expect(decided.statusCode, decided.body).toBe(200);

      const stored = (await prisma.call.findUniqueOrThrow({ where: { id: callId } }))
        .metadata as Record<string, unknown>;
      expect(stored).toHaveProperty('originalPublisherPayout');
      expect(stored).toHaveProperty('clawbackPaymentId');
      expect(stored).toHaveProperty('decidedBy');

      const list = await app.inject({
        method: 'GET',
        url: `/api/v1/calls?buyerId=${agency.buyerId}&disputeStatus=ANY&limit=50`,
        headers: as(agency.buyerUserId),
      });
      expect(list.statusCode, list.body).toBe(200);
      const listed = (list.json().data as any[]).find(r => r.id === callId);
      const detail = await app.inject({
        method: 'GET',
        url: `/api/v1/calls/${callId}`,
        headers: as(agency.buyerUserId),
      });
      expect(detail.statusCode, detail.body).toBe(200);
      const body = detail.json();
      const detailed = body.data ?? body;

      for (const row of [listed, detailed]) {
        expect(row.metadata).toMatchObject({
          disputeReason: 'Out of state',
          disputeDecision: 'ACCEPT',
          decisionNote: 'Caller was out of the licensed states',
        });
        expect(Number(row.metadata.originalBuyerBillableAmount)).toBe(45);
        for (const key of ['originalPublisherPayout', 'clawbackPaymentId', 'decidedBy', 'rtb']) {
          expect(row.metadata).not.toHaveProperty(key);
        }
      }
      expect(list.body).not.toContain(agency.ownerEmail);
      expect(detail.body).not.toContain(agency.ownerEmail);

      // The agency still reads all of it.
      const owner = await app.inject({
        method: 'GET',
        url: `/api/v1/calls?disputeStatus=ANY&limit=50`,
        headers: as(agency.ownerId),
      });
      expect(owner.statusCode, owner.body).toBe(200);
      const ownerRow = (owner.json().data as any[]).find(r => r.id === callId);
      expect(ownerRow.metadata).toHaveProperty('originalPublisherPayout');
      expect(ownerRow.metadata).toHaveProperty('clawbackPaymentId');
      expect(ownerRow.metadata).toHaveProperty('decidedBy');
    });

    it('does not overwrite an original amount already on the call', async () => {
      const callId = await call({
        buyerId: agency.buyerId,
        billable: true,
        buyerBillableAmount: new Prisma.Decimal('0'),
        disputeStatus: 'DISPUTED',
        metadata: { originalBuyerBillableAmount: '65.00' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${callId}/decision`,
        headers: as(agency.ownerId),
        payload: { decision: 'ACCEPT' },
      });
      const after = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
      expect((after.metadata as any).originalBuyerBillableAmount).toBe('65.00');
    });
  });
});
