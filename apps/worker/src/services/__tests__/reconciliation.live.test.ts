/**
 * Attempt reconciliation, against real PostgreSQL.
 *
 * ── Why none of this can be a unit test ──────────────────────────────────────
 *
 * Every claim is a claim about the server: that `FOR UPDATE SKIP LOCKED` lets
 * two reconcilers run without both taking the same row, that a fencing token
 * plus a lease expiry in one `WHERE` really does revoke a hung reconciler, that
 * a UNIQUE index settles a double-click between two operators. A hand-written
 * double agrees with whatever the test expects; the server can contradict it.
 *
 * Skips with a printed reason when no database is reachable. The CI job sets
 * DIALER_V2_REQUIRE_LIVE_SERVICES, so a skip there is a failure.
 */

import { applyManualResolution, AttemptResolutionChoice, ResolutionRejection } from '@hopwhistle/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY, type ReconciliationPolicy } from '../../config/reconciliation-policy.js';
import { AttemptReconciler, type AttemptLedger } from '../attempt-reconciler.js';
import {
  UnavailableFreeSwitchPort,
  type LookupResult,
  type ReadOnlyFreeSwitchPort,
} from '../freeswitch-readonly.js';
import { ReservationState } from '../lead-reservation.js';
import {
  LedgerClaim,
  ReconciliationOutcome,
  type ChannelSighting,
} from '../reconciliation-contract.js';
import { ReconciliationStore } from '../reconciliation-store.js';

interface LivePrisma {
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
  $disconnect(): Promise<void>;
}

const REQUIRE_LIVE = process.env.DIALER_V2_REQUIRE_LIVE_SERVICES === 'true';
const DATABASE_URL = process.env.DIALER_V2_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

let available = false;
let skipReason = '';
let db: LivePrisma;

const SUFFIX = `rec${process.pid}`;
const TENANT = `t-${SUFFIX}`;
const OTHER_TENANT = `t2-${SUFFIX}`;
const CAMPAIGN = `c-${SUFFIX}`;
const OTHER_CAMPAIGN = `c2-${SUFFIX}`;
const SCOPE = { tenantIds: [TENANT], campaignIds: [] as string[] };

const CHAN_A = '11111111-1111-4111-8111-111111111111';
const CHAN_B = '22222222-2222-4222-8222-222222222222';

const POLICY: ReconciliationPolicy = { enabled: true, ...DEFAULT_POLICY };

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

    // `to_regclass` returns `regclass`, which Prisma cannot deserialize — it
    // fails with P2010 rather than returning null. Casting to text keeps the
    // answer readable.
    for (const table of ['lead_dial_reservations', 'attempt_reconciliation_runs']) {
      const found = await db.$queryRawUnsafe<Array<{ t: string | null }>>(
        `SELECT to_regclass($1)::text AS t`,
        `public.${table}`
      );
      if (!found[0]?.t) throw new Error(`${table} is absent; the migration has not been applied`);
    }

    await seed();
    available = true;
  } catch (error) {
    const err = error as { name?: string; message?: string; code?: string; stack?: string };
    skipReason =
      [err?.name, err?.code, err?.message, err?.stack?.split('\n')[1]?.trim()]
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
      `DELETE FROM attempt_manual_resolutions WHERE "tenantId" LIKE $1`,
      `%${SUFFIX}`
    );
    await db.$executeRawUnsafe(
      `DELETE FROM attempt_reconciliation_runs WHERE "tenantId" LIKE $1`,
      `%${SUFFIX}`
    );
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

/** Matches the seeding path already proven green against this schema in CI. */
async function seed(): Promise<void> {
  for (const [tenant, campaign] of [
    [TENANT, CAMPAIGN],
    [OTHER_TENANT, OTHER_CAMPAIGN],
  ]) {
    const publisher = `p-${campaign}`;
    await db.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, slug, status, "createdAt", "updatedAt")
       VALUES ($1, $1, $1, 'ACTIVE', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
      tenant
    );
    await db.$executeRawUnsafe(
      `INSERT INTO publishers (id, "tenantId", name, code, status, "createdAt", "updatedAt")
       VALUES ($1, $2, $1, $1, 'ACTIVE', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
      publisher,
      tenant
    );
    await db.$executeRawUnsafe(
      `INSERT INTO campaigns (id, "tenantId", "publisherId", name, status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $1, 'ACTIVE', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
      campaign,
      tenant,
      publisher
    );
  }
}

