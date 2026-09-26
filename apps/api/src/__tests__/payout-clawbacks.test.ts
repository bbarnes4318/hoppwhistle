/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CallDirection, CallStatus, Prisma, RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';
import { registerStaffOnly } from '../middleware/staff-only.js';
import { billingService } from '../services/billing-service.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Returns after the publisher was paid, end to end against a real database.
 *
 * Accepting such a return writes a CLAWBACK row in publisher_payments (see
 * returns.test.ts). This suite covers what happens next:
 *
 *   POST /api/v1/payouts           recorded net of the publisher's unapplied
 *                                  clawbacks, which are linked to the payment;
 *                                  409 CLAWBACK_EXCEEDS_PAYABLE when they are
 *                                  more than the payable; applied once under
 *                                  concurrency; never another tenant's
 *   GET  /api/v1/payouts/summary   returnsPending, netPayable; `paid` ignores
 *                                  clawback rows
 *   the migration                  idempotent; its CHECK and unique index
 *   billing recalculation          leaves paid, clawed-back and returned calls
 *                                  byte-identical and reports them as locked
 */

const gate = databaseGate();
announceSkip('Payout clawbacks', gate);

const TEST_JWT_SECRET = 'payout-clawbacks-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Payout clawbacks suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `payout clawbacks suite cannot run: ${gate.reason}`).toBe(true);
  });
});

/** 11:00 New York on 10 and 11 September 2026, clear of either midnight. */
const DAY1 = new Date('2026-09-10T15:00:00Z');
const DAY2 = new Date('2026-09-11T15:00:00Z');
const DAY1_RANGE = { periodFrom: '2026-09-10T04:00:00.000Z', periodTo: '2026-09-11T03:59:59.999Z' };
const DAY2_RANGE = { periodFrom: '2026-09-11T04:00:00.000Z', periodTo: '2026-09-12T03:59:59.999Z' };
const BOTH_DAYS = { periodFrom: DAY1_RANGE.periodFrom, periodTo: DAY2_RANGE.periodTo };
const PERIOD = 'period=CUSTOM&from=2026-09-10&to=2026-09-11';

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../prisma/migrations/20260927000000_publisher_payment_clawbacks/migration.sql'
);

