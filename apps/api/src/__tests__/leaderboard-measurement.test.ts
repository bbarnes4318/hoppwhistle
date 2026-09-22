/**
 * The board measures what the delivery screen measures.
 *
 * ── The drift this exists to catch ───────────────────────────────────────────
 *
 * `services/rating/measurement.ts` defines a delivered call once -- inbound,
 * answered in the window, not blocked -- and says in its header that nothing in
 * this codebase may redefine either side of the closing percentage. The
 * leaderboard has to express that same predicate a SECOND time, in SQL, because
 * `COUNT(DISTINCT ...)` over a normalised caller id is not expressible through
 * Prisma's query API and the count has to happen in the database.
 *
 * Two expressions of one definition drift. The failure is silent and slow: the
 * board would simply begin reporting a different closing percentage from
 * `/delivery/agents`, for the same agent on the same day, and the first person
 * to notice would be an agency disputing the invoice that figure prices.
 *
 * So this reads both and fails if they stop agreeing. It is deliberately
 * written to break on an ADDITION as well as a change -- a new condition in
 * `deliveredCallWhere` that the SQL does not carry is exactly the drift being
 * guarded against.
 */

import { describe, expect, it, vi } from 'vitest';

import { deliveredCallSql, getLeaderboard } from '../services/leaderboard/leaderboard.js';
import { resolvePeriod } from '../services/leaderboard/period.js';
import { deliveredCallWhere } from '../services/rating/measurement.js';

const RANGE = {
  start: new Date('2026-09-22T04:00:00.000Z'),
  endExclusive: new Date('2026-09-23T04:00:00.000Z'),
};

describe('the two expressions of a delivered call', () => {
  it('filter on exactly the same four things', () => {
    const where = deliveredCallWhere('agency-a', RANGE);

    // If a fifth key appears here, the SQL below has to grow a fifth condition
    // and this assertion is the thing that says so.
    expect(Object.keys(where).sort()).toEqual(['answeredAt', 'blocked', 'direction', 'tenantId']);
    expect(where.direction).toBe('INBOUND');
    expect(where.blocked).toBe(false);

    const sql = deliveredCallSql('agency-a', RANGE).sql;
    expect(sql).toContain('c."tenantId" =');
    expect(sql).toContain(`c."direction" = 'INBOUND'`);
    expect(sql).toContain('c."blocked" = false');
    expect(sql).toContain('c."answeredAt" >=');
    expect(sql).toContain('c."answeredAt" <');
  });

  it('binds the tenant and both instants as parameters, never as literals', () => {
    const fragment = deliveredCallSql('agency-a', RANGE);

    // A tenant id interpolated into SQL text is the bug class this whole file
    // would otherwise invite.
    expect(fragment.values).toEqual(['agency-a', RANGE.start, RANGE.endExclusive]);
    expect(fragment.sql).not.toContain('agency-a');
  });

  it('is half-open on the same bounds the measurement uses', () => {
    const where = deliveredCallWhere('agency-a', RANGE) as {
      answeredAt: { gte: Date; lt: Date };
    };
    expect(where.answeredAt.gte).toEqual(RANGE.start);
    expect(where.answeredAt.lt).toEqual(RANGE.endExclusive);

    // `gte`/`lt`, matching `>=`/`<` in the SQL: a call at the first instant of
    // the next day belongs to the next day, in both expressions.
    expect(deliveredCallSql('agency-a', RANGE).values[1]).toEqual(RANGE.start);
    expect(deliveredCallSql('agency-a', RANGE).values[2]).toEqual(RANGE.endExclusive);
  });
});

/* ── The assembled board ───────────────────────────────────────────────────── */

/**
 * A Prisma stand-in.
 *
 * `$queryRaw` is a tagged template, so the mock reads the template text to work
 * out which of the three raw reads it is answering. Keying on call ORDER would
 * make the fixtures silently wrong the first time a `Promise.all` is
 * reordered.
 */
function fakePrisma(fixtures: {
  inbound?: unknown[];
  agencyInbound?: unknown[];
  outbound?: unknown[];
  applications?: unknown[];
  applicationCount?: number;
  users?: unknown[];
  timeEntries?: unknown[];
  streakRows?: unknown[];
}) {
  const queryRaw = vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join(' ');
    if (text.includes('answeredByUserId')) return Promise.resolve(fixtures.inbound ?? []);
    if (text.includes('createdById')) return Promise.resolve(fixtures.outbound ?? []);
    return Promise.resolve(fixtures.agencyInbound ?? []);
  });

  return {
    $queryRaw: queryRaw,
    insuranceCarrierApplication: {
      groupBy: vi.fn().mockResolvedValue(fixtures.applications ?? []),
      count: vi.fn().mockResolvedValue(fixtures.applicationCount ?? 0),
      findMany: vi.fn().mockResolvedValue(fixtures.streakRows ?? []),
    },
    user: { findMany: vi.fn().mockResolvedValue(fixtures.users ?? []) },
    timeEntry: { groupBy: vi.fn().mockResolvedValue(fixtures.timeEntries ?? []) },
  } as unknown as NonNullable<Parameters<typeof getLeaderboard>[2]>['prisma'];
}

