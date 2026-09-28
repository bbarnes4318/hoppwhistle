/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await -- assertions run over parsed JSON responses, which are dynamically typed; the Redis fake is async to match the client */
import { CallDirection, CallStatus, Prisma, RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerStaffOnly } from '../middleware/staff-only.js';
import { resolvePeriod } from '../services/leaderboard/period.js';
import { getAgencyLiveBoard } from '../services/live/agency-board.js';
import {
  calendarDayBounds,
  currentCalendarDay,
  shiftCalendarDay,
} from '../services/rating/calendar-day.js';
import { getCallSalesSummary } from '../services/reporting/call-sales.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The white-label Today screen against a real database.
 *
 * Redis is an in-memory fake, so the suite controls the agents' softphone
 * statuses (the roster's `agent:status:<id>` keys), can see the 15-second
 * cache key being written, and can make Redis fail to prove the screen falls
 * through to the database.
 *
 * The figures are checked two ways: against the functions they are documented
 * to come from (the Live Board and the Sales summary for TODAY), and by hand on
 * a fixture small enough to count.
 */

const redis = vi.hoisted(() => ({
  store: new Map<string, string>(),
  failing: false,
  sets: [] as Array<{ key: string; args: unknown[] }>,
}));

vi.mock('../services/redis.js', () => ({
  getRedisClient: () => ({
    get: async (key: string) => {
      if (redis.failing) throw new Error('redis down');
      return redis.store.get(key) ?? null;
    },
    set: async (key: string, value: string, ...args: unknown[]) => {
      if (redis.failing) throw new Error('redis down');
      redis.store.set(key, value);
      redis.sets.push({ key, args });
      return 'OK';
    },
    mget: async (keys: string[]) => {
      if (redis.failing) throw new Error('redis down');
      return keys.map(key => redis.store.get(key) ?? null);
    },
    del: async (key: string) => (redis.store.delete(key) ? 1 : 0),
  }),
  closeRedisClient: async () => {},
}));

const gate = databaseGate();
announceSkip('White-label Today', gate);

const TEST_JWT_SECRET = 'white-label-today-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('White-label Today suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `white-label today suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('GET /api/v1/white-label/today', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let seq = 0;

  let wl: {
    id: string;
    ownerId: string;
    agents: { ready: string; onCall: string; away: string; offline: string };
    buyers: { atCap: string; monthly: string; uncapped: string; paused: string };
    publisherId: string;
  };
  let normal: { id: string; ownerId: string };

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerStaffOnly(instance);
    const { registerWhiteLabelTodayRoutes } = await import('../routes/white-label-today.js');
    const { registerAuthRoutes } = await import('../routes/auth.js');
    await instance.register(registerWhiteLabelTodayRoutes);
    await instance.register(registerAuthRoutes);
    await instance.ready();
    return instance;
  }

  function get(userId: string, tenantId: string, url = '/api/v1/white-label/today') {
    return app.inject({
      method: 'GET',
      url,
      headers: {
        authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${userId}@test.local` })}`,
      },
    });
  }

  /**
   * `msAgo` before now, but never before the start of today on the platform's
   * clock. Fixtures written a couple of minutes back would otherwise land on
   * YESTERDAY for the first two minutes after midnight in New York, and the
   * TODAY figures under test would read zero.
   */
  function earlierToday(msAgo: number): Date {
    const startOfToday = resolvePeriod('TODAY').start.getTime();
    return new Date(Math.max(Date.now() - msAgo, startOfToday + 1));
  }

  async function call(tenantId: string, data: Partial<Prisma.CallUncheckedCreateInput> = {}) {
    return (
      await prisma.call.create({
        data: {
          tenantId,
          toNumber: '+15550000000',
          callSid: `today-${++seq}-${Date.now()}`,
          status: CallStatus.COMPLETED,
          direction: CallDirection.INBOUND,
          createdAt: earlierToday(120_000),
          ...data,
        },
      })
    ).id;
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
    redis.sets.length = 0;
    redis.failing = false;

    for (const table of ['audit_logs', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
    const roleIds: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.AGENT]) {
      roleIds[name] = (
        await prisma.role.create({ data: { name, description: `${name} role`, permissions: [] } })
      ).id;
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = async (
      tenantId: string,
      role: RoleName,
      label: string,
      extra: Partial<Prisma.UserUncheckedCreateInput> = {}
    ) =>
      (
        await prisma.user.create({
          data: {
            tenantId,
            email: `${label}-${stamp}@agency.local`,
            status: 'ACTIVE',
            roles: { create: { roleId: roleIds[role] } },
            ...extra,
          },
        })
      ).id;

    const tenant = await prisma.tenant.create({
      data: {
        name: 'Life Leads Plus',
        slug: `llp-${stamp}`,
        status: 'ACTIVE',
        whiteLabel: true,
        metadata: { upgrades: ['VOICE_STUDIO', 'NOT_AN_UPGRADE', 'POWER_DIALER'] },
      },
    });
    const tenantId = tenant.id;
    const publisherId = (
      await prisma.publisher.create({ data: { tenantId, name: 'Alpha', code: `p-${stamp}` } })
    ).id;
    const campaignId = (
      await prisma.campaign.create({ data: { tenantId, publisherId, name: 'Final Expense' } })
    ).id;

    /*
     * Four ACTIVE agents, one per presence. Only `ready` is fully set up
     * (licensed, on a campaign, forwarding to a cell), so the other three each
     * have a roster blocker. A suspended agent is not counted at all.
     */
    const setUp = { licensedStates: ['TX'], cellForwardNumber: '+15125550111' };
    const agents = {
      ready: await user(tenantId, RoleName.AGENT, 'ready', { metadata: setUp }),
      onCall: await user(tenantId, RoleName.AGENT, 'oncall'),
      away: await user(tenantId, RoleName.AGENT, 'away'),
      offline: await user(tenantId, RoleName.AGENT, 'offline'),
    };
    await user(tenantId, RoleName.AGENT, 'suspended', { status: 'SUSPENDED' });
    await prisma.campaignAgent.create({ data: { tenantId, campaignId, userId: agents.ready } });
    redis.store.set(`agent:status:${agents.ready}`, JSON.stringify({ status: 'Available' }));
    redis.store.set(`agent:status:${agents.onCall}`, JSON.stringify({ status: 'ON_CALL' }));
    redis.store.set(`agent:status:${agents.away}`, JSON.stringify({ status: 'away' }));

    async function buyer(
      name: string,
      status: 'ACTIVE' | 'PAUSED',
      consumed: number,
      endpoints: Array<{ maxCap: number; capPeriod: 'DAY' | 'MONTH' | 'HOUR'; active?: boolean }>
    ) {
      const row = await prisma.buyer.create({
        data: { tenantId, name, code: `${name}-${stamp}`, status },
      });
      await prisma.buyerStats.create({ data: { buyerId: row.id, capConsumedToday: consumed } });
      for (const [i, ep] of endpoints.entries()) {
        await prisma.buyerEndpoint.create({
          data: {
            buyerId: row.id,
            name: `${name} ${i}`,
            type: 'PSTN',
            destination: '+15125550000',
            maxCap: ep.maxCap,
            capPeriod: ep.capPeriod,
            status: ep.active === false ? 'INACTIVE' : 'ACTIVE',
          },
        });
      }
      return row.id;
    }

    const buyers = {
      // Two active DAY endpoints, 3 + 2 = a cap of 5, and 5 used: at cap. The
      // inactive DAY endpoint does not add to the cap.
      atCap: await buyer('Acme', 'ACTIVE', 5, [
        { maxCap: 3, capPeriod: 'DAY' },
        { maxCap: 2, capPeriod: 'DAY' },
        { maxCap: 50, capPeriod: 'DAY', active: false },
      ]),
      // A monthly cap is not a daily one: never at today's cap.
      monthly: await buyer('Monthly', 'ACTIVE', 10, [{ maxCap: 5, capPeriod: 'MONTH' }]),
      // maxCap 0 is "no cap", not "a cap of zero".
      uncapped: await buyer('Uncapped', 'ACTIVE', 3, [{ maxCap: 0, capPeriod: 'DAY' }]),
      // Over its cap, but paused: not an active buyer, so not counted as one.
      paused: await buyer('Paused', 'PAUSED', 2, [{ maxCap: 1, capPeriod: 'DAY' }]),
    };

    /* ── Today's calls ─────────────────────────────────────────────────────── */
    const minuteAgo = earlierToday(60_000);
    const delivered = await call(tenantId, {
      buyerId: buyers.atCap,
      publisherId,
      answeredAt: minuteAgo,
      billable: true,
      buyerBillableAmount: new Prisma.Decimal('40'),
      publisherPayoutAmount: new Prisma.Decimal('12.5'),
      publisherPayoutStatus: 'PAYABLE',
      cost: new Prisma.Decimal('0.5'),
    });
    await call(tenantId, {
      publisherId,
      answeredByUserId: agents.ready,
      answeredAt: minuteAgo,
      publisherPayoutAmount: new Prisma.Decimal('7.5'),
      publisherPayoutStatus: 'PAYABLE',
    });
    // Up right now, to the monthly buyer.
    await call(tenantId, {
      buyerId: buyers.monthly,
      status: CallStatus.ANSWERED,
      endedAt: null,
      answeredAt: minuteAgo,
    });
    await call(tenantId, { blocked: true });
    await call(tenantId, {}); // unanswered
    // A return waiting for a decision, and one already decided.
    await call(tenantId, { buyerId: buyers.uncapped, disputeStatus: 'DISPUTED' });
    await call(tenantId, { buyerId: buyers.uncapped, disputeStatus: 'DENIED' });

    await prisma.insuranceCarrierApplication.create({
      data: {
        tenantId,
        firstName: 'Test',
        lastName: 'Applicant',
        callId: delivered,
        submittedAt: earlierToday(30_000),
      },
    });

    wl = {
      id: tenantId,
      ownerId: await user(tenantId, RoleName.OWNER, 'owner'),
      agents,
      buyers,
      publisherId,
    };

    /* ── A normal agency beside it, with traffic that would show if it leaked ── */
    const ridge = await prisma.tenant.create({
      data: { name: 'Ridgeline', slug: `ridge-${stamp}`, status: 'ACTIVE' },
    });
    normal = { id: ridge.id, ownerId: await user(ridge.id, RoleName.OWNER, 'ridge-owner') };
    for (let i = 0; i < 4; i++) {
      await call(ridge.id, { answeredAt: minuteAgo, disputeStatus: 'DISPUTED' });
    }
  });

  it('matches the Live Board and the Sales summary for today', async () => {
    const response = await get(wl.ownerId, wl.id);
    expect(response.statusCode, response.body).toBe(200);
    const data = response.json().data;

    const board = await getAgencyLiveBoard(wl.id, { prisma });
    const sales = await getCallSalesSummary(wl.id, resolvePeriod('TODAY'), { prisma });

    expect(data.now.callsUp).toBe(board.totals.callsInFlight);
    expect(data.today).toMatchObject({
      inbound: sales.totals.inboundCalls,
      answeredByAgents: sales.totals.answeredByAgents,
      sentToBuyers: sales.totals.sentToBuyers,
      unanswered: sales.disposition.unanswered,
      blocked: sales.totals.blocked,
      revenue: sales.totals.revenue,
      profit: sales.totals.profit,
      applications: board.totals.applicationsToday,
      closingPct: board.totals.closingPct,
      billable: sales.totals.billable,
    });

    const boardBuyers = board.rows.filter(row => row.kind === 'buyer');
    // Every buyer on the board, busiest first rather than in the board's order.
    expect(data.buyers.map((row: any) => row.id).sort()).toEqual(
      boardBuyers.map(row => row.id).sort()
    );
    const revenues = data.buyers.map((row: any) => row.revenue);
    expect(revenues).toEqual([...revenues].sort((a: number, b: number) => b - a));
    for (const row of data.buyers) {
      const source = boardBuyers.find(b => b.id === row.id)!;
      expect(row).toMatchObject(source);
      expect(Object.keys(row).sort()).toEqual(
        [
          ...Object.keys(source),
          'atCap',
          'capUsed',
          'capMax',
          'calls',
          'billable',
          'revenue',
        ].sort()
      );
    }
  });

  it("carries each buyer's calls, billable calls and revenue from the Sales summary's byBuyer", async () => {
    const data = (await get(wl.ownerId, wl.id)).json().data;
    const sales = await getCallSalesSummary(wl.id, resolvePeriod('TODAY'), { prisma });
    const byBuyer = new Map(sales.byBuyer.map(row => [row.buyerId, row]));

    expect(data.buyers.length).toBeGreaterThan(0);
    for (const row of data.buyers) {
      expect(row.calls).toBe(byBuyer.get(row.id)?.calls ?? 0);
      expect(row.billable).toBe(byBuyer.get(row.id)?.billable ?? 0);
      expect(row.revenue).toBe(byBuyer.get(row.id)?.revenue ?? 0);
    }
    // By hand: Acme's one billable $40 call; the monthly buyer's live call is not billable.
    const row = (id: string) => data.buyers.find((r: any) => r.id === id);
    expect(row(wl.buyers.atCap)).toMatchObject({ calls: 1, billable: 1, revenue: 40 });
    expect(row(wl.buyers.monthly)).toMatchObject({ calls: 1, billable: 0, revenue: 0 });
    // Still there for older clients.
    expect(row(wl.buyers.atCap)).toHaveProperty('applicationsToday');
    expect(row(wl.buyers.atCap)).toHaveProperty('closingPct');
  });

  it('answers the hand-counted fixture', async () => {
    const data = (await get(wl.ownerId, wl.id)).json().data;

    expect(data.now).toEqual({
      callsUp: 1,
      agentsReady: 1,
      agentsOnCall: 1,
      agentsActive: 4,
      buyersTaking: 2,
      buyersAtCap: 1,
      buyersActive: 3,
      returnsOpen: 1,
    });
    expect(data.today).toMatchObject({
      inbound: 7,
      answeredByAgents: 1,
      sentToBuyers: 4,
      blocked: 1,
      revenue: 40,
      applications: 1,
      closingPct: 33.33,
    });

    expect(data.attention).toEqual([
      {
        kind: 'returns',
        count: 1,
        href: '/buyers?tab=returns',
        label: 'Returns waiting for a decision',
      },
      { kind: 'buyers_at_cap', count: 1, href: '/buyers', label: "Buyers at today's cap" },
      {
        kind: 'agents_blocked',
        count: 3,
        href: '/agents?tab=roster',
        label: "Agents who can't take calls",
      },
      {
        kind: 'payouts_owed',
        count: 2,
        href: '/publishers?tab=payouts',
        label: 'Owed to publishers',
        amount: 20,
      },
    ]);
  });

  it('holds the at-cap rule: maxCap > 0, DAY, consumed >= max', async () => {
    const rows = (await get(wl.ownerId, wl.id)).json().data.buyers;
    const row = (id: string) => rows.find((r: any) => r.id === id);

    expect(row(wl.buyers.atCap)).toMatchObject({ atCap: true, capUsed: 5, capMax: 5 });
    expect(row(wl.buyers.monthly)).toMatchObject({ atCap: false, capUsed: 10, capMax: null });
    expect(row(wl.buyers.uncapped)).toMatchObject({ atCap: false, capUsed: 3, capMax: null });
    expect(row(wl.buyers.paused)).toMatchObject({ atCap: true, capUsed: 2, capMax: 1 });

    // One under the cap is taking calls again.
    await prisma.buyerStats.update({
      where: { buyerId: wl.buyers.atCap },
      data: { capConsumedToday: 4 },
    });
    redis.store.clear();
    const after = (await get(wl.ownerId, wl.id)).json().data;
    expect(after.buyers.find((r: any) => r.id === wl.buyers.atCap).atCap).toBe(false);
    expect(after.now).toMatchObject({ buyersAtCap: 0, buyersTaking: 3 });
    expect(after.attention.map((a: any) => a.kind)).not.toContain('buyers_at_cap');
  });

  it('leaves out an attention item whose count is zero', async () => {
    await prisma.call.updateMany({
      where: { tenantId: wl.id, disputeStatus: 'DISPUTED' },
      data: { disputeStatus: 'ACCEPTED' },
    });
    await prisma.call.updateMany({
      where: { tenantId: wl.id, publisherPayoutStatus: 'PAYABLE' },
      data: { publisherPayoutStatus: 'PAID' },
    });
    const data = (await get(wl.ownerId, wl.id)).json().data;
    expect(data.now.returnsOpen).toBe(0);
    expect(data.attention.map((a: any) => a.kind)).toEqual(['buyers_at_cap', 'agents_blocked']);
  });

  it('caches per tenant for fifteen seconds', async () => {
    const first = (await get(wl.ownerId, wl.id)).json().data;
    expect(redis.sets).toEqual([{ key: `wl:today:${wl.id}:TODAY`, args: ['EX', 15] }]);

    await call(wl.id, { disputeStatus: 'DISPUTED' });
    const second = (await get(wl.ownerId, wl.id)).json().data;
    expect(second).toEqual(first);
    expect(second.now.returnsOpen).toBe(1);
  });

  it('falls through to the database when Redis fails', async () => {
    redis.failing = true;
    const response = await get(wl.ownerId, wl.id);
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.now.returnsOpen).toBe(1);
    // Every softphone status is unreadable, so nobody reads as ready.
    expect(data.now).toMatchObject({ agentsActive: 4, agentsReady: 0, agentsOnCall: 0 });
  });

  it('refuses a normal agency owner with 403', async () => {
    expect((await get(normal.ownerId, normal.id)).statusCode).toBe(403);
  });

  it('/api/auth/me carries the tenant upgrades, known keys only', async () => {
    expect((await get(wl.ownerId, wl.id, '/api/auth/me')).json().upgrades).toEqual([
      'VOICE_STUDIO',
      'POWER_DIALER',
    ]);
    expect((await get(normal.ownerId, normal.id, '/api/auth/me')).json().upgrades).toEqual([]);
  });
  it('names why the agents who cannot take calls cannot, most common first', async () => {
    const data = (await get(wl.ownerId, wl.id)).json().data;
    // onCall, away and offline have no licensed states; ready is fully set up.
    expect(data.agentBlockers).toEqual([
      { code: 'NO_LICENSED_STATES', reason: 'No licensed states recorded', count: 3 },
    ]);
    expect(data.agents.map((a: any) => a.presence)).toEqual([
      'READY',
      'ON_CALL',
      'AWAY',
      'OFFLINE',
    ]);
  });

  it('says how many returns wait, since when, and what is owed to how many publishers', async () => {
    const data = (await get(wl.ownerId, wl.id)).json().data;
    expect(data.returnsWaiting.count).toBe(1);
    expect(typeof data.returnsWaiting.oldestAt).toBe('string');
    expect(data.owedToPublishers).toEqual({ amount: 20, publishers: 1, calls: 2 });
  });

  it('refuses a period it does not know, and caches each period on its own', async () => {
    expect(
      (await get(wl.ownerId, wl.id, '/api/v1/white-label/today?period=LAST_YEAR')).statusCode
    ).toBe(400);
    const response = await get(wl.ownerId, wl.id, '/api/v1/white-label/today?period=YESTERDAY');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.period.key).toBe('YESTERDAY');
    expect(redis.sets.map(set => set.key)).toEqual([`wl:today:${wl.id}:YESTERDAY`]);
  });

  describe('by hour, against a comparison, over a trend', () => {
    /*
     * A clock fixed at 15:00 New York today, and a tenant of its own whose
     * calls sit at hours chosen to land in known slots.
     */
    const today = currentCalendarDay();
    const yesterday = shiftCalendarDay(today, -1);
    const at = (day: string, hour: number, minute = 0) =>
      new Date(calendarDayBounds(day).start.getTime() + (hour * 60 + minute) * 60_000);
    const now = at(today, 15);

    let tenantId: string;

    beforeEach(async () => {
      const tenant = await prisma.tenant.create({
        data: { name: 'Hours', slug: `hours-${Date.now()}`, status: 'ACTIVE', whiteLabel: true },
      });
      tenantId = tenant.id;
      const agent = await prisma.user.create({
        data: { tenantId, email: `hours-agent-${Date.now()}@agency.local`, status: 'ACTIVE' },
      });
      const buyer = await prisma.buyer.create({
        data: { tenantId, name: 'Hours Buyer', code: `hours-${Date.now()}` },
      });
      const agentCall = await call(tenantId, {
        createdAt: at(today, 9, 10),
        answeredAt: at(today, 9, 11),
        answeredByUserId: agent.id,
      });
      await call(tenantId, { createdAt: at(today, 10, 20), buyerId: buyer.id });
      await call(tenantId, { createdAt: at(today, 10, 40) });
      await call(tenantId, { createdAt: at(today, 11), blocked: true });
      // Yesterday: one before 15:00, one after. Only the first is "same time yesterday".
      await call(tenantId, { createdAt: at(yesterday, 9, 30) });
      await call(tenantId, { createdAt: at(yesterday, 16) });
      await call(tenantId, { createdAt: at(shiftCalendarDay(today, -3), 12) });
      await prisma.insuranceCarrierApplication.create({
        data: {
          tenantId,
          firstName: 'Hour',
          lastName: 'Applicant',
          callId: agentCall,
          submittedAt: at(today, 9, 30),
        },
      });
    });

    const read = async (period: 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS') => {
      const { getWhiteLabelToday } = await import('../routes/white-label-today.js');
      return getWhiteLabelToday(tenantId, {
        prisma,
        now,
        period,
        readStatuses: async () => new Map(),
      });
    };

    it('puts each call in its New York hour, one outcome each, beside yesterday', async () => {
      const data = await read('TODAY');
      expect(data.byHour).toHaveLength(24);
      expect(data.byHour.map(slot => slot.hour)).toEqual([...Array(24).keys()]);
      expect(data.byHour[9]).toMatchObject({ agents: 1, buyers: 0, unanswered: 0, comparison: 1 });
      expect(data.byHour[10]).toMatchObject({ buyers: 1, unanswered: 1, comparison: 0 });
      expect(data.byHour[11]).toMatchObject({ blocked: 1 });
      // The dashed line is the whole of yesterday.
      expect(data.byHour[16]).toMatchObject({ comparison: 1, agents: 0, buyers: 0 });
      const sum = data.byHour.reduce(
        (total, slot) => total + slot.agents + slot.buyers + slot.unanswered + slot.blocked,
        0
      );
      expect(sum).toBe(data.today.inbound);
    });

    it('compares today with yesterday up to the same clock time', async () => {
      const data = await read('TODAY');
      expect(data.today).toMatchObject({ inbound: 4, applications: 1, blocked: 1 });
      expect(data.comparison).toMatchObject({
        label: 'same time yesterday',
        from: yesterday,
        inbound: 1,
        applications: 0,
      });
    });

    it('compares yesterday with the whole day before it', async () => {
      const data = await read('YESTERDAY');
      expect(data.period).toMatchObject({ key: 'YESTERDAY', from: yesterday, to: yesterday });
      expect(data.today.inbound).toBe(2);
      expect(data.comparison).toMatchObject({ label: 'the day before', inbound: 0 });
      expect(data.byHour[9].unanswered).toBe(1);
      expect(data.byHour[16].unanswered).toBe(1);
    });

    it('gives seven daily rows for the last seven days', async () => {
      const data = await read('LAST_7_DAYS');
      expect(data.byHour).toHaveLength(7);
      expect(data.byHour.map(slot => slot.day)).toEqual(
        [6, 5, 4, 3, 2, 1, 0].map(n => shiftCalendarDay(today, -n))
      );
      expect(data.today.inbound).toBe(7);
      expect(data.comparison.label).toBe('the previous 7 days');
    });

    it('trends the last seven days ending today, whatever the period', async () => {
      for (const period of ['TODAY', 'YESTERDAY', 'LAST_7_DAYS'] as const) {
        const { trend } = await read(period);
        expect(trend.map(row => row.day)).toEqual(
          [6, 5, 4, 3, 2, 1, 0].map(n => shiftCalendarDay(today, -n))
        );
        expect(trend[6]).toMatchObject({ inbound: 4, applications: 1 });
        expect(trend[5]).toMatchObject({ inbound: 2, applications: 0 });
        expect(trend[3]).toMatchObject({ inbound: 1 });
        expect(trend[0]).toMatchObject({ inbound: 0, revenue: 0 });
      }
    });

    it('keeps its shape when the period has no calls at all', async () => {
      await prisma.call.deleteMany({ where: { tenantId, createdAt: { gte: at(today, 0) } } });
      const data = await read('TODAY');
      expect(data.today.inbound).toBe(0);
      expect(data.byHour).toHaveLength(24);
      expect(data.comparison.inbound).toBe(1);
      expect(data.trend[5].inbound).toBe(2);
    });
  });
});
