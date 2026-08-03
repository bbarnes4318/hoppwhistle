/**
 * Lead dial reservations — the authoritative replacement for the `DIALING`
 * write that audit finding F-1 records.
 *
 * ── The decision, and the evidence for it ────────────────────────────────────
 *
 * Two designs were available. This is Design B, a dedicated reservation record,
 * and Design A — adding `DIALING` to `LeadStatus` — was rejected. The reasoning
 * came from the repository's actual state machine rather than from the shape of
 * the old code:
 *
 *  1. **`LeadStatus` is a business disposition, not an operational state.** Its
 *     members are a CRM outcome ladder: NEW → CONTACTED → QUALIFIED →
 *     CONVERTED, plus LOST and DO_NOT_CALL. Every one answers "what came of
 *     this person". A reservation answers "which worker is holding this row for
 *     the next thirty seconds", which is not a fact about the person at all.
 *
 *  2. **A status cannot carry what recovery needs.** Crash recovery requires an
 *     owner, a lease expiry, and a fencing token. None of those fit in an enum
 *     member, so Design A would have needed extra columns on `leads` anyway —
 *     at which point the enum member is redundant with the columns.
 *
 *  3. **The rollback story is categorically different.** `ALTER TYPE ... ADD
 *     VALUE` cannot be undone: PostgreSQL has no DROP VALUE, and reversing it
 *     means recreating the type and rewriting every column that uses it, under
 *     lock, on the production `leads` table. `DROP TABLE lead_dial_reservations`
 *     is a genuine rollback that touches nothing else.
 *
 *  4. **Design A changes external reporting in ways this branch cannot trace.**
 *     Any consumer grouping leads by status would silently gain a new bucket.
 *     The audit could not enumerate those consumers, and inventing a permanent
 *     business disposition whose readers are unknown is precisely the stop
 *     condition this work operates under.
 *
 *  5. **It leaves the old semantics intact.** Nothing that reads `LeadStatus`
 *     today has to change, so the blast radius is a new table nobody else reads.
 *
 * The cost of Design B is one join to answer "is this lead being dialled", which
 * is a partial-index lookup and is paid only by the dialer.
 *
 * ── Why the lifecycle has more than one "in flight" state ────────────────────
 *
 * "Origination accepted" is not one event. The command being submitted, the
 * switch accepting it, and a human answering are three different facts, and the
 * gap between the first two is where the hardest failure lives: if the process
 * dies after FreeSWITCH accepted but before the acceptance was recorded, a naive
 * reaper would return the lead to the pool and dial a person who is, at that
 * moment, listening to it ring. So submission is recorded BEFORE the command is
 * sent, and a reservation found expired in that state goes to
 * NEEDS_RECONCILIATION rather than back to the pool.
 */

/** Where a reservation is in its life. Operational, never a lead disposition. */
export enum ReservationState {
  /** Claimed. No command has been constructed. */
  RESERVED = 'RESERVED',
  /** A command is about to be, or has been, handed to FreeSWITCH. */
  ORIGINATION_SUBMITTED = 'ORIGINATION_SUBMITTED',
  /** FreeSWITCH acknowledged the command. A channel may exist. */
  ORIGINATION_ACCEPTED = 'ORIGINATION_ACCEPTED',
  /** The attempt reached a terminal outcome. The lead is free again. */
  COMPLETED = 'COMPLETED',
  /** Released without an attempt — the lead returns to the pool immediately. */
  RELEASED = 'RELEASED',
  /**
   * Expired while a command may have been in flight. A human must decide, or a
   * channel-evidence reconciler must, because redialing might double-call.
   */
  NEEDS_RECONCILIATION = 'NEEDS_RECONCILIATION',
}

/** Why an attempt ended. Drives whether the lead becomes eligible again. */
export enum AttemptOutcome {
  ANSWERED_BY_HUMAN = 'ANSWERED_BY_HUMAN',
  NO_ANSWER = 'NO_ANSWER',
  BUSY = 'BUSY',
  REJECTED = 'REJECTED',
  INVALID_DESTINATION = 'INVALID_DESTINATION',
  TEMPORARY_TECHNICAL_FAILURE = 'TEMPORARY_TECHNICAL_FAILURE',
  /** The command was never sent — configuration, gateway, or interlock. */
  NOT_ATTEMPTED = 'NOT_ATTEMPTED',
  DO_NOT_CALL = 'DO_NOT_CALL',
  CAMPAIGN_STOPPED = 'CAMPAIGN_STOPPED',
  TENANT_DISABLED = 'TENANT_DISABLED',
}

/**
 * Whether an outcome leaves the lead dialable again.
 *
 * Deliberately explicit rather than a default: a new outcome added without a
 * decision here would otherwise silently pick one, and both mistakes are bad —
 * retrying a do-not-call is a compliance breach, and retiring a busy signal
 * quietly discards a lead somebody paid for.
 */
