/**
 * Lead dial reservations, against real PostgreSQL.
 *
 * ── Why none of this can be a unit test ──────────────────────────────────────
 *
 * Every claim here is a claim about PostgreSQL: that a partial unique index
 * settles a race between two workers, that `FOR UPDATE SKIP LOCKED` lets several
 * reapers run without double-releasing, that `INSERT ... SELECT ... WHERE NOT
 * EXISTS` is atomic. A hand-written double agrees with whatever the test
 * expects, so it can only confirm the author's belief. The server can contradict
 * it — and the behaviour being replaced is one where two workers really did both
 * claim the same lead.
 *
 * Skips with a printed reason when no database is reachable; the CI job sets
 * DIALER_V2_REQUIRE_LIVE_SERVICES so a skip there is a failure.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LeadReservationStore, type ReservationDb } from '../lead-reservation-store.js';
import {
  AttemptOutcome,
  ReservationState,
  ReserveRejection,
  TransitionRejection,
} from '../lead-reservation.js';

interface LivePrisma extends ReservationDb {
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
  $disconnect(): Promise<void>;
}

const REQUIRE_LIVE = process.env.DIALER_V2_REQUIRE_LIVE_SERVICES === 'true';
const DATABASE_URL = process.env.DIALER_V2_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

let available = false;
let skipReason = '';
let db: LivePrisma;

const SUFFIX = `res${process.pid}`;
const TENANT = `t-${SUFFIX}`;
const OTHER_TENANT = `t2-${SUFFIX}`;
const CAMPAIGN = `c-${SUFFIX}`;
const OTHER_CAMPAIGN = `c2-${SUFFIX}`;
const SCOPE = { tenantIds: [TENANT], campaignIds: [] as string[] };

beforeAll(async () => {
  try {
    if (!DATABASE_URL) throw new Error('no test DATABASE_URL is set');

    const mod = (await import('@prisma/client')) as unknown as {
      PrismaClient?: new (opts: Record<string, unknown>) => LivePrisma;
    };
    if (typeof mod?.PrismaClient !== 'function') {
      throw new Error('PrismaClient is not a constructor; the client was probably never generated');
    }
    db = new mod.PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await db.$queryRawUnsafe('SELECT 1');

    const table = await db.$queryRawUnsafe<Array<{ t: string | null }>>(
      `SELECT to_regclass('public.lead_dial_reservations') AS t`
    );
    if (!table[0]?.t) {
      throw new Error('lead_dial_reservations is absent; the migration has not been applied here');
    }

    await seed();
    available = true;
  } catch (error) {
    // Carry the constructor name and the first stack frame too. A Prisma
    // initialisation error can arrive with an empty `message`, and "PostgreSQL
    // is unusable: " with nothing after it is a failure nobody can act on.
    const err = error as {
      name?: string;
      message?: string;
      code?: string;
      meta?: unknown;
      stack?: string;
    };
    skipReason =
      [
        err?.name,
        err?.code,
        err?.message,
        err?.meta ? JSON.stringify(err.meta) : undefined,
        err?.stack?.split('\n')[1]?.trim(),
      ]
        .filter(Boolean)
        .join(' | ') ||
      String(error) ||
      'an error with no name, code, message or stack';
    if (REQUIRE_LIVE) {
      throw new Error(
        `DIALER_V2_REQUIRE_LIVE_SERVICES is set but PostgreSQL is unusable: ${skipReason}`
      );
    }
  }
}, 60_000);

afterAll(async () => {
  if (!available) return;
  try {
    await db.$executeRawUnsafe(
      `DELETE FROM lead_dial_reservations WHERE "tenantId" LIKE $1`,
      `%${SUFFIX}`
    );
    await db.$executeRawUnsafe(`DELETE FROM leads WHERE "tenantId" LIKE $1`, `%${SUFFIX}`);
    await db.$executeRawUnsafe(`DELETE FROM campaigns WHERE "tenantId" LIKE $1`, `%${SUFFIX}`);
    await db.$executeRawUnsafe(`DELETE FROM tenants WHERE id LIKE $1`, `%${SUFFIX}`);
  } catch {
    // Throwaway database. Never worth failing the suite over.
  }
  await db.$disconnect();
}, 60_000);

/**
 * Insert a row filling exactly the columns the DATABASE says are required.
 *
 * Hand-written INSERTs against another module's schema do not survive contact
 * with it — the first version of this omitted `campaigns.publisherId`, which is
 * NOT NULL with a foreign key, and failed for a reason that had nothing to do
 * with reservations. Required foreign keys are resolved by seeding the
 * referenced table first, so this stays correct as those tables change.
 */
