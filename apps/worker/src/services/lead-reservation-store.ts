/**
 * The SQL behind lead dial reservations.
 *
 * Every statement here is written out rather than expressed through the Prisma
 * client, for one reason: the correctness of this module is in the predicates.
 * `INSERT ... SELECT ... WHERE NOT EXISTS` executed as one statement is what
 * makes reservation atomic, and a read-then-write through an ORM is not the same
 * thing however it is spelled.
 *
 * See `lead-reservation.ts` for the domain decision and the transition table.
 */

import {
  AttemptOutcome,
  isLegalTransition,
  isTerminal,
  recoveryTargetFor,
  ReservationState,
  ReserveRejection,
  TransitionRejection,
  type Reservation,
  type ReserveResult,
  type TransitionResult,
} from './lead-reservation.js';

/** The narrow database surface this store needs. */
export interface ReservationDb {
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
}

export interface ReservationStoreOptions {
  db: ReservationDb;
  /** Identifies this worker. Written into every reservation it takes. */
  ownerId: string;
  /** How long a reservation is valid before a reaper may recover it. */
  leaseMs: number;
  now?: () => number;
  newId?: () => string;
}

interface Row {
  id: string;
  leadId: string;
  tenantId: string;
  campaignId: string;
  ownerId: string;
  token: string;
  attemptId: string;
  state: ReservationState;
  outcome: string | null;
  reservedAt: Date;
  leaseExpiresAt: Date;
  releasedAt: Date | null;
}

function toReservation(row: Row): Reservation {
  return {
    id: row.id,
    leadId: row.leadId,
    tenantId: row.tenantId,
    campaignId: row.campaignId,
    ownerId: row.ownerId,
    token: row.token,
    attemptId: row.attemptId,
    state: row.state,
    reservedAtMs: new Date(row.reservedAt).getTime(),
    leaseExpiresAtMs: new Date(row.leaseExpiresAt).getTime(),
    releasedAtMs: row.releasedAt ? new Date(row.releasedAt).getTime() : null,
    outcome: (row.outcome as AttemptOutcome | null) ?? null,
  };
}