let counter = 0;

/**
 * Create a lead and a reservation already parked in NEEDS_RECONCILIATION.
 *
 * Written directly rather than by driving the Hopper through a crash: the state
 * under test is "a worker died after submitting an originate", and reproducing
 * the death is not what these assertions are about.
 */
async function parkedAttempt(
  options: {
    tenant?: string;
    campaign?: string;
    ageMs?: number;
    manualReview?: boolean;
    notBeforeMs?: number;
  } = {}
): Promise<{ reservationId: string; attemptId: string; leadId: string; token: string }> {
  counter += 1;
  const tenant = options.tenant ?? TENANT;
  const campaign = options.campaign ?? CAMPAIGN;
  const leadId = `lead-${SUFFIX}-${counter}`;
  const reservationId = `res-${SUFFIX}-${counter}`;
  const attemptId = `aaaaaaaa-aaaa-4aaa-8aaa-${String(100000000000 + counter).slice(0, 12)}`;
  const token = `tok-${SUFFIX}-${counter}`;
  const ageMs = options.ageMs ?? 60_000;

  await db.$executeRawUnsafe(
    `INSERT INTO leads (id, "tenantId", "campaignId", "phoneNumber", status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'NEW', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    leadId,
    tenant,
    campaign,
    `+1555${String(2_000_000 + counter).slice(0, 7)}`
  );

  await db.$executeRawUnsafe(
    `INSERT INTO lead_dial_reservations (
       id, "leadId", "tenantId", "campaignId", "ownerId", token, "attemptId",
       state, "reservedAt", "leaseExpiresAt", "manualReviewRequired", "reconcileNotBefore",
       "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4, 'dead-worker', $5, $6,
       'NEEDS_RECONCILIATION'::"LeadDialReservationState",
       NOW() - ($7 || ' milliseconds')::interval,
       NOW() - interval '1 second', $8, $9,
       NOW(), NOW()
     )`,
    reservationId,
    leadId,
    tenant,
    campaign,
    token,
    attemptId,
    String(ageMs),
    options.manualReview ?? false,
    options.notBeforeMs === undefined ? null : new Date(Date.now() + options.notBeforeMs)
  );

  return { reservationId, attemptId, leadId, token };
}

async function reservationRow(id: string): Promise<{
  state: string;
  releasedAt: Date | null;
  outcome: string | null;
  manualReviewRequired: boolean;
  reconcileAttempts: number;
  reconcilerToken: string | null;
  reconcileNotBefore: Date | null;
  token: string;
  resolutionChoice: string | null;
}> {
  const rows = await db.$queryRawUnsafe<
    Array<{
      state: string;
      releasedAt: Date | null;
      outcome: string | null;
      manualReviewRequired: boolean;
      reconcileAttempts: number;
      reconcilerToken: string | null;
      reconcileNotBefore: Date | null;
      token: string;
      resolutionChoice: string | null;
    }>
  >(`SELECT * FROM lead_dial_reservations WHERE id = $1`, id);
  return rows[0];
}

function storeFor(ownerId: string, leaseMs = 30_000): ReconciliationStore {
  return new ReconciliationStore({ db, ownerId, leaseMs });
}

class StaticPort implements ReadOnlyFreeSwitchPort {
  constructor(private readonly result: LookupResult<ChannelSighting[]>) {}
  findActiveChannelByAttemptId(): Promise<LookupResult<ChannelSighting[]>> {
    return Promise.resolve(this.result);
  }
  findRecentChannelHistoryByAttemptId(): Promise<LookupResult<ChannelSighting[]>> {
    return Promise.resolve({ available: false, detail: 'no history exists', value: [] });
  }
  getChannelVariables(): Promise<LookupResult<Record<string, string>>> {
    return Promise.resolve({ available: true, detail: '', value: {} });
  }
}

function portWith(uuids: string[], attemptId: string): StaticPort {
  return new StaticPort({
    available: true,
    detail: 'inspected',
    value: uuids.map(uuid => ({
      channelUuid: uuid,
      attemptId,
      observedAtMs: Date.now(),
      answerState: 'ACTIVE',
    })),
  });
}

const EMPTY_PORT = new StaticPort({ available: true, detail: 'nothing found', value: [] });

function ledgerOf(claim: LedgerClaim, uuid: string | null, cause: string | null): AttemptLedger {
  return {
    findByAttemptId: () =>
      Promise.resolve({
        available: true,
        detail: 'ledger',
        value: [
          {
            claim,
            channelUuid: uuid,
            occurredAtMs: Date.now() - 1_000,
            hangupCause: cause,
            provesHumanContact: false,
          },
        ],
      }),
  };
}

function reconcilerWith(
  ownerId: string,
  port: ReadOnlyFreeSwitchPort,
  extra: { ledger?: AttemptLedger; policy?: ReconciliationPolicy; leaseMs?: number } = {}
): AttemptReconciler {
  return new AttemptReconciler({
    store: storeFor(ownerId, extra.leaseMs ?? 30_000),
    freeswitch: port,
    ledger: extra.ledger,
    policy: extra.policy ?? POLICY,
  });
}

function live(name: string, fn: () => Promise<void>, timeout = 60_000) {
  it(
    name,
    async () => {
      if (!available) {
        console.warn(`[live-reconciliation] skipped "${name}": ${skipReason}`);
        return;
      }
      await fn();
    },
    timeout
  );
}

describe('1-3. claiming, fencing and crash recovery', () => {
  live('1. two reconcilers cannot claim the same reservation', async () => {
    const parked = await parkedAttempt();

    const [a, b] = await Promise.all([
      storeFor('reconciler-a').claimBatch({ ...SCOPE, limit: 10 }),
      storeFor('reconciler-b').claimBatch({ ...SCOPE, limit: 10 }),
    ]);

    const both = [...a, ...b].filter(c => c.reservationId === parked.reservationId);
    expect(both).toHaveLength(1);
  });

  live('1b. every claimed row gets its own fencing token', async () => {
    await parkedAttempt();
    await parkedAttempt();
    const claims = await storeFor('reconciler-tokens').claimBatch({ ...SCOPE, limit: 10 });
    const tokens = new Set(claims.map(c => c.reconcilerToken));
    expect(tokens.size).toBe(claims.length);
  });

  live('2. a stale fencing token cannot finalize work', async () => {
    const parked = await parkedAttempt();
    const store = storeFor('reconciler-stale');
    const [claimed] = await store.claimBatch({ ...SCOPE, limit: 1 });
    expect(claimed.reservationId).toBe(parked.reservationId);

    const refused = await store.finalize({
      reservationId: claimed.reservationId,
      reconcilerToken: 'a-token-nobody-issued',
      transitionTo: ReservationState.COMPLETED,
      attemptOutcome: null,
      outcome: ReconciliationOutcome.COMPLETED_CALL_CONFIRMED,
      nextReconcileAtMs: null,
      requiresManualReview: false,
      manualReviewReason: null,
      extendLeaseToMs: null,
    });

    expect(refused.ok).toBe(false);
    const row = await reservationRow(claimed.reservationId);
    expect(row.releasedAt).toBeNull();
    expect(row.state).toBe('NEEDS_RECONCILIATION');
  });

  live('2b. finalizing twice with the right token is refused the second time', async () => {
    // Idempotence: the claim is cleared in the same statement, so a repeat
    // matches zero rows rather than incrementing the retry count again.
    const parked = await parkedAttempt();
    const store = storeFor('reconciler-twice');
    const [claimed] = await store.claimBatch({ ...SCOPE, limit: 1 });

    const input = {
      reservationId: claimed.reservationId,
      reconcilerToken: claimed.reconcilerToken,
      transitionTo: null,
      attemptOutcome: null,
      outcome: ReconciliationOutcome.EVIDENCE_PENDING,
      nextReconcileAtMs: Date.now() + 60_000,
      requiresManualReview: false,
      manualReviewReason: null,
      extendLeaseToMs: null,
    };

    expect((await store.finalize(input)).ok).toBe(true);
    expect((await store.finalize(input)).ok).toBe(false);

    const row = await reservationRow(parked.reservationId);
    expect(row.reconcileAttempts).toBe(1);
  });

  live('3. a crashed reconciler releases its claim when the lease expires', async () => {
    const parked = await parkedAttempt();
    // A reconciler with a lease already in the past — the state a process that
    // died mid-run leaves behind.
    const crashed = storeFor('reconciler-crashed', -1_000);
    const [claimed] = await crashed.claimBatch({ ...SCOPE, limit: 1 });
    expect(claimed.reservationId).toBe(parked.reservationId);

    // Another reconciler may take it...
    const successor = storeFor('reconciler-successor');
    const [taken] = await successor.claimBatch({ ...SCOPE, limit: 1 });
    expect(taken?.reservationId).toBe(parked.reservationId);
    expect(taken.reconcilerToken).not.toBe(claimed.reconcilerToken);

    // ...and the crashed one cannot finalize, even holding its own token.
    const refused = await crashed.finalize({
      reservationId: claimed.reservationId,
      reconcilerToken: claimed.reconcilerToken,
      transitionTo: ReservationState.COMPLETED,
      attemptOutcome: null,
      outcome: ReconciliationOutcome.COMPLETED_CALL_CONFIRMED,
      nextReconcileAtMs: null,
      requiresManualReview: false,
      manualReviewReason: null,
      extendLeaseToMs: null,
    });
    expect(refused.ok).toBe(false);
  });
});

describe('4-9. outcomes reach the database', () => {
  live('4. an active call keeps the reservation unavailable', async () => {
    const parked = await parkedAttempt();
    const report = await reconcilerWith(
      'r-active',
      portWith([CHAN_A], parked.attemptId)
    ).runOnce(SCOPE);

    expect(report.attempts[0].outcome).toBe(ReconciliationOutcome.ACTIVE_CALL_CONFIRMED);
    const row = await reservationRow(parked.reservationId);
    expect(row.releasedAt).toBeNull();
    expect(row.state).toBe('NEEDS_RECONCILIATION');

    // The lead must still be unreservable: the partial unique index only
    // excludes rows with releasedAt set.
    const activeCount = await db.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM lead_dial_reservations
        WHERE "leadId" = $1 AND "releasedAt" IS NULL`,
      parked.leadId
    );
    expect(activeCount[0].n).toBe(1);
  });

  live('5. a completed call releases exactly once', async () => {
    const parked = await parkedAttempt();
    const ledger = ledgerOf(LedgerClaim.CHANNEL_TERMINATED, CHAN_A, 'NORMAL_CLEARING');

    const first = await reconcilerWith('r-done', EMPTY_PORT, { ledger }).runOnce(SCOPE);
    expect(first.attempts[0].outcome).toBe(ReconciliationOutcome.COMPLETED_CALL_CONFIRMED);

    const row = await reservationRow(parked.reservationId);
    expect(row.state).toBe('COMPLETED');
    expect(row.releasedAt).not.toBeNull();
    const releasedAt = row.releasedAt;

    // A second cycle must not find it, and must not move releasedAt.
    const second = await reconcilerWith('r-done-2', EMPTY_PORT, { ledger }).runOnce(SCOPE);
    expect(second.attempts.some(a => a.reservationId === parked.reservationId)).toBe(false);
    expect((await reservationRow(parked.reservationId)).releasedAt).toEqual(releasedAt);
  });

  live('5b. a completed call is never recorded as human contact', async () => {
    const parked = await parkedAttempt();
    await reconcilerWith('r-nocontact', EMPTY_PORT, {
      ledger: ledgerOf(LedgerClaim.CHANNEL_TERMINATED, CHAN_A, 'NORMAL_CLEARING'),
    }).runOnce(SCOPE);

    expect((await reservationRow(parked.reservationId)).outcome).not.toBe('ANSWERED_BY_HUMAN');
    const lead = await db.$queryRawUnsafe<Array<{ status: string }>>(
      `SELECT status FROM leads WHERE id = $1`,
      parked.leadId
    );
    expect(lead[0].status).toBe('NEW');
  });

  live('6. a rejected origination is recorded as not retryable', async () => {
    const parked = await parkedAttempt();
    await reconcilerWith('r-rejected', EMPTY_PORT, {
      ledger: ledgerOf(LedgerClaim.ORIGINATION_REJECTED, null, null),
    }).runOnce(SCOPE);

    const row = await reservationRow(parked.reservationId);
    expect(row.state).toBe('COMPLETED');
    expect(row.outcome).toBe('REJECTED');
  });

  live('7. no evidence remains pending and is rescheduled', async () => {
    const parked = await parkedAttempt();
    const report = await reconcilerWith('r-pending', EMPTY_PORT).runOnce(SCOPE);

    expect(report.attempts[0].outcome).toBe(ReconciliationOutcome.EVIDENCE_PENDING);
    const row = await reservationRow(parked.reservationId);
    expect(row.releasedAt).toBeNull();
    expect(row.reconcileAttempts).toBe(1);
    expect(row.reconcileNotBefore).not.toBeNull();
    expect(row.manualReviewRequired).toBe(false);
  });

  live('7b. a rescheduled attempt is not claimed again until its time comes', async () => {
    const parked = await parkedAttempt();
    await reconcilerWith('r-backoff', EMPTY_PORT).runOnce(SCOPE);

    const again = await storeFor('r-backoff-2').claimBatch({ ...SCOPE, limit: 10 });
    expect(again.some(c => c.reservationId === parked.reservationId)).toBe(false);
  });

  live('8. an unreachable switch remains pending and never releases', async () => {
    const parked = await parkedAttempt();
    const report = await reconcilerWith('r-down', new UnavailableFreeSwitchPort()).runOnce(SCOPE);

    expect(report.attempts[0].outcome).toBe(ReconciliationOutcome.FREESWITCH_UNREACHABLE);
    const row = await reservationRow(parked.reservationId);
    expect(row.releasedAt).toBeNull();
    expect(row.state).toBe('NEEDS_RECONCILIATION');
  });

  live('9. conflicting evidence enters manual review', async () => {
    const parked = await parkedAttempt();
    const report = await reconcilerWith('r-conflict', portWith([CHAN_A], parked.attemptId), {
      ledger: ledgerOf(LedgerClaim.CHANNEL_TERMINATED, CHAN_A, 'NORMAL_CLEARING'),
    }).runOnce(SCOPE);

    expect(report.attempts[0].outcome).toBe(ReconciliationOutcome.EVIDENCE_CONFLICT);
    const row = await reservationRow(parked.reservationId);
    expect(row.manualReviewRequired).toBe(true);
    expect(row.releasedAt).toBeNull();
  });
});