describe.skipIf(!gate.available)('Payout clawbacks', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let seq = 0;

  let wl: { id: string; ownerId: string; alpha: string; beta: string };
  let other: { id: string; ownerId: string; publisherId: string };

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);
    registerStaffOnly(instance);
    const { registerPayoutRoutes } = await import('../routes/payouts.js');
    await instance.register(registerPayoutRoutes);
    await instance.ready();
    return instance;
  }

  function headers(userId: string, tenantId: string): Record<string, string> {
    return {
      authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${userId}@test.local` })}`,
    };
  }

  function record(
    tenant: { id: string; ownerId: string },
    publisherId: string,
    range: { periodFrom: string; periodTo: string }
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/payouts',
      headers: headers(tenant.ownerId, tenant.id),
      payload: { publisherId, ...range, method: 'ACH', reference: 'TRX-1' },
    });
  }

  async function summary(tenant: { id: string; ownerId: string }) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/payouts/summary?${PERIOD}`,
      headers: headers(tenant.ownerId, tenant.id),
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data;
  }

  async function call(
    tenantId: string,
    data: Partial<Prisma.CallUncheckedCreateInput> & { createdAt: Date }
  ) {
    const row = await prisma.call.create({
      data: {
        tenantId,
        toNumber: '+15550000000',
        callSid: `clawback-call-${++seq}-${Date.now()}`,
        status: CallStatus.COMPLETED,
        direction: CallDirection.INBOUND,
        ...data,
      },
    });
    return row.id;
  }

  /** A call the publisher is owed `amount` for. */
  function payable(tenantId: string, publisherId: string, amount: string, createdAt = DAY1) {
    return call(tenantId, {
      createdAt,
      publisherId,
      billable: true,
      publisherPayoutAmount: new Prisma.Decimal(amount),
      payout: new Prisma.Decimal(amount),
      publisherPayoutStatus: 'PAYABLE',
    });
  }

  /**
   * A return accepted after the publisher was paid `amount`: the call as
   * returns.ts leaves it, and the CLAWBACK row it writes.
   */
  async function clawback(
    tenantId: string,
    publisherId: string,
    amount: string,
    createdById: string
  ) {
    const callId = await call(tenantId, {
      createdAt: DAY1,
      publisherId,
      billable: false,
      publisherPayoutAmount: new Prisma.Decimal(0),
      payout: new Prisma.Decimal(0),
      publisherPayoutStatus: 'CLAWED_BACK',
      disputeStatus: 'ACCEPTED',
    });
    const row = await prisma.publisherPayment.create({
      data: {
        kind: 'CLAWBACK',
        tenantId,
        publisherId,
        callId,
        amount: new Prisma.Decimal(amount).negated(),
        periodFrom: DAY1,
        periodTo: DAY1,
        method: 'RETURN',
        reference: `Return ${callId}`,
        paidAt: DAY2,
        createdById,
      },
    });
    return { id: row.id, callId };
  }

  beforeAll(async () => {
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
    const ownerRole = await prisma.role.create({
      data: { name: RoleName.OWNER, description: 'OWNER role', permissions: [] },
    });

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    async function agency(name: string) {
      const tenant = await prisma.tenant.create({
        data: { name, slug: `${name.toLowerCase()}-${stamp}`, status: 'ACTIVE', whiteLabel: true },
      });
      const owner = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: `${name.toLowerCase()}-owner-${stamp}@agency.local`,
          status: 'ACTIVE',
          roles: { create: { roleId: ownerRole.id } },
        },
      });
      return { id: tenant.id, ownerId: owner.id };
    }
    const publisher = async (tenantId: string, name: string) =>
      (await prisma.publisher.create({ data: { tenantId, name, code: `pub-${++seq}` } })).id;

    const llp = await agency('Llp');
    wl = { ...llp, alpha: await publisher(llp.id, 'Alpha Media'), beta: await publisher(llp.id, 'Beta Leads') };
    const ridge = await agency('Ridge');
    other = { ...ridge, publisherId: await publisher(ridge.id, 'Ridge Publisher') };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Recording a payment
  // ══════════════════════════════════════════════════════════════════════════
  describe('POST /api/v1/payouts', () => {
    it('records payable 100.00 less a 20.00 clawback as an 80.00 payment, and links the clawback', async () => {
      const paidCall = await payable(wl.id, wl.alpha, '100.00');
      const owed = await clawback(wl.id, wl.alpha, '20.00', wl.ownerId);

      const response = await record(wl, wl.alpha, DAY1_RANGE);
      expect(response.statusCode, response.body).toBe(201);
      const data = response.json().data;
      expect(data).toMatchObject({
        kind: 'PAYMENT',
        amount: 80,
        gross: 100,
        net: 80,
        calls: 1,
        clawbacks: [{ id: owed.id, callId: owed.callId, amount: -20 }],
      });

      const payment = await prisma.publisherPayment.findUniqueOrThrow({ where: { id: data.id } });
      expect(payment.kind).toBe('PAYMENT');
      expect(payment.amount.toFixed(2)).toBe('80.00');
      expect(
        (await prisma.publisherPayment.findUniqueOrThrow({ where: { id: owed.id } }))
          .appliedToPaymentId
      ).toBe(data.id);
      expect(
        (await prisma.call.findUniqueOrThrow({ where: { id: paidCall } })).publisherPayoutStatus
      ).toBe('PAID');

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'payouts.publisher_payment.recorded' },
      });
      expect(audit.changes).toMatchObject({
        amount: '80.00',
        gross: '100.00',
        clawbacks: '-20.00',
        net: '80.00',
        clawbackIds: [owed.id],
      });
    });

    it('refuses 409 CLAWBACK_EXCEEDS_PAYABLE when the returns are more than the payable, then applies them to the next payment', async () => {
      const first = await payable(wl.id, wl.alpha, '15.00');
      const owed = await clawback(wl.id, wl.alpha, '20.00', wl.ownerId);

      const refused = await record(wl, wl.alpha, DAY1_RANGE);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().error).toEqual({
        code: 'CLAWBACK_EXCEEDS_PAYABLE',
        message:
          'Nothing to pay: $20.00 in returns is more than the $15.00 payable. It carries to the next payment.',
        payable: 15,
        clawbacks: -20,
        net: -5,
      });

      // Nothing written: no payment, the calls still payable, the clawback waiting.
      expect(await prisma.publisherPayment.count({ where: { kind: 'PAYMENT' } })).toBe(0);
      expect(
        (await prisma.call.findUniqueOrThrow({ where: { id: first } })).publisherPayoutStatus
      ).toBe('PAYABLE');
      expect(
        (await prisma.publisherPayment.findUniqueOrThrow({ where: { id: owed.id } }))
          .appliedToPaymentId
      ).toBeNull();
      expect(
        await prisma.auditLog.count({ where: { action: 'payouts.publisher_payment.recorded' } })
      ).toBe(0);

      // More calls come in; the next payment takes the return out.
      await payable(wl.id, wl.alpha, '30.00', DAY2);
      const next = await record(wl, wl.alpha, BOTH_DAYS);
      expect(next.statusCode, next.body).toBe(201);
      expect(next.json().data).toMatchObject({ amount: 25, gross: 45, net: 25, calls: 2 });
      expect(
        (await prisma.publisherPayment.findUniqueOrThrow({ where: { id: owed.id } }))
          .appliedToPaymentId
      ).toBe(next.json().data.id);
    });

    it('applies a clawback once when two payments are recorded at the same moment', async () => {
      await payable(wl.id, wl.alpha, '100.00', DAY1);
      await payable(wl.id, wl.alpha, '50.00', DAY2);
      const owed = await clawback(wl.id, wl.alpha, '20.00', wl.ownerId);

      const [a, b] = await Promise.all([
        record(wl, wl.alpha, DAY1_RANGE),
        record(wl, wl.alpha, DAY2_RANGE),
      ]);
      expect(a.statusCode, a.body).toBe(201);
      expect(b.statusCode, b.body).toBe(201);

      const payments = await prisma.publisherPayment.findMany({ where: { kind: 'PAYMENT' } });
      expect(payments).toHaveLength(2);
      const total = payments.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
      expect(total.toFixed(2)).toBe('130.00');

      // Deducted from exactly one of them.
      const applied = [a, b].filter(r => r.json().data.clawbacks.length === 1);
      expect(applied).toHaveLength(1);
      const row = await prisma.publisherPayment.findUniqueOrThrow({ where: { id: owed.id } });
      expect(row.appliedToPaymentId).toBe(applied[0].json().data.id);
    });

    it("never applies another tenant's clawback", async () => {
      await payable(wl.id, wl.alpha, '100.00');
      // The other agency's own return, on its own publisher...
      const theirs = await clawback(other.id, other.publisherId, '20.00', other.ownerId);
      // ...and a row that names this tenant's publisher under the other tenant.
      const stray = await clawback(other.id, wl.alpha, '7.00', other.ownerId);

      const response = await record(wl, wl.alpha, DAY1_RANGE);
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json().data).toMatchObject({ amount: 100, gross: 100, net: 100, clawbacks: [] });

      for (const id of [theirs.id, stray.id]) {
        expect(
          (await prisma.publisherPayment.findUniqueOrThrow({ where: { id } })).appliedToPaymentId
        ).toBeNull();
      }
    });

    it('still refuses NOTHING_PAYABLE when there are no payable calls', async () => {
      await clawback(wl.id, wl.alpha, '20.00', wl.ownerId);
      const response = await record(wl, wl.alpha, DAY1_RANGE);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('NOTHING_PAYABLE');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // The summary
  // ══════════════════════════════════════════════════════════════════════════
  describe('GET /api/v1/payouts/summary', () => {
    it('reads returnsPending and netPayable, and paid ignores clawback rows', async () => {
      await payable(wl.id, wl.alpha, '100.00');
      // Paid for already: 30.00.
      await call(wl.id, {
        createdAt: DAY1,
        publisherId: wl.alpha,
        billable: true,
        publisherPayoutAmount: new Prisma.Decimal('30.00'),
        payout: new Prisma.Decimal('30.00'),
        publisherPayoutStatus: 'PAID',
      });
      const owed = await clawback(wl.id, wl.alpha, '20.00', wl.ownerId);
      // Beta owes more than it is owed.
      await payable(wl.id, wl.beta, '5.00');
      await clawback(wl.id, wl.beta, '12.50', wl.ownerId);
      // Another tenant's never shows.
      const theirs = await clawback(other.id, other.publisherId, '9.00', other.ownerId);

      const data = await summary(wl);
      const alpha = data.publishers.find((row: any) => row.publisherId === wl.alpha);
      const beta = data.publishers.find((row: any) => row.publisherId === wl.beta);
      expect(alpha).toMatchObject({ payable: 100, paid: 30, held: 0, returnsPending: 20, netPayable: 80 });
      expect(beta).toMatchObject({ payable: 5, paid: 0, returnsPending: 12.5, netPayable: -7.5 });
      // A clawback is not anybody's last payment.
      expect(alpha.lastPayment).toBeNull();

      expect(data.payments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: owed.id,
            kind: 'CLAWBACK',
            callId: owed.callId,
            appliedToPaymentId: null,
            amount: -20,
          }),
        ])
      );
      expect(JSON.stringify(data)).not.toContain(theirs.id);

      // Once applied it is no longer pending, and paid does not move for it.
      expect((await record(wl, wl.alpha, DAY1_RANGE)).statusCode).toBe(201);
      const after = (await summary(wl)).publishers.find(
        (row: any) => row.publisherId === wl.alpha
      );
      expect(after).toMatchObject({ payable: 0, paid: 130, returnsPending: 0, netPayable: 0 });
      expect(after.lastPayment).toMatchObject({ kind: 'PAYMENT', amount: 80 });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // The migration
  // ══════════════════════════════════════════════════════════════════════════
  describe('20260927000000_publisher_payment_clawbacks', () => {
    it('runs twice without error', async () => {
      const sql = readFileSync(MIGRATION, 'utf8');
      const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
      await client.connect();
      try {
        await client.query(sql);
        await client.query(sql);
      } finally {
        await client.end();
      }
    });

    it('rejects a PAYMENT that is not positive, and a CLAWBACK that is not negative or has no call', async () => {
      const callId = await payable(wl.id, wl.alpha, '10.00');
      const base = {
        tenantId: wl.id,
        publisherId: wl.alpha,
        periodFrom: DAY1,
        periodTo: DAY1,
        method: 'ACH',
        paidAt: DAY1,
        createdById: wl.ownerId,
      };
      const bad: Array<Partial<Prisma.PublisherPaymentUncheckedCreateInput>> = [
        { kind: 'PAYMENT', amount: new Prisma.Decimal(0) },
        { kind: 'PAYMENT', amount: new Prisma.Decimal(-5) },
        { kind: 'CLAWBACK', amount: new Prisma.Decimal(0), callId },
        { kind: 'CLAWBACK', amount: new Prisma.Decimal(5), callId },
        { kind: 'CLAWBACK', amount: new Prisma.Decimal(-5) },
      ];
      for (const row of bad) {
        await expect(
          prisma.publisherPayment.create({ data: { ...base, amount: 0, ...row } }),
          JSON.stringify(row)
        ).rejects.toThrow(/publisher_payments_kind_amount_check|check constraint/i);
      }
      expect(await prisma.publisherPayment.count()).toBe(0);
    });

    it('rejects a second clawback for the same call', async () => {
      const first = await clawback(wl.id, wl.alpha, '20.00', wl.ownerId);
      await expect(
        prisma.publisherPayment.create({
          data: {
            kind: 'CLAWBACK',
            tenantId: wl.id,
            publisherId: wl.alpha,
            callId: first.callId,
            amount: new Prisma.Decimal(-20),
            periodFrom: DAY1,
            periodTo: DAY1,
            method: 'RETURN',
            paidAt: DAY1,
            createdById: wl.ownerId,
          },
        })
      ).rejects.toThrow(/Unique constraint|publisher_payments_clawback_call_key/i);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Billing recalculation never touches settled money
  // ══════════════════════════════════════════════════════════════════════════
  describe('billing recalculation', () => {
    it('leaves accepted, paid, clawed-back, refunded and waived calls byte-identical and reports them as locked', async () => {
      const settled = {
        createdAt: DAY1,
        publisherId: wl.alpha,
        billable: true,
        connectedDuration: 300,
        duration: 310,
        cost: new Prisma.Decimal('0.25'),
        buyerBillableAmount: new Prisma.Decimal('40'),
        revenue: new Prisma.Decimal('40'),
        publisherPayoutAmount: new Prisma.Decimal('15'),
        payout: new Prisma.Decimal('15'),
        profit: new Prisma.Decimal('24.75'),
        publisherPayoutStatus: 'PAYABLE',
        buyerChargeStatus: 'CHARGED',
      };
      const locked = [
        await call(wl.id, { ...settled, disputeStatus: 'ACCEPTED' }),
        await call(wl.id, { ...settled, publisherPayoutStatus: 'PAID' }),
        await call(wl.id, {
          ...settled,
          publisherPayoutStatus: 'CLAWED_BACK',
          publisherPayoutAmount: new Prisma.Decimal(0),
          payout: new Prisma.Decimal(0),
        }),
        await call(wl.id, { ...settled, buyerChargeStatus: 'REFUNDED' }),
        await call(wl.id, { ...settled, buyerChargeStatus: 'WAIVED' }),
      ];
      // An ordinary call beside them, which billing is free to recompute.
      const open = await call(wl.id, { ...settled });

      const snapshot = async () =>
        prisma.$queryRaw<Array<{ id: string; row: string }>>`
          SELECT "id", row_to_json(c)::text AS "row" FROM "calls" c
          WHERE "id" IN (${Prisma.join(locked)}) ORDER BY "id"
        `;
      const before = await snapshot();

      for (const id of locked) {
        const res = await billingService.calculateCallBilling(id);
        expect(res).toMatchObject({ success: false, error: 'LOCKED' });
      }

      const result = await billingService.recalculateBillingForDateRange({
        tenantId: wl.id,
        startDate: new Date('2026-09-10T00:00:00Z'),
        endDate: new Date('2026-09-12T00:00:00Z'),
      });
      expect(result).toMatchObject({ scanned: 6, locked: 5, updated: 1 });
      expect(result.billable + result.nonBillable).toBe(1);
      expect(result.changes.map(change => change.callId).every(id => id === open)).toBe(true);

      expect(await snapshot()).toEqual(before);
      expect(await prisma.accrualLedger.count({ where: { callId: { in: locked } } })).toBe(0);
    });
  });
});