async function seedRow(
  table: string,
  id: string,
  overrides: Record<string, unknown> = {},
  seen = new Set<string>()
): Promise<string> {
  if (seen.has(table)) return id;
  seen.add(table);

  const columns = await db.$queryRawUnsafe<
    Array<{
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
    }>
  >(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    table
  );

  const fks = await db.$queryRawUnsafe<Array<{ column_name: string; ref_table: string }>>(
    `SELECT kcu.column_name, ccu.table_name AS ref_table
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' AND tc.table_name=$1`,
    table
  );
  const fkByColumn = new Map(fks.map(f => [f.column_name, f.ref_table]));

  const names: string[] = [];
  const values: unknown[] = [];

  for (const c of columns) {
    const required = c.is_nullable === 'NO' && c.column_default === null;
    const overridden = Object.prototype.hasOwnProperty.call(overrides, c.column_name);
    if (!required && !overridden) continue;

    names.push(`"${c.column_name}"`);
    if (overridden) {
      values.push(overrides[c.column_name]);
      continue;
    }

    const ref = fkByColumn.get(c.column_name);
    if (ref && ref !== table) {
      const parentId = `${id}-${ref}`;
      await seedRow(ref, parentId, {}, seen);
      values.push(parentId);
      continue;
    }

    if (c.column_name === 'id') values.push(id);
    else if (c.data_type === 'USER-DEFINED') {
      const label = await db.$queryRawUnsafe<Array<{ enumlabel: string }>>(
        `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
         WHERE t.typname=$1 ORDER BY e.enumsortorder LIMIT 1`,
        c.udt_name
      );
      values.push(label[0]?.enumlabel ?? null);
    } else if (/timestamp|date/i.test(c.data_type)) values.push(new Date());
    else if (/int|numeric|double|real/i.test(c.data_type)) values.push(0);
    else if (/bool/i.test(c.data_type)) values.push(false);
    else if (/json/i.test(c.data_type)) values.push('{}');
    else if (/ARRAY/i.test(c.data_type)) values.push([]);
    else values.push(`${id}-${c.column_name}`);
  }

  const placeholders = values.map((_, i) => `$${i + 1}`).join(',');
  await db.$executeRawUnsafe(
    `INSERT INTO "${table}" (${names.join(',')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
    ...values
  );
  return id;
}

async function seed(): Promise<void> {
  for (const [tenant, campaign] of [
    [TENANT, CAMPAIGN],
    [OTHER_TENANT, OTHER_CAMPAIGN],
  ]) {
    await seedRow('tenants', tenant);
    // `status` must be ACTIVE — the reservation predicate requires it — and the
    // tenant must be ours, not a synthetic one the FK resolver would invent.
    await seedRow('campaigns', campaign, { tenantId: tenant, status: 'ACTIVE' });
  }
}

let phoneCounter = 0;

async function makeLead(id: string, tenant = TENANT, campaign = CAMPAIGN): Promise<string> {
  phoneCounter += 1;
  await seedRow('leads', id, {
    tenantId: tenant,
    campaignId: campaign,
    phoneNumber: `+1555${String(1_000_000 + phoneCounter).slice(0, 7)}`,
    status: 'NEW',
  });
  // Re-running a test must find the lead dialable again, whatever a previous
  // run left behind.
  await db.$executeRawUnsafe(`UPDATE leads SET status='NEW' WHERE id = $1`, id);
  await db.$executeRawUnsafe(`DELETE FROM lead_dial_reservations WHERE "leadId" = $1`, id);
  return id;
}

function storeFor(ownerId: string, leaseMs = 30_000): LeadReservationStore {
  return new LeadReservationStore({ db, ownerId, leaseMs });
}

function live(name: string, fn: () => Promise<void>, timeout = 60_000) {
  it(
    name,
    async () => {
      if (!available) {
        console.warn(`[live-reservation] skipped "${name}": ${skipReason}`);
        return;
      }
      await fn();
    },
    timeout
  );
}

describe('8. reservation is atomic against a real server', () => {
  live('claims an eligible lead', async () => {
    const leadId = await makeLead(`lead-a-${SUFFIX}`);
    const result = await storeFor('worker-1').reserve({ leadId, ...SCOPE });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reservation.state).toBe(ReservationState.RESERVED);
    expect(result.reservation.tenantId).toBe(TENANT);
    // The fencing token and the correlation id are issued at reservation time,
    // not at origination — the crash window opens the moment the row exists.
    expect(result.reservation.token).toBeTruthy();
    expect(result.reservation.attemptId).toBeTruthy();
  });

  live('refuses a lead that is not NEW', async () => {
    const leadId = await makeLead(`lead-b-${SUFFIX}`);
    await db.$executeRawUnsafe(`UPDATE leads SET status='CONVERTED' WHERE id=$1`, leadId);

    const result = await storeFor('worker-1').reserve({ leadId, ...SCOPE });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe(ReserveRejection.NOT_ELIGIBLE);
  });

  live('6. refuses a lead outside the tenant scope', async () => {
    const leadId = await makeLead(`lead-c-${SUFFIX}`, OTHER_TENANT, OTHER_CAMPAIGN);
    const result = await storeFor('worker-1').reserve({ leadId, ...SCOPE });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe(ReserveRejection.OUT_OF_SCOPE);
  });

  live('7. refuses a lead outside the campaign scope', async () => {
    const leadId = await makeLead(`lead-d-${SUFFIX}`);
    const result = await storeFor('worker-1').reserve({
      leadId,
      tenantIds: [],
      campaignIds: [OTHER_CAMPAIGN],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe(ReserveRejection.OUT_OF_SCOPE);
  });
});

describe('9. concurrent workers cannot double-reserve', () => {
  live('exactly one of ten simultaneous workers wins', async () => {
    // The scenario the old code got wrong every second: two workers poll, both
    // see the lead as NEW, both "claim" it, both dial the same person.
    const leadId = await makeLead(`lead-race-${SUFFIX}`);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => storeFor(`worker-${i}`).reserve({ leadId, ...SCOPE }))
    );

    expect(results.filter(r => r.ok)).toHaveLength(1);
    for (const loser of results.filter(r => !r.ok)) {
      // Every loser must be told it lost a race, not that something broke.
      if (!loser.ok) expect(loser.rejection).toBe(ReserveRejection.ALREADY_RESERVED);
    }

    const active = await db.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM lead_dial_reservations
       WHERE "leadId" = $1 AND "releasedAt" IS NULL`,
      leadId
    );
    expect(active[0].n).toBe(1);
  });

  live('a released lead can be reserved again', async () => {
    // The partial index scopes uniqueness to ACTIVE reservations. A plain unique
    // index would let a lead be dialled exactly once, ever.
    const leadId = await makeLead(`lead-reuse-${SUFFIX}`);
    const store = storeFor('worker-1');

    const first = await store.reserve({ leadId, ...SCOPE });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    await store.transition({
      reservationId: first.reservation.id,
      token: first.reservation.token,
      to: ReservationState.RELEASED,
      outcome: AttemptOutcome.NOT_ATTEMPTED,
    });

    const second = await store.reserve({ leadId, ...SCOPE });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.reservation.id).not.toBe(first.reservation.id);
  });
});