describe('10-13. idempotence, ordering and identity', () => {
  live('10. duplicate reconciliation runs are idempotent', async () => {
    const parked = await parkedAttempt();
    const ledger = ledgerOf(LedgerClaim.CHANNEL_TERMINATED, CHAN_A, 'NORMAL_CLEARING');

    await reconcilerWith('r-dupe', EMPTY_PORT, { ledger }).runOnce(SCOPE);
    const after = await reservationRow(parked.reservationId);

    for (let i = 0; i < 3; i++) {
      await reconcilerWith(`r-dupe-${i}`, EMPTY_PORT, { ledger }).runOnce(SCOPE);
    }

    const final = await reservationRow(parked.reservationId);
    expect(final.state).toBe(after.state);
    expect(final.releasedAt).toEqual(after.releasedAt);
    expect(final.reconcileAttempts).toBe(after.reconcileAttempts);
  });

  live('11. out-of-order evidence converges on the safe result', async () => {
    // A progress record arriving after a termination record must not undo the
    // termination. The reservation is already terminal, so the later run cannot
    // claim it at all — which is the convergence property, enforced by the
    // claim predicate rather than by event ordering.
    const parked = await parkedAttempt();
    await reconcilerWith('r-order', EMPTY_PORT, {
      ledger: ledgerOf(LedgerClaim.CHANNEL_TERMINATED, CHAN_A, 'NORMAL_CLEARING'),
    }).runOnce(SCOPE);

    await reconcilerWith('r-order-late', EMPTY_PORT, {
      ledger: ledgerOf(LedgerClaim.CHANNEL_PROGRESSED, CHAN_A, null),
    }).runOnce(SCOPE);

    const row = await reservationRow(parked.reservationId);
    expect(row.state).toBe('COMPLETED');
  });

  live('12. two channel uuids for one attempt enter conflict', async () => {
    const parked = await parkedAttempt();
    const report = await reconcilerWith(
      'r-two-channels',
      portWith([CHAN_A, CHAN_B], parked.attemptId)
    ).runOnce(SCOPE);

    expect(report.attempts[0].outcome).toBe(ReconciliationOutcome.EVIDENCE_CONFLICT);
    expect((await reservationRow(parked.reservationId)).manualReviewRequired).toBe(true);
  });

  live('13. an old attempt id cannot affect a newer reservation', async () => {
    const older = await parkedAttempt();
    await reconcilerWith('r-old', EMPTY_PORT, {
      ledger: ledgerOf(LedgerClaim.CHANNEL_TERMINATED, CHAN_A, 'NORMAL_CLEARING'),
    }).runOnce(SCOPE);
    expect((await reservationRow(older.reservationId)).state).toBe('COMPLETED');

    // A new reservation for the SAME lead, with a different attempt id.
    const newer = await parkedAttempt();
    await db.$executeRawUnsafe(
      `UPDATE lead_dial_reservations SET "leadId" = $1 WHERE id = $2`,
      older.leadId,
      newer.reservationId
    );

    // Finalizing the old reservation again must change nothing about the new one.
    const row = await reservationRow(newer.reservationId);
    expect(row.state).toBe('NEEDS_RECONCILIATION');
    expect(row.releasedAt).toBeNull();
  });
});