export function isRetryable(outcome: AttemptOutcome): boolean {
  switch (outcome) {
    case AttemptOutcome.NO_ANSWER:
    case AttemptOutcome.BUSY:
    case AttemptOutcome.TEMPORARY_TECHNICAL_FAILURE:
    case AttemptOutcome.NOT_ATTEMPTED:
      return true;
    case AttemptOutcome.ANSWERED_BY_HUMAN:
    case AttemptOutcome.REJECTED:
    case AttemptOutcome.INVALID_DESTINATION:
    case AttemptOutcome.DO_NOT_CALL:
    case AttemptOutcome.CAMPAIGN_STOPPED:
    case AttemptOutcome.TENANT_DISABLED:
      return false;
  }
}

/**
 * Whether an outcome is evidence a human was reached.
 *
 * `CONTACTED` must mean this and only this. The old worker set it — and
 * `autodialer.ts` still would — before the command was even sent, which marks
 * a lead contacted whether it rings, is busy, is disconnected, or is never
 * dialled at all.
 */
export function provesHumanContact(outcome: AttemptOutcome): boolean {
  return outcome === AttemptOutcome.ANSWERED_BY_HUMAN;
}

export interface Reservation {
  id: string;
  leadId: string;
  tenantId: string;
  campaignId: string;
  /** Which worker holds it. Compared on every transition. */
  ownerId: string;
  /** Fencing token. A transition presenting a stale token is refused. */
  token: string;
  /** Correlation id written into the channel, so an attempt can be recognised. */
  attemptId: string;
  state: ReservationState;
  reservedAtMs: number;
  leaseExpiresAtMs: number;
  releasedAtMs: number | null;
  outcome: AttemptOutcome | null;
}

export enum ReserveRejection {
  /** Another worker holds an active reservation for this lead. */
  ALREADY_RESERVED = 'ALREADY_RESERVED',
  /** The lead is not NEW, or its campaign is not ACTIVE. */
  NOT_ELIGIBLE = 'NOT_ELIGIBLE',
  /** The lead is outside the authorised tenant/campaign scope. */
  OUT_OF_SCOPE = 'OUT_OF_SCOPE',
  STORE_UNAVAILABLE = 'STORE_UNAVAILABLE',
}

export enum TransitionRejection {
  /** The reservation no longer exists. */
  NOT_FOUND = 'NOT_FOUND',
  /** Someone else owns it now — this worker was superseded. */
  NOT_OWNER = 'NOT_OWNER',
  /** The token is stale: the lease expired and was recovered. */
  STALE_TOKEN = 'STALE_TOKEN',
  /** The move is not legal from the current state. */
  ILLEGAL_TRANSITION = 'ILLEGAL_TRANSITION',
  /** Already terminal. Releasing twice is refused, not silently repeated. */
  ALREADY_TERMINAL = 'ALREADY_TERMINAL',
  STORE_UNAVAILABLE = 'STORE_UNAVAILABLE',
}

export type ReserveResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; rejection: ReserveRejection };

export type TransitionResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; rejection: TransitionRejection };

/** The legal moves. Anything absent here is refused. */
const LEGAL: Record<ReservationState, readonly ReservationState[]> = {
  [ReservationState.RESERVED]: [
    ReservationState.ORIGINATION_SUBMITTED,
    // Pre-origination failure: no command was built, so the lead goes straight
    // back without any uncertainty about whether a phone rang.
    ReservationState.RELEASED,
    ReservationState.COMPLETED,
  ],
  [ReservationState.ORIGINATION_SUBMITTED]: [
    ReservationState.ORIGINATION_ACCEPTED,
    ReservationState.COMPLETED,
    // Submitted-then-expired is the uncertain case, and it is NOT a release.
    ReservationState.NEEDS_RECONCILIATION,
  ],
  [ReservationState.ORIGINATION_ACCEPTED]: [
    ReservationState.COMPLETED,
    ReservationState.NEEDS_RECONCILIATION,
  ],
  // Terminal.
  [ReservationState.COMPLETED]: [],
  [ReservationState.RELEASED]: [],
  // Only a reconciler moves this on, and only with channel evidence.
  [ReservationState.NEEDS_RECONCILIATION]: [ReservationState.COMPLETED],
};

export function isLegalTransition(from: ReservationState, to: ReservationState): boolean {
  return LEGAL[from].includes(to);
}

export function isTerminal(state: ReservationState): boolean {
  return state === ReservationState.COMPLETED || state === ReservationState.RELEASED;
}

/**
 * What an expired reservation becomes.
 *
 * The whole point of the split. A reservation that never got as far as building
 * a command is safe to return to the pool — nothing rang. One that reached
 * submission may correspond to a live call, and returning it to the pool would
 * dial someone who is listening to their phone ring right now.
 */
export function recoveryTargetFor(state: ReservationState): ReservationState | null {
  switch (state) {
    case ReservationState.RESERVED:
      return ReservationState.RELEASED;
    case ReservationState.ORIGINATION_SUBMITTED:
    case ReservationState.ORIGINATION_ACCEPTED:
      return ReservationState.NEEDS_RECONCILIATION;
    case ReservationState.COMPLETED:
    case ReservationState.RELEASED:
    case ReservationState.NEEDS_RECONCILIATION:
      // Nothing to recover: already resolved, or already awaiting a decision.
      return null;
  }
}
