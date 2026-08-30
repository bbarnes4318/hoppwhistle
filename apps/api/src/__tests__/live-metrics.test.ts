import { Prisma } from '@prisma/client';
import { describe, it, expect } from 'vitest';

import { computeLiveMetrics, resolveRole } from '../routes/live-metrics.js';

/**
 * These run without a database. The delegate is faked so the tests can assert
 * on the exact `where` clauses the route builds — the role scoping is a
 * security boundary, and a test that cannot see the query cannot prove that a
 * publisher is filtered to their own calls.
 */

/** Money comes back from Prisma as a Decimal, never a string or a number. */
const dec = (v: string | null) => (v === null ? null : new Prisma.Decimal(v));

interface Recorded {
  count: { where: Record<string, unknown> }[];
  aggregate: { where: Record<string, unknown> }[];
  groupBy: { where: Record<string, unknown> }[];
}

function fakeDelegate(opts: {
  inFlight?: number;
  offered?: number;
  answered?: number;
  revenue?: Prisma.Decimal | null;
  groups?: { billable: boolean; count: number; money: string | null }[];
}) {
  const recorded: Recorded = { count: [], aggregate: [], groupBy: [] };
  const delegate = {
    count: (args: { where: Record<string, unknown> }) => {
      recorded.count.push(args);
      return Promise.resolve(opts.inFlight ?? 0);
    },
    aggregate: (args: { where: Record<string, unknown> }) => {
      recorded.aggregate.push(args);
      return Promise.resolve({
        _count: { _all: opts.offered ?? 0, answeredAt: opts.answered ?? 0 },
        _sum: { revenue: opts.revenue ?? null },
      });
    },
    groupBy: (args: { where: Record<string, unknown> }) => {
      recorded.groupBy.push(args);
      return Promise.resolve(
        (opts.groups ?? []).map(g => ({
          billable: g.billable,
          _count: { _all: g.count },
          _sum: { publisherPayoutAmount: dec(g.money), buyerBillableAmount: dec(g.money) },
        }))
      );
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { delegate: delegate as any, recorded };
}

const ADMIN = { isAdminOrOwner: true, publisherId: null, buyerId: null };
const PUBLISHER = { isAdminOrOwner: false, publisherId: 'pub_1', buyerId: null };
const BUYER = { isAdminOrOwner: false, publisherId: null, buyerId: 'buy_1' };
const NOBODY = { isAdminOrOwner: false, publisherId: null, buyerId: null };

describe('resolveRole', () => {
  it('puts admin ahead of a party link', () => {
    expect(resolveRole({ isAdminOrOwner: true, publisherId: 'p', buyerId: 'b' })).toBe('admin');
  });

  it('treats a user linked to both parties as a publisher', () => {
    expect(resolveRole({ isAdminOrOwner: false, publisherId: 'p', buyerId: 'b' })).toBe(
      'publisher'
    );
  });

  it('refuses an account with no admin role and no party link', () => {
    // Returning 'admin' here would hand tenant-wide numbers to an unlinked user.
    expect(resolveRole(NOBODY)).toBeNull();
  });
});

describe('scoping', () => {
  it('filters a publisher to their own calls in every query', async () => {
    const { delegate, recorded } = fakeDelegate({ groups: [] });
    await computeLiveMetrics(delegate, {
      tenantId: 't1',
      role: 'publisher',
      profile: PUBLISHER,
    });

    const wheres = [...recorded.count, ...recorded.groupBy].map(c => c.where);
    expect(wheres).toHaveLength(2);
    for (const w of wheres) {
      expect(w.tenantId).toBe('t1');
      expect(w.publisherId).toBe('pub_1');
      expect(w).not.toHaveProperty('buyerId');
    }
  });

  it('filters a buyer to their own calls in every query', async () => {
    const { delegate, recorded } = fakeDelegate({ groups: [] });
    await computeLiveMetrics(delegate, { tenantId: 't1', role: 'buyer', profile: BUYER });

    const wheres = [...recorded.count, ...recorded.groupBy].map(c => c.where);
    expect(wheres).toHaveLength(2);
    for (const w of wheres) {
      expect(w.tenantId).toBe('t1');
      expect(w.buyerId).toBe('buy_1');
      expect(w).not.toHaveProperty('publisherId');
    }
  });

  it('scopes an admin to the tenant and no party', async () => {
    const { delegate, recorded } = fakeDelegate({});
    await computeLiveMetrics(delegate, { tenantId: 't1', role: 'admin', profile: ADMIN });

    const wheres = [...recorded.count, ...recorded.aggregate].map(c => c.where);
    for (const w of wheres) {
      expect(w.tenantId).toBe('t1');
      expect(w).not.toHaveProperty('publisherId');
      expect(w).not.toHaveProperty('buyerId');
    }
  });
});

describe('query cost', () => {
  it('issues exactly two queries per role — no N+1', async () => {
    for (const [role, profile] of [
      ['admin', ADMIN],
      ['publisher', PUBLISHER],
      ['buyer', BUYER],
    ] as const) {
      const { delegate, recorded } = fakeDelegate({
        groups: [
          { billable: true, count: 5, money: '10.0000' },
          { billable: false, count: 5, money: null },
        ],
      });
      await computeLiveMetrics(delegate, { tenantId: 't1', role, profile });
      const total = recorded.count.length + recorded.aggregate.length + recorded.groupBy.length;
      expect(total, `${role} should issue 2 queries`).toBe(2);
    }
  });
});

describe('calls in flight', () => {
  it('counts only unfinished calls, and bounds how old they can be', async () => {
    const now = new Date('2026-08-30T12:00:00Z');
    const { delegate, recorded } = fakeDelegate({ inFlight: 7 });
    const res = await computeLiveMetrics(delegate, {
      tenantId: 't1',
      role: 'admin',
      profile: ADMIN,
      now,
    });

    expect(res.callsInFlight).toBe(7);
    const w = recorded.count[0].where;
    expect(w.endedAt).toBeNull();
    expect(w.status).toEqual({ in: ['INITIATED', 'RINGING', 'ANSWERED'] });
    // A stuck row from yesterday is not a live call.
    expect(w.createdAt).toEqual({ gte: new Date('2026-08-30T08:00:00Z') });
  });
});

describe('admin metrics', () => {
  it('computes answer rate as answered over offered', async () => {
    const { delegate } = fakeDelegate({
      offered: 118,
      answered: 84,
      revenue: dec('1840.5000'),
    });
    const res = await computeLiveMetrics(delegate, {
      tenantId: 't1',
      role: 'admin',
      profile: ADMIN,
    });

    expect(res.answerRateHour).toBeCloseTo(84 / 118, 10);
    expect(res.revenueRunRateHour).toBe('1840.5000');
  });

  it('returns null answer rate when no calls were offered, not zero', async () => {
    const { delegate } = fakeDelegate({ offered: 0, answered: 0 });
    const res = await computeLiveMetrics(delegate, {
      tenantId: 't1',
      role: 'admin',
      profile: ADMIN,
    });

    // 0% answer rate and "no calls yet" are different facts.
    expect(res.answerRateHour).toBeNull();
    expect(res.unavailable.answerRateHour).toBeTruthy();
  });

  it('never derives abandon rate from the answer rate', async () => {
    const { delegate } = fakeDelegate({ offered: 100, answered: 70 });
    const res = await computeLiveMetrics(delegate, {
      tenantId: 't1',
      role: 'admin',
      profile: ADMIN,
    });

    expect(res.abandonRateHour).toBeNull();
    expect(res.abandonRateHour).not.toBe(0.3);
    expect(res.unavailable.abandonRateHour).toMatch(/hangup party/i);
  });

  it('uses a trailing 60 minutes, not the clock hour', async () => {
    const now = new Date('2026-08-30T12:02:00Z');
    const { delegate, recorded } = fakeDelegate({ offered: 1, answered: 1 });
    await computeLiveMetrics(delegate, {
      tenantId: 't1',
      role: 'admin',
      profile: ADMIN,
      now,
    });

    // A clock hour would start at 12:00 and make a 2-minute sample look like
    // an hour's worth of data.
    expect(recorded.aggregate[0].where.createdAt).toEqual({
      gte: new Date('2026-08-30T11:02:00Z'),
    });
  });
});

describe('publisher metrics', () => {
  it('sums billable count and earnings from the grouped rows', async () => {
    const { delegate } = fakeDelegate({
      groups: [
        { billable: true, count: 42, money: '1840.2650' },
        { billable: false, count: 76, money: null },
      ],
    });
    const res = await computeLiveMetrics(delegate, {
      tenantId: 't1',
      role: 'publisher',
      profile: PUBLISHER,
    });

    expect(res.billableToday).toBe(42);
    expect(res.earningsToday).toBe('1840.2650');
    expect(res.billableRate).toBeCloseTo(42 / 118, 10);
  });

  it('returns a null billable rate with no calls, not zero', async () => {
    const { delegate } = fakeDelegate({ groups: [] });
    const res = await computeLiveMetrics(delegate, {
      tenantId: 't1',
      role: 'publisher',
      profile: PUBLISHER,
    });

    expect(res.billableRate).toBeNull();
    expect(res.billableToday).toBe(0);
    expect(res.unavailable.billableRate).toBeTruthy();
  });
});

describe('buyer metrics', () => {
  it('sums spend and reports no cap rather than a wrong one', async () => {
    const { delegate } = fakeDelegate({
      groups: [
        { billable: true, count: 30, money: '900.0000' },
        { billable: false, count: 10, money: null },
      ],
    });
    const res = await computeLiveMetrics(delegate, {
      tenantId: 't1',
      role: 'buyer',
      profile: BUYER,
    });

    expect(res.spendToday).toBe('900.0000');
    expect(res.billableRate).toBeCloseTo(30 / 40, 10);
    // BuyerEndpoint.maxCap is a call count, not money — it cannot bound spend.
    expect(res.capToday).toBeNull();
    expect(res.unavailable.capToday).toMatch(/maxCap/);
  });
});

describe('money handling', () => {
  it('keeps four decimal places and never floats a Decimal through', async () => {
    const { delegate } = fakeDelegate({
      groups: [{ billable: true, count: 1, money: '0.1000' }],
    });
    const res = await computeLiveMetrics(delegate, {
      tenantId: 't1',
      role: 'publisher',
      profile: PUBLISHER,
    });
    expect(res.earningsToday).toBe('0.1000');
    expect(typeof res.earningsToday).toBe('string');
  });

  it('keeps precision a float would lose', async () => {
    // 9007199254740993 is not representable as a double; going through Number()
    // would silently round it. Decimal.toFixed does not.
    const { delegate } = fakeDelegate({
      offered: 1,
      answered: 1,
      revenue: dec('9007199254740993.0001'),
    });
    const res = await computeLiveMetrics(delegate, {
      tenantId: 't1',
      role: 'admin',
      profile: ADMIN,
    });
    expect(res.revenueRunRateHour).toBe('9007199254740993.0001');
  });
});
