/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { CallDirection, CallStatus, Prisma, RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { getPayoutsSummary } from '../routes/payouts.js';
import { resolvePeriod } from '../services/leaderboard/period.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The publisher portal shows the owner's numbers.
 *
 *   GET /api/v1/publishers/:id/payouts          what the agency recorded paying
 *   GET /api/v1/publishers/:id/payouts/summary  this publisher's Payouts row
 *   GET /api/v1/publishers/:id/daily            calls per New York calendar day
 *   GET /api/v1/publishers/:id/docs             who to write to (the owner)
 *   GET /api/v1/calls?hasRecording=&billable=   the Recordings nav and filter
 *
 * The payouts list used to read a table nothing writes, the cards were derived
 * from whichever fifty calls the browser had, and the dashboard chart was a sine
 * wave. Each case here is pinned to what the OWNER's own screen answers, so a
 * portal figure that drifts from the owner's fails here.
 */

const gate = databaseGate();
announceSkip('Publisher portal money', gate);

const TEST_JWT_SECRET = 'publisher-portal-money-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

/** A closed, fixed period well before DST starts on 2026-03-08: New York is UTC-5. */
const PERIOD = 'period=CUSTOM&from=2026-03-01&to=2026-03-05';

describe('Publisher portal money suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `publisher portal money suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Publisher portal money', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  let tenantId: string;
  let otherTenantId: string;
  let ownPublisherId: string;
  let siblingPublisherId: string;
  let ownerId: string;
  let ownerEmail: string;
  let publisherUserId: string;
  let otherOwnerId: string;
  let calls: Record<string, string>;
  let paymentId: string;
  let appliedClawbackId: string;
  let waitingClawbackId: string;
  let seq = 0;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    const { registerCallRoutes, registerPublisherRoutes } = await import('../routes/index.js');
    await instance.register(registerCallRoutes);
    await instance.register(registerPublisherRoutes);
    await instance.ready();
    return instance;
  }

  function get(url: string, userId: string, tenant = tenantId) {
    return app.inject({
      method: 'GET',
      url,
      headers: {
        authorization: `Bearer ${app.jwt.sign({ userId, tenantId: tenant, email: 'x@t.local' })}`,
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
    for (const table of ['audit_logs', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }

    const roleIds: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.PUBLISHER]) {
      roleIds[name] = (
        await prisma.role.create({ data: { name, description: `${name} role`, permissions: [] } })
      ).id;
    }

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    tenantId = (
      await prisma.tenant.create({
        data: { name: 'Alpha', slug: `alpha-${stamp}`, status: 'ACTIVE', whiteLabel: true },
      })
    ).id;
    otherTenantId = (
      await prisma.tenant.create({
        data: { name: 'Bravo', slug: `bravo-${stamp}`, status: 'ACTIVE', whiteLabel: true },
      })
    ).id;

    ownPublisherId = (
      await prisma.publisher.create({ data: { tenantId, name: 'Own', code: `OWN-${stamp}` } })
    ).id;
    siblingPublisherId = (
      await prisma.publisher.create({ data: { tenantId, name: 'Sibling', code: `SIB-${stamp}` } })
    ).id;

    const user = async (
      label: string,
      role: RoleName,
      publisherId: string | null = null,
      tenant = tenantId
    ) =>
      prisma.user.create({
        data: {
          tenantId: tenant,
          email: `${label}-${stamp}@test.local`,
          status: 'ACTIVE',
          publisherId,
          roles: { create: { roleId: roleIds[role] } },
        },
      });
    const owner = await user('owner', RoleName.OWNER);
    ownerId = owner.id;
    ownerEmail = owner.email;
    publisherUserId = (await user('publisher', RoleName.PUBLISHER, ownPublisherId)).id;
    otherOwnerId = (await user('other-owner', RoleName.OWNER, null, otherTenantId)).id;

    const call = async (at: string, data: Partial<Prisma.CallUncheckedCreateInput> = {}) =>
      (
        await prisma.call.create({
          data: {
            tenantId,
            publisherId: ownPublisherId,
            toNumber: '+15550000000',
            callSid: `portal-${++seq}-${stamp}`,
            status: CallStatus.COMPLETED,
            direction: CallDirection.INBOUND,
            createdAt: new Date(at),
            ...data,
          },
        })
      ).id;

    calls = {
      // 2 March, 10:00 New York.
      payable: await call('2026-03-02T15:00:00Z', {
        billable: true,
        publisherPayoutAmount: new Prisma.Decimal('12.50'),
        publisherPayoutStatus: 'PAYABLE',
        primaryRecordingId: 'rec-1',
      }),
      // 3 March, 22:00 New York -- 4 March in UTC. Must land on the 3rd.
      lateEvening: await call('2026-03-04T03:00:00Z', {
        billable: false,
        publisherPayoutAmount: new Prisma.Decimal('0'),
        publisherPayoutStatus: 'PAYABLE',
      }),
      paid: await call('2026-03-03T14:00:00Z', {
        billable: true,
        publisherPayoutAmount: new Prisma.Decimal('20.00'),
        publisherPayoutStatus: 'PAID',
        primaryRecordingId: 'rec-2',
      }),
      held: await call('2026-03-05T14:00:00Z', {
        billable: true,
        publisherPayoutAmount: new Prisma.Decimal('7.00'),
        publisherPayoutStatus: 'HELD',
      }),
      // Returned after it was paid: owed back on the next payment.
      returnedApplied: await call('2026-02-10T14:00:00Z', {
        billable: true,
        publisherPayoutAmount: new Prisma.Decimal('5.00'),
        publisherPayoutStatus: 'CLAWED_BACK',
      }),
      returnedWaiting: await call('2026-02-11T14:00:00Z', {
        billable: true,
        publisherPayoutAmount: new Prisma.Decimal('4.00'),
        publisherPayoutStatus: 'CLAWED_BACK',
      }),
      // Another publisher's call, same day: never in this publisher's series.
      sibling: await call('2026-03-02T16:00:00Z', {
        publisherId: siblingPublisherId,
        billable: true,
        publisherPayoutAmount: new Prisma.Decimal('99.00'),
        publisherPayoutStatus: 'PAYABLE',
      }),
    };

    const base = {
      tenantId,
      publisherId: ownPublisherId,
      periodFrom: new Date('2026-02-01T05:00:00Z'),
      periodTo: new Date('2026-03-01T04:59:59Z'),
      createdById: ownerId,
    };
    paymentId = (
      await prisma.publisherPayment.create({
        data: {
          ...base,
          kind: 'PAYMENT',
          amount: new Prisma.Decimal('15.00'),
          method: 'ACH',
          reference: 'ACH-1001',
          paidAt: new Date('2026-03-01T15:00:00Z'),
        },
      })
    ).id;
    appliedClawbackId = (
      await prisma.publisherPayment.create({
        data: {
          ...base,
          kind: 'CLAWBACK',
          callId: calls.returnedApplied,
          appliedToPaymentId: paymentId,
          amount: new Prisma.Decimal('-5.00'),
          method: 'RETURN',
          reference: `Return ${calls.returnedApplied}`,
          paidAt: new Date('2026-02-20T15:00:00Z'),
        },
      })
    ).id;
    waitingClawbackId = (
      await prisma.publisherPayment.create({
        data: {
          ...base,
          kind: 'CLAWBACK',
          callId: calls.returnedWaiting,
          amount: new Prisma.Decimal('-4.00'),
          method: 'RETURN',
          reference: `Return ${calls.returnedWaiting}`,
          paidAt: new Date('2026-03-02T15:00:00Z'),
        },
      })
    ).id;
    // The sibling's payment must never show on this publisher's page.
    await prisma.publisherPayment.create({
      data: {
        ...base,
        publisherId: siblingPublisherId,
        kind: 'PAYMENT',
        amount: new Prisma.Decimal('500.00'),
        method: 'Wire',
        paidAt: new Date('2026-03-01T15:00:00Z'),
      },
    });
  });

  describe('GET /payouts', () => {
    it('lists the payments the owner recorded, with their deductions and waiting returns', async () => {
      const response = await get(`/api/v1/publishers/${ownPublisherId}/payouts`, publisherUserId);
      expect(response.statusCode, response.body).toBe(200);
      const { payments, waiting } = response.json().data;

      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({
        id: paymentId,
        amount: 15,
        method: 'ACH',
        reference: 'ACH-1001',
        paidAt: '2026-03-01T15:00:00.000Z',
        deductions: [
          {
            id: appliedClawbackId,
            callId: calls.returnedApplied,
            callDate: '2026-02-10T14:00:00.000Z',
            amount: -5,
          },
        ],
      });

      expect(waiting).toEqual([
        expect.objectContaining({
          id: waitingClawbackId,
          callId: calls.returnedWaiting,
          callDate: '2026-02-11T14:00:00.000Z',
          amount: -4,
        }),
      ]);
    });

    it('keeps a deduction whose returned call was deleted, with no call date', async () => {
      await prisma.call.delete({ where: { id: calls.returnedApplied } });
      const response = await get(`/api/v1/publishers/${ownPublisherId}/payouts`, publisherUserId);
      expect(response.statusCode).toBe(200);
      expect(response.json().data.payments[0].deductions[0]).toMatchObject({
        id: appliedClawbackId,
        callId: null,
        callDate: null,
        amount: -5,
      });
    });
  });

  describe('GET /payouts/summary', () => {
    it("is the owner's Payouts row for the same period", async () => {
      const response = await get(
        `/api/v1/publishers/${ownPublisherId}/payouts/summary?${PERIOD}`,
        publisherUserId
      );
      expect(response.statusCode, response.body).toBe(200);
      const data = response.json().data;

      const period = resolvePeriod('CUSTOM', { from: '2026-03-01', to: '2026-03-05' });
      const owners = await getPayoutsSummary(prisma, tenantId, period);
      const row = owners.publishers.find(p => p.publisherId === ownPublisherId)!;

      expect(data).toMatchObject({
        payable: row.payable,
        payableCalls: row.payableCalls,
        held: row.held,
        paid: row.paid,
        returnsPending: row.returnsPending,
        netPayable: row.netPayable,
      });
      // And the row is the one expected, so the comparison is not two zeros.
      expect(data).toMatchObject({
        payable: 12.5,
        payableCalls: 2,
        held: 7,
        paid: 20,
        returnsPending: 4,
        netPayable: 8.5,
      });
      expect(data.period).toMatchObject({
        key: 'CUSTOM',
        from: '2026-03-01',
        to: '2026-03-05',
        startsAt: '2026-03-01T05:00:00.000Z',
      });
    });

    it('defaults to This month', async () => {
      const response = await get(
        `/api/v1/publishers/${ownPublisherId}/payouts/summary`,
        publisherUserId
      );
      expect(response.statusCode).toBe(200);
      expect(response.json().data.period).toMatchObject({ key: 'THIS_MONTH', label: 'This month' });
    });

    it('refuses a bad period 400', async () => {
      const response = await get(
        `/api/v1/publishers/${ownPublisherId}/payouts/summary?period=FOREVER`,
        publisherUserId
      );
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /daily', () => {
    it('is every New York day of the period, zero days included', async () => {
      const response = await get(
        `/api/v1/publishers/${ownPublisherId}/daily?${PERIOD}`,
        publisherUserId
      );
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data.days).toEqual([
        { day: '2026-03-01', calls: 0, billable: 0, payout: 0 },
        { day: '2026-03-02', calls: 1, billable: 1, payout: 12.5 },
        { day: '2026-03-03', calls: 2, billable: 1, payout: 20 },
        { day: '2026-03-04', calls: 0, billable: 0, payout: 0 },
        { day: '2026-03-05', calls: 1, billable: 1, payout: 7 },
      ]);
    });

    it('refuses a range longer than a year', async () => {
      const response = await get(
        `/api/v1/publishers/${ownPublisherId}/daily?period=CUSTOM&from=2024-01-01&to=2026-01-01`,
        publisherUserId
      );
      expect(response.statusCode).toBe(400);
    });
  });

  describe('access', () => {
    const PATHS = [
      (id: string) => `/api/v1/publishers/${id}/payouts`,
      (id: string) => `/api/v1/publishers/${id}/payouts/summary?${PERIOD}`,
      (id: string) => `/api/v1/publishers/${id}/daily?${PERIOD}`,
    ];

    it.each(PATHS)('refuses another publisher 403 (%#)', async path => {
      const response = await get(path(siblingPublisherId), publisherUserId);
      expect(response.statusCode, response.body).toBe(403);
    });

    it.each(PATHS)("refuses another agency's owner 404 (%#)", async path => {
      const response = await get(path(ownPublisherId), otherOwnerId, otherTenantId);
      expect(response.statusCode, response.body).toBe(404);
    });

    it.each(PATHS)("lets the agency's owner read it (%#)", async path => {
      const response = await get(path(ownPublisherId), ownerId);
      expect(response.statusCode, response.body).toBe(200);
    });
  });

  describe('GET /docs', () => {
    it("names the agency owner's email as the support contact", async () => {
      const response = await get(`/api/v1/publishers/${ownPublisherId}/docs`, publisherUserId);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().supportEmail).toBe(ownerEmail);
      expect(response.body).not.toContain('support@netenroll.com');
    });
  });

  describe('GET /api/v1/calls filters', () => {
    async function listed(query: string, userId = publisherUserId): Promise<string[]> {
      const response = await get(`/api/v1/calls?limit=100&${query}`, userId);
      expect(response.statusCode, response.body).toBe(200);
      return response
        .json()
        .data.map((c: any) => c.id)
        .sort();
    }
    const names = (...keys: string[]) => keys.map(key => calls[key]).sort();

    it('hasRecording=true lists only calls with a recording', async () => {
      expect(await listed('hasRecording=true')).toEqual(names('payable', 'paid'));
      expect(await listed('hasRecording=true', ownerId)).toEqual(names('payable', 'paid'));
    });

    it('billable=true and billable=false split the list, across every page', async () => {
      expect(await listed('billable=false')).toEqual(names('lateEvening'));
      expect(await listed('billable=true')).toEqual(
        names('payable', 'paid', 'held', 'returnedApplied', 'returnedWaiting')
      );

      const response = await get('/api/v1/calls?limit=2&page=1&billable=true', publisherUserId);
      expect(response.json().meta).toMatchObject({ total: 5, totalPages: 3 });
    });

    it("the publisher's CSV honours the filters and carries no buyer charge status", async () => {
      const response = await get(
        '/api/v1/calls/export.csv?billable=false&startDate=2026-03-01T00:00:00.000Z&endDate=2026-03-31T23:59:59.999Z',
        publisherUserId
      );
      expect(response.statusCode, response.body).toBe(200);
      const lines = response.body.trim().split('\n');
      expect(lines[0]).not.toContain('Buyer Charge Status');
      expect(lines[0]).toContain('Payout');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain(calls.lateEvening);
    });

    it('treats an unknown value as no filter', async () => {
      expect(await listed('billable=maybe&hasRecording=yes')).toHaveLength(6);
    });
  });
});
