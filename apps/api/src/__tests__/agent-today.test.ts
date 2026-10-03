/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await -- assertions run over parsed JSON responses, which are dynamically typed; the Redis fake is async to match the client */
import { CallDirection, CallStatus, Prisma, RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerStaffOnly } from '../middleware/staff-only.js';
import { resolvePeriod } from '../services/leaderboard/period.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The agent's Today against a real database.
 *
 * What this pins is WHOSE, and WHAT NOT:
 *
 *   - the day is the signed-in agent's, in the acting tenant, and nothing a
 *     caller puts in the query string changes that;
 *   - a colleague's calls, applications and customers never appear in it, and
 *     neither does another agency's anything;
 *   - there is no money and no counterparty in the response -- not as a value
 *     the screen hides, as a key that is not there;
 *   - "nothing measured" is null, not zero: no calls is no closing
 *     percentage, no availability record is no time available.
 */

const redis = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('../services/redis.js', () => ({
  getRedisClient: () => ({
    get: async (key: string) => redis.store.get(key) ?? null,
    set: async (key: string, value: string) => {
      redis.store.set(key, value);
      return 'OK';
    },
    mget: async (keys: string[]) => keys.map(key => redis.store.get(key) ?? null),
    del: async (key: string) => (redis.store.delete(key) ? 1 : 0),
  }),
  closeRedisClient: async () => {},
}));

const gate = databaseGate();
announceSkip('Agent Today', gate);

const TEST_JWT_SECRET = 'agent-today-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Agent Today suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `agent today suite cannot run: ${gate.reason}`).toBe(true);
  });
});

/** Every key anywhere in a parsed JSON value. */
function keysOf(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach(item => keysOf(item, into));
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.push(key);
      keysOf(inner, into);
    }
  }
  return into;
}

const MONEY_OR_COUNTERPARTY =
  /revenue|profit|payout|cost|margin|charge|rate$|^rate|balance|billing|billable|settlement|buyer|publisher|premium|commission|price|amount/i;

