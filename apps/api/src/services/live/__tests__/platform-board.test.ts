import { describe, expect, it } from 'vitest';

import { getLiveBoard, type LiveBoardDeps } from '../platform-board.js';

/**
 * The Live Board.
 *
 * Driven by a fake rather than a database, so the assertions are about the
 * predicates and the arithmetic — which is where this can be wrong in a way
 * nobody notices, because a board that is quietly counting the wrong calls
 * still renders a plausible-looking number.
 */

const TENANTS = [
  { id: 't-alpha', name: 'Alpha Insurance', slug: 'alpha', isNonProduction: false },
  { id: 't-bravo', name: 'Bravo Insurance', slug: 'bravo', isNonProduction: false },
  { id: 't-demo', name: 'Demo Agency', slug: 'demo', isNonProduction: true },
];

interface Fake {
  deps: LiveBoardDeps;
  /** Every `where` the service asked a Call roll-up for, in order. */
  callWheres: unknown[];
  tenantArgs: unknown[];
}

type CountRow = { tenantId: string; _count: { _all: number } };

function rows(counts: Record<string, number> | undefined): CountRow[] {
  return Object.entries(counts ?? {}).map(([tenantId, n]) => ({
    tenantId,
    _count: { _all: n },
  }));
}

function fake(options: {
  tenants?: typeof TENANTS;
  inFlight?: Record<string, number>;
  delivered?: Record<string, number>;
  submitted?: Record<string, number>;
}): Fake {
  const callWheres: unknown[] = [];
  const tenantArgs: unknown[] = [];

  /*
   * Two Call roll-ups run, in a fixed order: in flight first, delivered
   * second. The fake answers by call count rather than by inspecting the
   * `where`, so a test that changes the predicate still gets the rows it
   * expects and fails on the assertion it meant to make.
   */
  let callIndex = 0;
  const groupByCall = (args: { where: unknown }): Promise<CountRow[]> => {
    callWheres.push(args.where);
    callIndex += 1;
    return Promise.resolve(callIndex === 1 ? rows(options.inFlight) : rows(options.delivered));
  };

  const prisma = {
    tenant: {
      findMany: (args: unknown) => {
        tenantArgs.push(args);
        return Promise.resolve(options.tenants ?? TENANTS);
      },
    },
    call: { groupBy: groupByCall },
    insuranceCarrierApplication: {
      groupBy: () => Promise.resolve(rows(options.submitted)),
    },
  } as unknown as LiveBoardDeps['prisma'];

  return {
    callWheres,
    tenantArgs,
    deps: { prisma, now: new Date('2026-09-23T15:00:00.000Z') },
  };
}

describe('the live board counts the billing definitions', () => {
  it('asks for delivered calls with the settlement predicate, widened to every tenant', async () => {
    const { deps: d, callWheres } = fake({ delivered: { 't-alpha': 4 } });
    await getLiveBoard(d);

    // [0] is in flight, [1] is delivered.
    const delivered = callWheres[1] as Record<string, unknown>;
    expect(delivered.direction).toBe('INBOUND');
    expect(delivered.blocked).toBe(false);
    expect(delivered.answeredAt).toBeDefined();
    // Widened from the single tenant the predicate is built for.
    expect(delivered.tenantId).toEqual({ in: ['t-alpha', 't-bravo', 't-demo'] });
  });

  it('counts only calls that are still up, and bounds how far back it looks', async () => {
    const { deps: d, callWheres } = fake({});
    await getLiveBoard(d);

    const inFlight = callWheres[0] as Record<string, unknown>;
    expect(inFlight.status).toEqual({ in: ['INITIATED', 'RINGING', 'ANSWERED'] });
    expect(inFlight.endedAt).toBeNull();
    // A call with no end time from this morning is a stuck row, not a live call.
    expect(inFlight.createdAt).toEqual({ gte: new Date('2026-09-23T11:00:00.000Z') });
  });
});