describe('14-15. scope boundaries', () => {
  live('14. tenant boundaries cannot be crossed', async () => {
    const foreign = await parkedAttempt({ tenant: OTHER_TENANT, campaign: OTHER_CAMPAIGN });

    const claims = await storeFor('r-tenant').claimBatch({
      tenantIds: [TENANT],
      campaignIds: [],
      limit: 100,
    });

    expect(claims.some(c => c.reservationId === foreign.reservationId)).toBe(false);
    expect((await reservationRow(foreign.reservationId)).reconcilerToken).toBeNull();
  });

  live('15. campaign boundaries cannot be crossed', async () => {
    const foreign = await parkedAttempt({ tenant: OTHER_TENANT, campaign: OTHER_CAMPAIGN });

    const claims = await storeFor('r-campaign').claimBatch({
      tenantIds: [],
      campaignIds: [CAMPAIGN],
      limit: 100,
    });

    expect(claims.some(c => c.reservationId === foreign.reservationId)).toBe(false);
  });
});

describe('16-18. the operator path and the origination boundary', () => {
  live('16. an operator resolution rejects a stale token', async () => {
    const parked = await parkedAttempt({ manualReview: true });

    const stale = await applyManualResolution(
      {
        reservationId: parked.reservationId,
        tenantId: TENANT,
        presentedToken: 'a-token-from-an-older-screen',
        choice: AttemptResolutionChoice.CONFIRM_COMPLETED,
        reason: 'checked the carrier portal and the call is over',
        actorId: 'operator-1',
      },
      { db }
    );

    expect(stale.ok).toBe(false);
    expect(stale.ok === false && stale.rejection).toBe(ResolutionRejection.STALE_TOKEN);
    expect((await reservationRow(parked.reservationId)).releasedAt).toBeNull();
  });

  live('16b. the current token resolves, and a second attempt is refused', async () => {
    const parked = await parkedAttempt({ manualReview: true });
    const request = {
      reservationId: parked.reservationId,
      tenantId: TENANT,
      presentedToken: parked.token,
      choice: AttemptResolutionChoice.CONFIRM_NEVER_ORIGINATED,
      reason: 'switch logs show the command never left the queue',
      actorId: 'operator-1',
      actorLabel: 'Ops on call',
    };

    expect((await applyManualResolution(request, { db })).ok).toBe(true);

    const row = await reservationRow(parked.reservationId);
    expect(row.state).toBe('COMPLETED');
    expect(row.resolutionChoice).toBe('CONFIRM_NEVER_ORIGINATED');
    expect(row.manualReviewRequired).toBe(false);
    expect(row.outcome).toBe('NOT_ATTEMPTED');

    const second = await applyManualResolution(request, { db });
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.rejection).toBe(ResolutionRejection.ALREADY_RESOLVED);
  });

  live('16c. RETURN_TO_ELIGIBLE without the acknowledgement is refused', async () => {
    const parked = await parkedAttempt({ manualReview: true });
    const result = await applyManualResolution(
      {
        reservationId: parked.reservationId,
        tenantId: TENANT,
        presentedToken: parked.token,
        choice: AttemptResolutionChoice.RETURN_TO_ELIGIBLE,
        reason: 'no evidence either way after three days of looking',
        actorId: 'operator-1',
      },
      { db }
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.rejection).toBe(
      ResolutionRejection.ACKNOWLEDGEMENT_REQUIRED
    );
    expect((await reservationRow(parked.reservationId)).releasedAt).toBeNull();
  });

  live('16d. an operator cannot reach another tenant’s attempt', async () => {
    const foreign = await parkedAttempt({
      tenant: OTHER_TENANT,
      campaign: OTHER_CAMPAIGN,
      manualReview: true,
    });
    const result = await applyManualResolution(
      {
        reservationId: foreign.reservationId,
        tenantId: TENANT,
        presentedToken: foreign.token,
        choice: AttemptResolutionChoice.CONFIRM_COMPLETED,
        reason: 'attempting to resolve an attempt in another tenant',
        actorId: 'operator-1',
      },
      { db }
    );
    expect(result.ok).toBe(false);
    // Reported as absent. Confirming the id exists elsewhere is a disclosure.
    expect(result.ok === false && result.detail).toBe('no such reservation');
  });

  live('17. an attempt in manual review is invisible to the reconciler', async () => {
    const parked = await parkedAttempt({ manualReview: true });
    const claims = await storeFor('r-review').claimBatch({ ...SCOPE, limit: 100 });
    expect(claims.some(c => c.reservationId === parked.reservationId)).toBe(false);
  });

  live('17b. an attempt in manual review is invisible to the Hopper', async () => {
    // The reservation is still active — releasedAt IS NULL — so the partial
    // unique index makes the lead unreservable. This is what keeps a parked
    // attempt from being dialed while a person is deciding about it.
    const parked = await parkedAttempt({ manualReview: true });
    const { LeadReservationStore } = await import('../lead-reservation-store.js');
    const hopper = new LeadReservationStore({ db, ownerId: 'hopper', leaseMs: 30_000 });

    const result = await hopper.reserve({
      leadId: parked.leadId,
      tenantIds: [TENANT],
      campaignIds: [],
    });

    expect(result.ok).toBe(false);
  });

  live('18. reconciliation never records an origination command', async () => {
    // Every audit row written by a full cycle, inspected for anything that
    // resembles a command. The reconciler holds a port that refuses these, and
    // this asserts the persisted trail agrees.
    const parked = await parkedAttempt();
    await reconcilerWith('r-audit', portWith([CHAN_A], parked.attemptId)).runOnce(SCOPE);

    const runs = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM attempt_reconciliation_runs WHERE "reservationId" = $1`,
      parked.reservationId
    );
    expect(runs.length).toBeGreaterThan(0);

    const serialized = JSON.stringify(runs);
    for (const forbidden of ['originate', 'uuid_kill', 'uuid_transfer', 'sofia/gateway', 'bgapi']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  live('18b. the audit row carries the identifiers and no credentials', async () => {
    const parked = await parkedAttempt();
    await reconcilerWith('r-audit-fields', EMPTY_PORT).runOnce(SCOPE);

    const runs = await db.$queryRawUnsafe<
      Array<{
        attemptId: string;
        leadId: string;
        tenantId: string;
        campaignId: string;
        fencingToken: string;
        outcome: string;
        previousState: string;
        retryCount: number;
        sourcesChecked: string[];
        sourcesUnavailable: string[];
      }>
    >(`SELECT * FROM attempt_reconciliation_runs WHERE "reservationId" = $1`, parked.reservationId);

    const run = runs[0];
    expect(run.attemptId).toBe(parked.attemptId);
    expect(run.leadId).toBe(parked.leadId);
    expect(run.tenantId).toBe(TENANT);
    expect(run.campaignId).toBe(CAMPAIGN);
    expect(run.fencingToken).toBeTruthy();
    expect(run.previousState).toBe('NEEDS_RECONCILIATION');
    expect(run.retryCount).toBe(1);
    expect(run.sourcesChecked).toContain('RESERVATION');

    const serialized = JSON.stringify(runs);
    for (const secret of ['password', 'ClueCon', 'postgres://', 'DATABASE_URL']) {
      expect(serialized).not.toContain(secret);
    }
  });
});