const NOW = new Date('2026-09-22T16:00:00.000Z');

describe('the assembled board', () => {
  it('ranks an agency s own agents and marks the caller s row', async () => {
    const prisma = fakePrisma({
      inbound: [
        { userId: 'u1', inboundCalls: 40, uniqueInboundCallers: 30, talkTimeSeconds: 6_000 },
        { userId: 'u2', inboundCalls: 20, uniqueInboundCallers: 18, talkTimeSeconds: 3_000 },
      ],
      agencyInbound: [{ inboundCalls: 60, uniqueInboundCallers: 44, talkTimeSeconds: 9_000 }],
      outbound: [{ userId: 'u2', outboundCalls: 100, outboundConnected: 25 }],
      applications: [
        { createdById: 'u1', _count: { _all: 5 }, _sum: { annualizedPremium: 4_200 } },
        { createdById: 'u2', _count: { _all: 1 }, _sum: { annualizedPremium: 800 } },
      ],
      applicationCount: 6,
      users: [
        { id: 'u1', email: 'dana@agency.test', firstName: 'Dana', lastName: 'Reed' },
        { id: 'u2', email: 'sam@agency.test', firstName: 'Sam', lastName: 'Ortiz' },
      ],
    });

    const board = await getLeaderboard('agency-a', resolvePeriod('TODAY', { now: NOW }), {
      prisma,
      now: NOW,
      viewerId: 'u2',
    });

    expect(board.rows.map(row => row.userId)).toEqual(['u1', 'u2']);
    expect(board.rows[0].rank).toBe(1);
    expect(board.you?.rank).toBe(2);
    expect(board.you?.row?.name).toBe('Sam Ortiz');
  });

  it('carries the conversion rate and the priced closing percentage apart', async () => {
    const prisma = fakePrisma({
      inbound: [{ userId: 'u1', inboundCalls: 40, uniqueInboundCallers: 20, talkTimeSeconds: 0 }],
      agencyInbound: [{ inboundCalls: 40, uniqueInboundCallers: 20, talkTimeSeconds: 0 }],
      applications: [{ createdById: 'u1', _count: { _all: 4 }, _sum: { annualizedPremium: 0 } }],
      applicationCount: 4,
      users: [{ id: 'u1', email: 'dana@agency.test', firstName: 'Dana', lastName: 'Reed' }],
    });

    const board = await getLeaderboard('agency-a', resolvePeriod('TODAY', { now: NOW }), {
      prisma,
      now: NOW,
    });

    // Two different fractions over the same numerator. Conversion is the
    // higher of the two by construction, because its denominator is smaller.
    expect(board.rows[0].conversionPct).toBeCloseTo(20); // 4 / 20 unique callers
    expect(board.rows[0].closingPct).toBeCloseTo(10); // 4 / 40 delivered calls
  });

  it('reports a rate with nothing behind it as null, never 0%', async () => {
    const prisma = fakePrisma({
      // An agent who wrote business without answering a call: a callback taken
      // on a mobile, business written from paper.
      applications: [{ createdById: 'u1', _count: { _all: 2 }, _sum: { annualizedPremium: 500 } }],
      applicationCount: 2,
      agencyInbound: [{ inboundCalls: 0, uniqueInboundCallers: 0, talkTimeSeconds: 0 }],
      users: [{ id: 'u1', email: 'dana@agency.test', firstName: 'Dana', lastName: 'Reed' }],
    });

    const board = await getLeaderboard('agency-a', resolvePeriod('TODAY', { now: NOW }), {
      prisma,
      now: NOW,
    });

    expect(board.rows[0].applications).toBe(2);
    expect(board.rows[0].conversionPct).toBeNull();
    expect(board.rows[0].closingPct).toBeNull();
    expect(board.agency.conversionPct).toBeNull();
  });

  it('keeps delivered calls with no agent on them, unranked', async () => {
    const prisma = fakePrisma({
      inbound: [
        { userId: 'u1', inboundCalls: 10, uniqueInboundCallers: 10, talkTimeSeconds: 0 },
        { userId: null, inboundCalls: 7, uniqueInboundCallers: 7, talkTimeSeconds: 0 },
      ],
      agencyInbound: [{ inboundCalls: 17, uniqueInboundCallers: 17, talkTimeSeconds: 0 }],
      users: [{ id: 'u1', email: 'dana@agency.test', firstName: 'Dana', lastName: 'Reed' }],
    });

    const board = await getLeaderboard('agency-a', resolvePeriod('TODAY', { now: NOW }), {
      prisma,
      now: NOW,
    });

    // Dropping it would make the rows fail to add up to the agency's own
    // figure, on a screen people compare against the delivery page.
    const unattributed = board.rows.find(row => row.userId === null);
    expect(unattributed?.inboundCalls).toBe(7);
    expect(unattributed?.rank).toBeNull();
    expect(unattributed?.badges).toEqual([]);

    const summed = board.rows.reduce((total, row) => total + row.inboundCalls, 0);
    expect(summed).toBe(board.agency.inboundCalls);
  });

  it('measures the agency s unique callers itself rather than summing the rows', async () => {
    const prisma = fakePrisma({
      inbound: [
        { userId: 'u1', inboundCalls: 10, uniqueInboundCallers: 10, talkTimeSeconds: 0 },
        { userId: 'u2', inboundCalls: 10, uniqueInboundCallers: 10, talkTimeSeconds: 0 },
      ],
      // One caller reached both agents: two agent-opportunities, nineteen
      // agency-opportunities. Summing the rows would say twenty.
      agencyInbound: [{ inboundCalls: 20, uniqueInboundCallers: 19, talkTimeSeconds: 0 }],
      users: [
        { id: 'u1', email: 'a@agency.test', firstName: 'A', lastName: 'One' },
        { id: 'u2', email: 'b@agency.test', firstName: 'B', lastName: 'Two' },
      ],
    });

    const board = await getLeaderboard('agency-a', resolvePeriod('TODAY', { now: NOW }), {
      prisma,
      now: NOW,
    });

    expect(board.agency.uniqueInboundCallers).toBe(19);
  });

  it('withholds a period-on-period change while the period is still open', async () => {
    const prisma = fakePrisma({
      agencyInbound: [{ inboundCalls: 5, uniqueInboundCallers: 5, talkTimeSeconds: 0 }],
      applicationCount: 1,
      users: [],
    });

    const open = await getLeaderboard('agency-a', resolvePeriod('TODAY', { now: NOW }), {
      prisma,
      now: NOW,
    });
    // A Tuesday morning against the whole of yesterday always reads as a
    // collapse. Rank movement survives the comparison; totals do not.
    expect(open.period.complete).toBe(false);
    expect(open.agencyChange).toBeNull();

    const closed = await getLeaderboard('agency-a', resolvePeriod('YESTERDAY', { now: NOW }), {
      prisma,
      now: NOW,
    });
    expect(closed.period.complete).toBe(true);
    expect(closed.agencyChange).not.toBeNull();
  });

  it('never reads another agency s payroll to fill the hours column', async () => {
    const prisma = fakePrisma({
      users: [{ id: 'u1', email: 'dana@agency.test', firstName: 'Dana', lastName: 'Reed' }],
      agencyInbound: [{ inboundCalls: 0, uniqueInboundCallers: 0, talkTimeSeconds: 0 }],
    });

    await getLeaderboard('agency-a', resolvePeriod('TODAY', { now: NOW }), { prisma, now: NOW });

    // `time_entries` has no tenant column -- it hangs off the user -- so the
    // narrowing has to be in the query, not after it.
    const args = (prisma as unknown as { timeEntry: { groupBy: { mock: { calls: unknown[][] } } } })
      .timeEntry.groupBy.mock.calls[0][0] as { where: { userId: { in: string[] } } };
    expect(args.where.userId.in).toEqual(['u1']);
  });

  it('serves its own scoring rules so the screen can show its working', async () => {
    const prisma = fakePrisma({
      agencyInbound: [{ inboundCalls: 0, uniqueInboundCallers: 0, talkTimeSeconds: 0 }],
      users: [],
    });

    const board = await getLeaderboard('agency-a', resolvePeriod('TODAY', { now: NOW }), {
      prisma,
      now: NOW,
    });

    // A board people are ranked on with an unexplained score is one they stop
    // believing.
    expect(board.scoring.points.perApplication).toBeGreaterThan(0);
    expect(board.scoring.badges.length).toBeGreaterThan(0);
  });
});
