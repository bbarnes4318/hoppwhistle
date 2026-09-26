/**
 * The team over a span of days.
 *
 * ── The gap ──────────────────────────────────────────────────────────────────
 *
 * `getAgentBreakdown` takes ONE calendar day. An agency owner asking "how did
 * my team do this week" -- or this month, or this pay period -- could not get
 * an answer. `/api/v1/applications/summary` does take a range and breaks down
 * by agent, but it carries no call counts, so it cannot produce a closing
 * percentage, which is the figure the whole business is measured on.
 *
 * ── Why a second function rather than a parameter ────────────────────────────
 *
 * The day view sits on the screen an agency's PRICE is explained from, and it
 * carries live presence and seconds-available -- neither of which means
 * anything across a week. Widening it in place would put every figure on that
 * screen at risk to answer a different question. So the day view is untouched
 * and this is beside it.
 *
 * ── What is asserted ─────────────────────────────────────────────────────────
 *
 *   1. It measures the SAME things the same way -- the Phase 2 predicates,
 *      used verbatim over a wider range -- so a week sums the days in it.
 *   2. Nulls stay null. A closing percentage with no delivered calls behind it
 *      is an absent measurement, and a fabricated 0% on a report somebody pays
 *      people from is worse than a blank.
 *   3. An agent who wrote business but answered no call is still a row. Their
 *      applications are in the agency's numerator, and a missing row reads as
 *      an agent who did nothing.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { getAgentRange } from '../services/billing/delivery-view.js';

const prisma = {
  call: { groupBy: vi.fn() },
  insuranceCarrierApplication: { groupBy: vi.fn() },
  user: { findMany: vi.fn() },
  timeEntry: { groupBy: vi.fn() },
} as unknown as Parameters<typeof getAgentRange>[3] extends { prisma?: infer P }
  ? NonNullable<P>
  : never;

type GroupByMock = Mock<[args: { where: unknown }], Promise<unknown[]>>;

const mocks = prisma as unknown as {
  call: { groupBy: GroupByMock };
  insuranceCarrierApplication: { groupBy: GroupByMock };
  user: { findMany: ReturnType<typeof vi.fn> };
  timeEntry: { groupBy: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.call.groupBy.mockResolvedValue([]);
  mocks.insuranceCarrierApplication.groupBy.mockResolvedValue([]);
  mocks.user.findMany.mockResolvedValue([]);
  mocks.timeEntry.groupBy.mockResolvedValue([]);
});

function user(id: string, first: string) {
  return { id, email: `${id}@agency.test`, firstName: first, lastName: 'Reed' };
}

/* ── The range itself ──────────────────────────────────────────────────────── */

describe('the range', () => {
  it('spans from the first instant of `from` to the first instant after `to`', async () => {
    await getAgentRange('agency-a', '2026-09-01', '2026-09-07', { prisma });

    const where = mocks.call.groupBy.mock.calls[0][0].where as {
      answeredAt: { gte: Date; lt: Date };
    };

    // Half-open, and `to` is INCLUSIVE: a call at 23:59 on the 7th counts.
    expect(where.answeredAt.gte.toISOString()).toBe('2026-09-01T04:00:00.000Z');
    expect(where.answeredAt.lt.toISOString()).toBe('2026-09-08T04:00:00.000Z');
  });

  it('counts the days inclusively', async () => {
    const week = await getAgentRange('agency-a', '2026-09-01', '2026-09-07', { prisma });
    expect(week.days).toBe(7);

    const oneDay = await getAgentRange('agency-a', '2026-09-01', '2026-09-01', { prisma });
    expect(oneDay.days).toBe(1);
  });

  it('uses the same delivered-call and submitted-application predicates', async () => {
    await getAgentRange('agency-a', '2026-09-01', '2026-09-07', { prisma });

    // Verbatim from `services/rating/measurement.ts`, so a week's figures sum
    // the days that compose it rather than measuring something adjacent.
    const callWhere = mocks.call.groupBy.mock.calls[0][0].where as Record<string, unknown>;
    expect(callWhere).toMatchObject({ tenantId: 'agency-a', direction: 'INBOUND', blocked: false });

    const appWhere = mocks.insuranceCarrierApplication.groupBy.mock.calls[0][0].where as Record<
      string,
      unknown
    >;
    // A voided application was never a submitted application.
    expect(appWhere).toMatchObject({ tenantId: 'agency-a', voidedAt: null });
  });

  it('sums hours across the range rather than reading one date', async () => {
    await getAgentRange('agency-a', '2026-09-01', '2026-09-07', { prisma });

    const args = mocks.timeEntry.groupBy.mock.calls[0][0] as {
      by: string[];
      where: { date: { gte: Date; lt: Date } };
      _sum: Record<string, boolean>;
    };
    expect(args.by).toEqual(['userId']);
    expect(args._sum).toEqual({ hoursWorked: true });
    expect(args.where.date.gte).toBeInstanceOf(Date);
  });
});

/* ── The figures ───────────────────────────────────────────────────────────── */