describe('10, 11 and 23. the attempt lifecycle', () => {
  live('records submission before acceptance', async () => {
    const leadId = await makeLead(`lead-life-${SUFFIX}`);
    const store = storeFor('worker-1');
    const reserved = await store.reserve({ leadId, ...SCOPE });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    const { id, token } = reserved.reservation;

    expect(
      (
        await store.transition({
          reservationId: id,
          token,
          to: ReservationState.ORIGINATION_SUBMITTED,
        })
      ).ok
    ).toBe(true);
    const accepted = await store.transition({
      reservationId: id,
      token,
      to: ReservationState.ORIGINATION_ACCEPTED,
    });
    expect(accepted.ok).toBe(true);
  });

  live('refuses to skip submission', async () => {
    const leadId = await makeLead(`lead-skip-${SUFFIX}`);
    const store = storeFor('worker-1');
    const reserved = await store.reserve({ leadId, ...SCOPE });
    if (!reserved.ok) return;

    const skipped = await store.transition({
      reservationId: reserved.reservation.id,
      token: reserved.reservation.token,
      to: ReservationState.ORIGINATION_ACCEPTED,
    });
    expect(skipped.ok).toBe(false);
    if (!skipped.ok) expect(skipped.rejection).toBe(TransitionRejection.ILLEGAL_TRANSITION);
  });

  live('10. a pre-origination failure releases without ambiguity', async () => {
    const leadId = await makeLead(`lead-pre-${SUFFIX}`);
    const store = storeFor('worker-1');
    const reserved = await store.reserve({ leadId, ...SCOPE });
    if (!reserved.ok) return;

    const released = await store.transition({
      reservationId: reserved.reservation.id,
      token: reserved.reservation.token,
      to: ReservationState.RELEASED,
      outcome: AttemptOutcome.NOT_ATTEMPTED,
    });
    expect(released.ok).toBe(true);
    if (released.ok) expect(released.reservation.releasedAtMs).not.toBeNull();
  });

  live('refuses a double release rather than repeating it silently', async () => {
    const leadId = await makeLead(`lead-double-${SUFFIX}`);
    const store = storeFor('worker-1');
    const reserved = await store.reserve({ leadId, ...SCOPE });
    if (!reserved.ok) return;
    const { id, token } = reserved.reservation;

    await store.transition({ reservationId: id, token, to: ReservationState.RELEASED });
    const again = await store.transition({
      reservationId: id,
      token,
      to: ReservationState.RELEASED,
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.rejection).toBe(TransitionRejection.ALREADY_TERMINAL);
  });

  live('refuses a transition presenting a stale token', async () => {
    // The fencing property. A worker whose lease expired and was recovered must
    // not be able to move a reservation somebody else now holds.
    const leadId = await makeLead(`lead-fence-${SUFFIX}`);
    const store = storeFor('worker-1');
    const reserved = await store.reserve({ leadId, ...SCOPE });
    if (!reserved.ok) return;

    const result = await store.transition({
      reservationId: reserved.reservation.id,
      token: 'a-token-from-a-previous-life',
      to: ReservationState.ORIGINATION_SUBMITTED,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe(TransitionRejection.STALE_TOKEN);
  });
});

describe('16, 17, 18 and 19. crash recovery', () => {
  live('16. frees a lead whose worker died before building a command', async () => {
    // Nothing rang, so the lead is safe to return to the pool.
    const leadId = await makeLead(`lead-crash-a-${SUFFIX}`);
    const dead = storeFor('worker-that-died', -1_000); // lease already expired
    expect((await dead.reserve({ leadId, ...SCOPE })).ok).toBe(true);

    const recovered = await storeFor('reaper-1').recoverExpired({
      tenantIds: [TENANT],
      campaignIds: [],
      limit: 100,
    });
    expect(recovered.released).toBeGreaterThanOrEqual(1);

    // And the lead really is reservable again.
    expect((await storeFor('worker-2').reserve({ leadId, ...SCOPE })).ok).toBe(true);
  });

  live('17. holds a lead whose worker died after submitting, and never redials it', async () => {
    // THE case. The process died after FreeSWITCH may have accepted. Returning
    // this lead to the pool would dial someone whose phone is ringing.
    const leadId = await makeLead(`lead-crash-b-${SUFFIX}`);
    const dead = storeFor('worker-that-died', -1_000);
    const reserved = await dead.reserve({ leadId, ...SCOPE });
    if (!reserved.ok) return;
    await dead.transition({
      reservationId: reserved.reservation.id,
      token: reserved.reservation.token,
      to: ReservationState.ORIGINATION_SUBMITTED,
    });

    const recovered = await storeFor('reaper-1').recoverExpired({
      tenantIds: [TENANT],
      campaignIds: [],
      limit: 100,
    });
    expect(recovered.needsReconciliation).toBeGreaterThanOrEqual(1);

    const row = await db.$queryRawUnsafe<Array<{ state: string; releasedAt: Date | null }>>(
      `SELECT state, "releasedAt" FROM lead_dial_reservations WHERE id = $1`,
      reserved.reservation.id
    );
    expect(row[0].state).toBe('NEEDS_RECONCILIATION');
    // Still ACTIVE, which is what keeps the lead out of the pool.
    expect(row[0].releasedAt).toBeNull();

    // The decisive assertion: no other worker can take it.
    const retaken = await storeFor('worker-2').reserve({ leadId, ...SCOPE });
    expect(retaken.ok).toBe(false);
    if (!retaken.ok) expect(retaken.rejection).toBe(ReserveRejection.ALREADY_RESERVED);
  });

  live('18 and 19. several reapers divide the work and never double-release', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) ids.push(await makeLead(`lead-reap-${i}-${SUFFIX}`));

    const dead = storeFor('worker-that-died', -1_000);
    for (const leadId of ids) await dead.reserve({ leadId, ...SCOPE });

    const reapers = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        storeFor(`reaper-${i}`).recoverExpired({ tenantIds: [TENANT], campaignIds: [], limit: 100 })
      )
    );

    // FOR UPDATE SKIP LOCKED means they divide the work; the total must equal
    // the number of reservations, never a multiple of it.
    expect(reapers.reduce((sum, r) => sum + r.released, 0)).toBe(ids.length);

    // Idempotent: a further pass finds nothing left.
    const again = await storeFor('reaper-again').recoverExpired({
      tenantIds: [TENANT],
      campaignIds: [],
      limit: 100,
    });
    expect(again.released).toBe(0);
  });

  live('does not recover a live worker’s reservation underneath it', async () => {
    const leadId = await makeLead(`lead-healthy-${SUFFIX}`);
    expect((await storeFor('worker-alive', 60_000).reserve({ leadId, ...SCOPE })).ok).toBe(true);

    await storeFor('reaper-1').recoverExpired({ tenantIds: [TENANT], campaignIds: [], limit: 100 });

    const row = await db.$queryRawUnsafe<Array<{ state: string }>>(
      `SELECT state FROM lead_dial_reservations WHERE "leadId" = $1 AND "releasedAt" IS NULL`,
      leadId
    );
    expect(row[0]?.state).toBe('RESERVED');
  });

  live('recovery is tenant-scoped', async () => {
    const mine = await makeLead(`lead-scope-mine-${SUFFIX}`);
    const theirs = await makeLead(`lead-scope-theirs-${SUFFIX}`, OTHER_TENANT, OTHER_CAMPAIGN);

    const dead = storeFor('worker-that-died', -1_000);
    await dead.reserve({ leadId: mine, ...SCOPE });
    await dead.reserve({ leadId: theirs, tenantIds: [OTHER_TENANT], campaignIds: [] });

    await storeFor('reaper-1').recoverExpired({ tenantIds: [TENANT], campaignIds: [], limit: 100 });

    // The other tenant's expired reservation is untouched.
    const other = await db.$queryRawUnsafe<Array<{ state: string }>>(
      `SELECT state FROM lead_dial_reservations WHERE "leadId" = $1 AND "releasedAt" IS NULL`,
      theirs
    );
    expect(other[0]?.state).toBe('RESERVED');
  });
});
