import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { runMonthlyCloseTick } from '../services/monthly-close.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The 1st of the month, run by the API.
 *
 * On the 1st in New York, past 00:15, one tick bills the new month's number
 * charges and closes last month's statements. On the 2nd it does nothing. A
 * second tick on the 1st -- another process, or the same one after the lock
 * expired -- runs both jobs again and writes nothing new, because both are
 * idempotent. While the lock is held a second tick does not run at all.
 *
 * The real `billMonth` and `closeMonth` run against a real database; only
 * Redis is an in-memory stand-in, since what matters about it is SET NX.
 */

const gate = databaseGate();
announceSkip('Monthly close', gate);

describe('Monthly close suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `monthly close suite cannot run: ${gate.reason}`).toBe(true);
  });
});

/** SET key value EX ttl NX, and nothing else. */
function fakeRedis() {
  const keys = new Set<string>();
  return {
    keys,
    set: (key: string, ..._rest: unknown[]) => {
      if (keys.has(key)) return Promise.resolve(null);
      keys.add(key);
      return Promise.resolve('OK' as const);
    },
  };
}

// 01:00 on 1 October in New York (EDT, UTC-4), and the same time on the 2nd.
const FIRST = new Date('2026-10-01T05:00:00Z');
const SECOND = new Date('2026-10-02T05:00:00Z');
// 00:05 on the 1st: the 1st, but before 00:15.
const TOO_EARLY = new Date('2026-10-01T04:05:00Z');

describe.skipIf(!gate.available)('Monthly close', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let tenantId: string;

  beforeAll(() => {
    prisma = getPrismaClient();
  });

  beforeEach(async () => {
    for (const table of ['number_charges', 'statements', 'phone_numbers', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Ridgeline Insurance',
        slug: `ridgeline-${Date.now()}`,
        status: 'ACTIVE',
        createdAt: new Date('2026-08-01T00:00:00Z'),
      },
    });
    tenantId = tenant.id;
    await prisma.phoneNumber.create({
      data: { tenantId, number: '+16155550100', status: 'ACTIVE' },
    });
  });

  const tick = (at: Date, redis = fakeRedis()) =>
    runMonthlyCloseTick({ prisma, redis: redis as never, now: () => at });

  it('bills the new month and closes the last one on the 1st', async () => {
    const result = await tick(FIRST);
    expect(result).toMatchObject({
      ran: true,
      billedMonth: '2026-10',
      closedMonth: '2026-09',
      numberChargesWritten: 1,
      statementErrors: 0,
    });
    expect(result.ran && result.statementsWritten).toBeGreaterThan(0);

    const charges = await prisma.numberCharge.findMany({ where: { tenantId } });
    expect(charges).toHaveLength(1);
    expect(charges[0].periodStart.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(await prisma.statement.count({ where: { month: '2026-09' } })).toBeGreaterThan(0);
  });

  it('does nothing on the 2nd', async () => {
    expect(await tick(SECOND)).toEqual({ ran: false, reason: 'not-the-1st' });
    expect(await prisma.numberCharge.count()).toBe(0);
    expect(await prisma.statement.count()).toBe(0);
  });

  it('waits until 00:15 on the 1st', async () => {
    expect(await tick(TOO_EARLY)).toEqual({ ran: false, reason: 'too-early' });
    expect(await prisma.numberCharge.count()).toBe(0);
  });

  it('writes nothing new on a second tick on the 1st', async () => {
    await tick(FIRST);
    const charges = await prisma.numberCharge.count();
    const statements = await prisma.statement.count();

    // A fresh lock: another process, or the same one after the TTL.
    const again = await tick(FIRST);
    expect(again).toMatchObject({ ran: true, numberChargesWritten: 0, statementsWritten: 0 });
    expect(await prisma.numberCharge.count()).toBe(charges);
    expect(await prisma.statement.count()).toBe(statements);
  });

  it('does not run while another process holds the lock', async () => {
    const redis = fakeRedis();
    await tick(FIRST, redis);
    expect(await tick(FIRST, redis)).toEqual({ ran: false, reason: 'locked' });
  });
});