describe('the figures', () => {
  beforeEach(() => {
    mocks.user.findMany.mockResolvedValue([user('u-1', 'Dana'), user('u-2', 'Sam')]);
    mocks.call.groupBy.mockResolvedValue([
      { answeredByUserId: 'u-1', _count: { _all: 50 }, _sum: { connectedDuration: 18_000 } },
      { answeredByUserId: 'u-2', _count: { _all: 20 }, _sum: { connectedDuration: 3_600 } },
    ]);
    mocks.insuranceCarrierApplication.groupBy.mockResolvedValue([
      { createdById: 'u-1', _count: { _all: 5 }, _sum: { annualizedPremium: 6000 } },
      { createdById: 'u-2', _count: { _all: 1 }, _sum: { annualizedPremium: 900 } },
    ]);
    mocks.timeEntry.groupBy.mockResolvedValue([{ userId: 'u-1', _sum: { hoursWorked: 40 } }]);
  });

  it('computes each agents closing percentage over the whole range', async () => {
    const result = await getAgentRange('agency-a', '2026-09-01', '2026-09-07', { prisma });

    const dana = result.agents.find(a => a.userId === 'u-1');
    expect(dana?.callsTaken).toBe(50);
    expect(dana?.applications).toBe(5);
    expect(dana?.closingPct).toBeCloseTo(10);
    expect(dana?.annualizedPremium).toBe(6000);
  });

  it('computes the agency figure over the same range', async () => {
    const result = await getAgentRange('agency-a', '2026-09-01', '2026-09-07', { prisma });

    expect(result.agencyCallsTaken).toBe(70);
    expect(result.agencyApplications).toBe(6);
    expect(result.agencyClosingPct).toBeCloseTo((6 / 70) * 100);
    expect(result.agencyAnnualizedPremium).toBe(6900);
  });

  it('computes occupancy from summed hours', async () => {
    const result = await getAgentRange('agency-a', '2026-09-01', '2026-09-07', { prisma });

    const dana = result.agents.find(a => a.userId === 'u-1');
    // 18000s of talk over 40 recorded hours.
    expect(dana?.hoursWorked).toBe(40);
    expect(dana?.occupancyPct).toBeCloseTo((18_000 / (40 * 3600)) * 100);
  });

  it('leaves occupancy null when no hours were recorded', async () => {
    const result = await getAgentRange('agency-a', '2026-09-01', '2026-09-07', { prisma });

    const sam = result.agents.find(a => a.userId === 'u-2');
    // An agent whose hours were never recorded is not an agent who worked
    // zero. A 0% occupancy would be a coaching decision made on a fabrication.
    expect(sam?.hoursWorked).toBeNull();
    expect(sam?.occupancyPct).toBeNull();
  });

  it('leads with the most productive agent', async () => {
    const result = await getAgentRange('agency-a', '2026-09-01', '2026-09-07', { prisma });

    // A period report answers "what did the team produce", unlike the day
    // view, which is a work list and leads with who needs attention.
    expect(result.agents[0].userId).toBe('u-1');
  });
});

/* ── Nulls stay null ───────────────────────────────────────────────────────── */

describe('an empty range', () => {
  it('reports no closing percentage rather than 0%', async () => {
    const result = await getAgentRange('agency-a', '2026-09-01', '2026-09-07', { prisma });

    expect(result.agencyCallsTaken).toBe(0);
    expect(result.agencyClosingPct).toBeNull();
    expect(result.agents).toEqual([]);
  });
});

/* ── The agent who wrote business but took no call ─────────────────────────── */

describe('an agent with applications and no calls', () => {
  it('is still a row', async () => {
    mocks.user.findMany.mockResolvedValue([user('u-3', 'Kit')]);
    mocks.call.groupBy.mockResolvedValue([]);
    mocks.insuranceCarrierApplication.groupBy.mockResolvedValue([
      { createdById: 'u-3', _count: { _all: 3 }, _sum: { annualizedPremium: 3300 } },
    ]);

    const result = await getAgentRange('agency-a', '2026-09-01', '2026-09-07', { prisma });

    // Their applications are in the agency's numerator; a missing row would
    // read as an agent who did nothing.
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].applications).toBe(3);
    expect(result.agents[0].callsTaken).toBe(0);
    // No calls means no closing percentage, not 0%.
    expect(result.agents[0].closingPct).toBeNull();
    expect(result.agencyApplications).toBe(3);
  });
});

/* ── Calls nobody is recorded on ───────────────────────────────────────────── */

describe('unattributed calls', () => {
  it('are a row, held at the bottom', async () => {
    mocks.user.findMany.mockResolvedValue([user('u-1', 'Dana')]);
    mocks.call.groupBy.mockResolvedValue([
      { answeredByUserId: null, _count: { _all: 9 }, _sum: { connectedDuration: 100 } },
      { answeredByUserId: 'u-1', _count: { _all: 4 }, _sum: { connectedDuration: 500 } },
    ]);
    mocks.insuranceCarrierApplication.groupBy.mockResolvedValue([
      { createdById: 'u-1', _count: { _all: 1 }, _sum: { annualizedPremium: 1200 } },
    ]);

    const result = await getAgentRange('agency-a', '2026-09-01', '2026-09-07', { prisma });

    // It is not a person: nobody can be coached or paid on it, so it never
    // leads the table however it sorts.
    expect(result.agents[result.agents.length - 1].userId).toBeNull();
    expect(result.agents[result.agents.length - 1].name).toBe('Unattributed');
    // But it is still in the agency denominator, or the rows would not add up.
    expect(result.agencyCallsTaken).toBe(13);
  });
});