describe.skipIf(!gate.available)('GET /api/v1/agent/today', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let seq = 0;

  let tenantA: string;
  let tenantB: string;
  let agentA: string;
  let agentB: string;
  let idleAgent: string;
  let otherAgencyAgent: string;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerStaffOnly(instance);
    const { registerAgentTodayRoutes } = await import('../routes/agent-today.js');
    await instance.register(registerAgentTodayRoutes);
    await instance.ready();
    return instance;
  }

  function get(userId: string, tenantId: string, query = '') {
    return app.inject({
      method: 'GET',
      url: `/api/v1/agent/today${query}`,
      headers: {
        authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${userId}@test.local` })}`,
      },
    });
  }

  /** `msAgo` before now, never before the start of today in New York. */
  function earlierToday(msAgo: number): Date {
    const startOfToday = resolvePeriod('TODAY').start.getTime();
    return new Date(Math.max(Date.now() - msAgo, startOfToday + 1));
  }

  async function answered(
    tenantId: string,
    userId: string | null,
    data: Partial<Prisma.CallUncheckedCreateInput> = {}
  ): Promise<string> {
    const at = earlierToday(600_000);
    return (
      await prisma.call.create({
        data: {
          tenantId,
          toNumber: '+15550000000',
          callerId: `+1555000${String(++seq).padStart(4, '0')}`,
          callSid: `agent-today-${seq}-${Date.now()}`,
          status: CallStatus.COMPLETED,
          direction: CallDirection.INBOUND,
          createdAt: at,
          answeredAt: at,
          answeredByUserId: userId,
          connectedDuration: 300,
          // Money on the row, so a leak would have something to leak.
          revenue: new Prisma.Decimal('987.65'),
          payout: new Prisma.Decimal('123.45'),
          profit: new Prisma.Decimal('864.20'),
          ...data,
        },
      })
    ).id;
  }

  async function application(
    tenantId: string,
    userId: string,
    data: Partial<Prisma.InsuranceCarrierApplicationUncheckedCreateInput> = {}
  ) {
    await prisma.insuranceCarrierApplication.create({
      data: {
        tenantId,
        firstName: 'Test',
        lastName: 'Applicant',
        createdById: userId,
        submittedAt: earlierToday(300_000),
        annualizedPremium: new Prisma.Decimal('1200'),
        ...data,
      },
    });
  }

  async function lead(
    tenantId: string,
    assignedToId: string | null,
    fullName: string,
    nextFollowUpAt: Date | null,
    extra: Partial<Prisma.InsuranceLeadUncheckedCreateInput> = {}
  ) {
    await prisma.insuranceLead.create({
      data: {
        tenantId,
        vertical: 'FE',
        fullName,
        phone: `615555${String(++seq).padStart(4, '0')}`,
        assignedToId,
        nextFollowUpAt,
        state: 'TN',
        ...extra,
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
    redis.store.clear();

    for (const table of ['audit_logs', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
    const agentRole = (
      await prisma.role.create({
        data: { name: RoleName.AGENT, description: 'AGENT role', permissions: [] },
      })
    ).id;
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agent = async (tenantId: string, label: string) =>
      (
        await prisma.user.create({
          data: {
            tenantId,
            email: `${label}-${stamp}@agency.local`,
            firstName: label,
            status: 'ACTIVE',
            // Licensed in Tennessee: the CRM narrows an agent to their states.
            metadata: { licensedStates: ['TN'] },
            roles: { create: { roleId: agentRole } },
          },
        })
      ).id;

    tenantA = (
      await prisma.tenant.create({
        data: { name: 'Life Leads Plus', slug: `llp-${stamp}`, status: 'ACTIVE', whiteLabel: true },
      })
    ).id;
    tenantB = (
      await prisma.tenant.create({
        data: { name: 'Other Agency', slug: `other-${stamp}`, status: 'ACTIVE' },
      })
    ).id;
    agentA = await agent(tenantA, 'alice');
    agentB = await agent(tenantA, 'bob');
    idleAgent = await agent(tenantA, 'idle');
    otherAgencyAgent = await agent(tenantB, 'zed');

    const buyer = await prisma.buyer.create({
      data: { tenantId: tenantA, name: 'Secret Buyer Co', code: `b-${stamp}` },
    });
    const publisher = await prisma.publisher.create({
      data: { tenantId: tenantA, name: 'Secret Publisher Co', code: `p-${stamp}` },
    });

    // Alice: three answered calls, one application, one voided application.
    const aliceCall = await answered(tenantA, agentA, {
      buyerId: buyer.id,
      publisherId: publisher.id,
      disposition: 'APPLICATION_SUBMITTED',
    });
    await answered(tenantA, agentA, { disposition: 'NOT_INTERESTED' });
    await answered(tenantA, agentA, { connectedDuration: 600 });
    await application(tenantA, agentA, { callId: aliceCall });
    await application(tenantA, agentA, { voidedAt: new Date(), voidReason: 'test' });

    // Bob: two answered calls and one application -- the agency's, not Alice's.
    await answered(tenantA, agentB);
    await answered(tenantA, agentB);
    await application(tenantA, agentB, { firstName: 'Bobs', lastName: 'Customer' });

    // Another agency entirely: a lot of activity that must reach nobody in A.
    for (let i = 0; i < 4; i++) await answered(tenantB, otherAgencyAgent);
    await application(tenantB, otherAgencyAgent);
    await application(tenantB, otherAgencyAgent);

    // The CRM. Alice: two overdue follow-ups, one in two days, one lost.
    const hourAgo = new Date(Date.now() - 3_600_000);
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    await lead(tenantA, agentA, 'Carol Overdue', twoDaysAgo, { leadStage: 'QUOTED' });
    await lead(tenantA, agentA, 'Dan Hour Ago', hourAgo);
    await lead(tenantA, agentA, 'Erin Later', new Date(Date.now() + 2 * 86_400_000));
    await lead(tenantA, agentA, 'Fay Lost', twoDaysAgo, { leadStage: 'CLOSED_LOST' });
    // Alice's, overdue, but in a state she is not licensed in: the CRM would
    // not list it to her, so Today does not either.
    await lead(tenantA, agentA, 'Gus Unlicensed', twoDaysAgo, { state: 'FL' });
    // Bob's customer, overdue -- Alice must never see it.
    await lead(tenantA, agentB, 'Bobs Private Customer', twoDaysAgo);
    // Unassigned: the agency's, not Alice's.
    await lead(tenantA, null, 'Nobodys Lead', twoDaysAgo);
    await lead(tenantB, otherAgencyAgent, 'Other Agency Customer', twoDaysAgo);

    // Alice recorded on the queue for the last half hour.
    await prisma.agentStateEvent.create({
      data: { userId: agentA, status: 'available', occurredAt: earlierToday(1_800_000) },
    });
  });

  it("answers with the signed-in agent's own figures", async () => {
    const response = await get(agentA, tenantA);
    expect(response.statusCode).toBe(200);
    const body = response.json().data;

    expect(body.period.key).toBe('TODAY');
    expect(body.summary.callsAnswered).toBe(3);
    // The voided application is not an application.
    expect(body.summary.applications).toBe(1);
    expect(body.summary.closingPct).toBeCloseTo(33.33, 2);
    expect(body.summary.talkTimeSeconds).toBe(1200);
    expect(body.summary.averageCallSeconds).toBe(400);
    expect(body.summary.availableSeconds).toBeGreaterThan(0);
    expect(body.summary.followUpsDue).toBe(2);

    // The agency benchmark: 2 applications from 5 answered calls, same window.
    expect(body.agencyBenchmark.closingPct).toBeCloseTo(40, 2);

    // The chart sums to the tiles.
    expect(body.byHour).toHaveLength(24);
    const sum = (key: string) => body.byHour.reduce((t: number, s: any) => t + s[key], 0);
    expect(sum('callsAnswered')).toBe(3);
    expect(sum('applications')).toBe(1);

    expect(body.trend).toHaveLength(7);
    expect(body.trend[6].callsTaken).toBe(3);
    expect(body.trend[6].applications).toBe(1);

    expect(body.recentCalls).toHaveLength(3);
    expect(body.recentCalls.filter((c: any) => c.application)).toHaveLength(1);

    // Life Leads Plus is white-label: its agents have no Leaderboard, so no
    // standing on it.
    expect(body.standing).toBeNull();
  });

  it('lists the follow-ups due, oldest first, and only the agent’s own', async () => {
    const body = (await get(agentA, tenantA)).json().data;
    expect(body.attention.map((a: any) => a.name)).toEqual(['Carol Overdue', 'Dan Hour Ago']);
    expect(body.attention[0]).toMatchObject({ kind: 'follow_up_overdue', stage: 'QUOTED' });

    const serialised = JSON.stringify(body);
    for (const name of [
      'Gus Unlicensed',
      'Bobs Private Customer',
      'Nobodys Lead',
      'Other Agency Customer',
      'Bobs',
    ]) {
      expect(serialised).not.toContain(name);
    }
  });

  it('ignores an agentId in the query: the token decides whose day it is', async () => {
    const mine = (await get(agentA, tenantA)).json().data;
    const asked = (await get(agentA, tenantA, `?agentId=${agentB}&userId=${agentB}`)).json().data;
    expect(asked.summary).toEqual(mine.summary);
    expect(asked.attention).toEqual(mine.attention);

    const bob = (await get(agentB, tenantA)).json().data;
    expect(bob.summary.callsAnswered).toBe(2);
    expect(bob.summary.applications).toBe(1);
    expect(bob.attention.map((a: any) => a.name)).toEqual(['Bobs Private Customer']);
    expect(JSON.stringify(bob)).not.toContain('Carol Overdue');
  });

  it('keeps one agency out of another', async () => {
    const other = (await get(otherAgencyAgent, tenantB)).json().data;
    expect(other.summary.callsAnswered).toBe(4);
    expect(other.summary.applications).toBe(2);
    // B's own benchmark, not A's: 2 applications from 4 calls.
    expect(other.agencyBenchmark.closingPct).toBeCloseTo(50, 2);
    expect(other.attention.map((a: any) => a.name)).toEqual(['Other Agency Customer']);
    expect(JSON.stringify(other)).not.toContain('Carol Overdue');

    const alice = (await get(agentA, tenantA)).json().data;
    expect(JSON.stringify(alice)).not.toContain('Other Agency Customer');
  });

  it('carries no money and no counterparty: not hidden, absent', async () => {
    const response = await get(agentA, tenantA);
    const body = response.json().data;

    const offending = keysOf(body).filter(key => MONEY_OR_COUNTERPARTY.test(key));
    expect(offending).toEqual([]);

    const serialised = response.body;
    for (const value of ['987.65', '123.45', '864.2', 'Secret Buyer Co', 'Secret Publisher Co']) {
      expect(serialised).not.toContain(value);
    }
  });

  it('is null, not zero, for what was never measured', async () => {
    const body = (await get(idleAgent, tenantA)).json().data;
    expect(body.summary.callsAnswered).toBe(0);
    expect(body.summary.closingPct).toBeNull();
    expect(body.summary.averageCallSeconds).toBeNull();
    expect(body.summary.availableSeconds).toBeNull();
    expect(body.summary.followUpsDue).toBe(0);
    expect(body.attention).toEqual([]);
    expect(body.recentCalls).toEqual([]);
    expect(body.standing).toBeNull();
  });

  it('reads YESTERDAY and LAST_7_DAYS, and refuses anything else', async () => {
    const yesterday = (await get(agentA, tenantA, '?period=YESTERDAY')).json().data;
    expect(yesterday.period.key).toBe('YESTERDAY');
    expect(yesterday.period.complete).toBe(true);
    expect(yesterday.summary.callsAnswered).toBe(0);
    expect(yesterday.byHour).toHaveLength(24);
    // Follow-ups are about now, whatever the period.
    expect(yesterday.summary.followUpsDue).toBe(2);

    const week = (await get(agentA, tenantA, '?period=LAST_7_DAYS')).json().data;
    expect(week.byHour).toHaveLength(7);
    expect(week.byHour.every((s: any) => s.hour === null && typeof s.day === 'string')).toBe(true);
    expect(week.summary.callsAnswered).toBe(3);
    expect(week.comparison.label).toBe('the previous 7 days');

    const refused = await get(agentA, tenantA, '?period=THIS_YEAR');
    expect(refused.statusCode).toBe(400);
  });

  it('refuses a caller with no session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/agent/today' });
    expect(response.statusCode).toBe(401);
  });
});