/** PostgreSQL's unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === UNIQUE_VIOLATION) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate key|unique constraint/i.test(message);
}

export class LeadReservationStore {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly options: ReservationStoreOptions) {
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  }

  /**
   * Claim a lead, atomically.
   *
   * One statement. The `SELECT` re-checks eligibility and scope at write time
   * rather than trusting the caller's earlier read, and the partial unique index
   * on `(leadId) WHERE releasedAt IS NULL` decides the race between two workers
   * that both saw the lead as free — the loser gets a unique violation, which is
   * "somebody else has it" rather than an error.
   *
   * The tenant and campaign allowlists are in the predicate. A lead outside the
   * authorised scope is not reserved, whatever the caller passed in, so a bug in
   * the selection query cannot widen what this worker is permitted to dial.
   */
  async reserve(input: {
    leadId: string;
    tenantIds: readonly string[];
    campaignIds: readonly string[];
  }): Promise<ReserveResult> {
    const id = this.newId();
    const token = this.newId();
    const attemptId = this.newId();
    const now = new Date(this.now());
    const leaseExpiresAt = new Date(this.now() + this.options.leaseMs);

    try {
      const rows = await this.options.db.$queryRawUnsafe<Row[]>(
        `
        INSERT INTO "lead_dial_reservations" (
          "id", "leadId", "tenantId", "campaignId", "ownerId", "token", "attemptId",
          "state", "reservedAt", "leaseExpiresAt", "createdAt", "updatedAt"
        )
        SELECT $1, l."id", c."tenantId", l."campaignId", $2, $3, $4,
               'RESERVED'::"LeadDialReservationState", $5, $6, $5, $5
        FROM "leads" l
        INNER JOIN "campaigns" c ON c."id" = l."campaignId"
        WHERE l."id" = $7
          AND l."status" = 'NEW'
          AND c."status" = 'ACTIVE'
          AND (cardinality($8::text[]) = 0 OR c."tenantId" = ANY($8::text[]))
          AND (cardinality($9::text[]) = 0 OR l."campaignId" = ANY($9::text[]))
          AND NOT EXISTS (
            SELECT 1 FROM "lead_dial_reservations" r
            WHERE r."leadId" = l."id" AND r."releasedAt" IS NULL
          )
        RETURNING *
        `,
        id,
        this.options.ownerId,
        token,
        attemptId,
        now,
        leaseExpiresAt,
        input.leadId,
        [...input.tenantIds],
        [...input.campaignIds]
      );

      if (rows.length === 1) return { ok: true, reservation: toReservation(rows[0]) };

      // Zero rows means the SELECT matched nothing. Distinguish "already held"
      // from "not eligible" so health and logs can tell contention apart from
      // a campaign that was paused.
      const held = await this.options.db.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT COUNT(*)::int AS n FROM "lead_dial_reservations"
         WHERE "leadId" = $1 AND "releasedAt" IS NULL`,
        input.leadId
      );
      if ((held[0]?.n ?? 0) > 0) return { ok: false, rejection: ReserveRejection.ALREADY_RESERVED };

      const inScope = await this.options.db.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT COUNT(*)::int AS n
         FROM "leads" l INNER JOIN "campaigns" c ON c."id" = l."campaignId"
         WHERE l."id" = $1
           AND (cardinality($2::text[]) = 0 OR c."tenantId" = ANY($2::text[]))
           AND (cardinality($3::text[]) = 0 OR l."campaignId" = ANY($3::text[]))`,
        input.leadId,
        [...input.tenantIds],
        [...input.campaignIds]
      );
      return {
        ok: false,
        rejection:
          (inScope[0]?.n ?? 0) > 0 ? ReserveRejection.NOT_ELIGIBLE : ReserveRejection.OUT_OF_SCOPE,
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The other worker committed between our SELECT and our INSERT. This is
        // the race the index exists to settle, and losing it is normal.
        return { ok: false, rejection: ReserveRejection.ALREADY_RESERVED };
      }
      return { ok: false, rejection: ReserveRejection.STORE_UNAVAILABLE };
    }
  }

  /**
   * Move a reservation on, proving ownership and freshness.
   *
   * The `WHERE` carries the owner and the token, so a worker whose lease expired
   * and was recovered cannot transition a reservation somebody else now holds.
   * That is the fencing property: the token is not advisory.
   */
  async transition(input: {
    reservationId: string;
    token: string;
    to: ReservationState;
    outcome?: AttemptOutcome;
  }): Promise<TransitionResult> {
    let current: Reservation;
    try {
      const rows = await this.options.db.$queryRawUnsafe<Row[]>(
        `SELECT * FROM "lead_dial_reservations" WHERE "id" = $1`,
        input.reservationId
      );
      if (rows.length === 0) return { ok: false, rejection: TransitionRejection.NOT_FOUND };
      current = toReservation(rows[0]);
    } catch {
      return { ok: false, rejection: TransitionRejection.STORE_UNAVAILABLE };
    }

    if (current.token !== input.token) {
      // Either another worker recovered this, or the caller is stale. Both mean
      // the same thing: this worker no longer speaks for this reservation.
      return { ok: false, rejection: TransitionRejection.STALE_TOKEN };
    }
    if (current.ownerId !== this.options.ownerId) {
      return { ok: false, rejection: TransitionRejection.NOT_OWNER };
    }
    if (isTerminal(current.state)) {
      // Releasing twice is refused rather than silently repeated, so a
      // double-release is a visible bug rather than a quiet no-op.
      return { ok: false, rejection: TransitionRejection.ALREADY_TERMINAL };
    }
    if (!isLegalTransition(current.state, input.to)) {
      return { ok: false, rejection: TransitionRejection.ILLEGAL_TRANSITION };
    }

    const releasing = isTerminal(input.to);
    try {
      const rows = await this.options.db.$queryRawUnsafe<Row[]>(
        `
        UPDATE "lead_dial_reservations"
        SET "state" = $1::"LeadDialReservationState",
            "outcome" = COALESCE($2, "outcome"),
            "releasedAt" = CASE WHEN $3 THEN $4 ELSE "releasedAt" END,
            "updatedAt" = $4
        WHERE "id" = $5 AND "token" = $6 AND "ownerId" = $7 AND "releasedAt" IS NULL
        RETURNING *
        `,
        input.to,
        input.outcome ?? null,
        releasing,
        new Date(this.now()),
        input.reservationId,
        input.token,
        this.options.ownerId
      );
      if (rows.length === 0) {
        // Lost between the read and the write.
        return { ok: false, rejection: TransitionRejection.STALE_TOKEN };
      }
      return { ok: true, reservation: toReservation(rows[0]) };
    } catch {
      return { ok: false, rejection: TransitionRejection.STORE_UNAVAILABLE };
    }
  }

  /**
   * Recover expired reservations.
   *
   * Safe to run from several reapers at once: the `WHERE` requires the row to
   * still be expired and still active, and the `UPDATE` rotates the token, so
   * the second reaper to arrive updates zero rows rather than releasing twice.
   *
   * Where a reservation goes depends on how far it got, and this is the whole
   * reason the states are separate. `RESERVED` never built a command, so nothing
   * rang and the lead is safe to free. `ORIGINATION_SUBMITTED` or
   * `ORIGINATION_ACCEPTED` may correspond to a live call — freeing those would
   * dial a person who is at that moment listening to their phone ring — so they
   * become `NEEDS_RECONCILIATION` and wait for evidence.
   */
  async recoverExpired(input: {
    tenantIds: readonly string[];
    campaignIds: readonly string[];
    limit: number;
  }): Promise<{ released: number; needsReconciliation: number }> {
    const now = new Date(this.now());

    const release = async (
      from: ReservationState,
      to: ReservationState,
      reason: string
    ): Promise<number> => {
      const releasing = isTerminal(to);
      const rows = await this.options.db.$queryRawUnsafe<Array<{ id: string }>>(
        `
        UPDATE "lead_dial_reservations"
        SET "state" = $1::"LeadDialReservationState",
            "releasedAt" = CASE WHEN $2 THEN $3 ELSE "releasedAt" END,
            "token" = $4,
            "recoveredBy" = $5,
            "recoveredAt" = $3,
            "recoveryReason" = $6,
            "updatedAt" = $3
        WHERE "id" IN (
          SELECT "id" FROM "lead_dial_reservations"
          WHERE "state" = $7::"LeadDialReservationState"
            AND "releasedAt" IS NULL
            AND "leaseExpiresAt" < $3
            AND (cardinality($8::text[]) = 0 OR "tenantId" = ANY($8::text[]))
            AND (cardinality($9::text[]) = 0 OR "campaignId" = ANY($9::text[]))
          ORDER BY "leaseExpiresAt" ASC
          LIMIT $10
          FOR UPDATE SKIP LOCKED
        )
        RETURNING "id"
        `,
        to,
        releasing,
        now,
        this.newId(),
        this.options.ownerId,
        reason,
        from,
        [...input.tenantIds],
        [...input.campaignIds],
        input.limit
      );
      return rows.length;
    };

    // Never rang. Safe to return to the pool.
    const released = await release(
      ReservationState.RESERVED,
      ReservationState.RELEASED,
      'lease expired before any origination command was constructed'
    );

    // May correspond to a live call. Held for reconciliation, never redialed.
    let needsReconciliation = 0;
    for (const from of [
      ReservationState.ORIGINATION_SUBMITTED,
      ReservationState.ORIGINATION_ACCEPTED,
    ]) {
      needsReconciliation += await release(
        from,
        ReservationState.NEEDS_RECONCILIATION,
        'lease expired after an origination command may have reached FreeSWITCH; ' +
          'held for channel evidence rather than redialed'
      );
    }

    return { released, needsReconciliation };
  }

  /** Reservations awaiting a human or an evidence-based reconciler. */
  async countNeedingReconciliation(input: {
    tenantIds: readonly string[];
    campaignIds: readonly string[];
  }): Promise<number> {
    const rows = await this.options.db.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "lead_dial_reservations"
       WHERE "state" = 'NEEDS_RECONCILIATION'::"LeadDialReservationState"
         AND (cardinality($1::text[]) = 0 OR "tenantId" = ANY($1::text[]))
         AND (cardinality($2::text[]) = 0 OR "campaignId" = ANY($2::text[]))`,
      [...input.tenantIds],
      [...input.campaignIds]
    );
    return rows[0]?.n ?? 0;
  }

  /** Everything expired and still active — what the preflight refuses on. */
  async countStale(input: {
    tenantIds: readonly string[];
    campaignIds: readonly string[];
  }): Promise<number> {
    const rows = await this.options.db.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "lead_dial_reservations"
       WHERE "releasedAt" IS NULL AND "leaseExpiresAt" < $1
         AND (cardinality($2::text[]) = 0 OR "tenantId" = ANY($2::text[]))
         AND (cardinality($3::text[]) = 0 OR "campaignId" = ANY($3::text[]))`,
      new Date(this.now()),
      [...input.tenantIds],
      [...input.campaignIds]
    );
    return rows[0]?.n ?? 0;
  }
}

export { recoveryTargetFor };