describe('closing percentage', () => {
  it('is null when nothing has been delivered, not zero', async () => {
    const { deps: d } = fake({ submitted: {}, delivered: {} });
    const board = await getLiveBoard(d);

    expect(board.totals.closingPct).toBeNull();
    expect(board.agencies.every(a => a.closingPct === null)).toBe(true);
  });

  /**
   * The distinction the whole null-vs-zero rule exists for. An agency that took
   * calls and wrote nothing is a real and serious 0%, and it must not read the
   * same as one that has not been sent a call yet.
   */
  it('is zero when calls were delivered and nothing was written', async () => {
    const { deps: d } = fake({ delivered: { 't-alpha': 12 }, submitted: {} });
    const board = await getLiveBoard(d);

    expect(board.agencies.find(a => a.tenantId === 't-alpha')?.closingPct).toBe(0);
    expect(board.agencies.find(a => a.tenantId === 't-bravo')?.closingPct).toBeNull();
  });

  it('is applications over delivered calls, to two places', async () => {
    const { deps: d } = fake({ delivered: { 't-alpha': 80 }, submitted: { 't-alpha': 7 } });
    const board = await getLiveBoard(d);

    expect(board.agencies.find(a => a.tenantId === 't-alpha')?.closingPct).toBe(8.75);
  });
});

describe('non-production agencies', () => {
  it('are left out of the listing unless asked for', async () => {
    const { deps: d, tenantArgs } = fake({});
    const board = await getLiveBoard(d);

    // The fake returns all three regardless; what is asserted is the filter the
    // service asked the database for.
    expect(tenantArgs[0]).toMatchObject({
      where: { status: 'ACTIVE', isNonProduction: false },
    });
    expect(board.includingNonProduction).toBe(false);
  });

  /**
   * Hiding the row and excluding the number are two separate decisions, and
   * only one of them is a toggle. Shown, a demo tenant still must not move the
   * platform's totals — otherwise turning the switch on changes what the
   * business appears to have done today.
   */
  it('never count toward the totals, even when shown', async () => {
    const { deps: d } = fake({
      inFlight: { 't-alpha': 2, 't-demo': 9 },
      delivered: { 't-alpha': 10, 't-demo': 50 },
      submitted: { 't-alpha': 1, 't-demo': 25 },
    });
    const board = await getLiveBoard({ ...d, includeNonProduction: true });

    expect(board.agencies).toHaveLength(3);
    expect(board.totals.agencies).toBe(2);
    expect(board.totals.callsInFlight).toBe(2);
    expect(board.totals.deliveredToday).toBe(10);
    expect(board.totals.applicationsToday).toBe(1);
    expect(board.totals.closingPct).toBe(10);
  });
});

describe('what an operator scans for', () => {
  it('counts an agency as working when it has a call up or work already done', async () => {
    const { deps: d } = fake({
      inFlight: { 't-alpha': 1 },
      delivered: { 't-bravo': 3 },
    });
    const board = await getLiveBoard(d);

    // Alpha is on a call, Bravo has taken calls today. Both are working.
    expect(board.totals.working).toBe(2);
  });

  it('counts an agency with nothing at all as not working', async () => {
    const { deps: d } = fake({ inFlight: { 't-alpha': 1 } });
    const board = await getLiveBoard(d);

    expect(board.totals.working).toBe(1);
    expect(board.agencies.find(a => a.tenantId === 't-bravo')?.callsInFlight).toBe(0);
  });
});

describe('an empty platform', () => {
  it('answers without asking for counts at all', async () => {
    const { deps: d, callWheres } = fake({ tenants: [] });
    const board = await getLiveBoard(d);

    expect(board.agencies).toEqual([]);
    expect(board.totals.agencies).toBe(0);
    expect(board.totals.closingPct).toBeNull();
    // No tenants means no `in` clause to build; asking anyway would be three
    // round trips guaranteed to return nothing.
    expect(callWheres).toHaveLength(0);
  });
});
