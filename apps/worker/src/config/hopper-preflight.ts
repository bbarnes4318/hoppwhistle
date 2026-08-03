/**
 * Legacy Hopper startup preflight.
 *
 * Answers the only question that matters before a dialer is allowed to start:
 * **if this starts right now, how many telephone calls does it place, to whom?**
 *
 * `apps/api/src/services/hopper-preflight.ts` answers a related question for an
 * operator running a CLI against a live database, and is strictly read-only.
 * This one runs inside the worker at startup and gates it. Both are SELECT-only;
 * neither may write, and neither may send a FreeSWITCH command.
 *
 * The counts are computed through an injected port so this can be exercised
 * against fixtures, test doubles and throwaway CI PostgreSQL without ever
 * needing a real database.
 */

import type { HopperScope } from './hopper-gate.js';

export interface PreflightFacts {
  /** Leads matching the Hopper's own selection predicate, within scope. */
  immediatelyDialableLeads: number;
  affectedTenants: number;
  affectedCampaigns: number;
  /** Bounded by the batch size — what the first poll would reserve. */
  maxFirstCycleReservations: number;
  /** Bounded by the concurrency cap — the ceiling on simultaneous calls. */
  maxConcurrentCalls: number;
  /** True when the allowlist actually narrows the selection. */
  allowlistRestrictsSelection: boolean;
  /** True only when both interlocks and the scope would permit a command. */
  wouldAttemptOrigination: boolean;
  /** Reservations left behind by a previous run. */
  staleReservations: number;
  /** Whether the reservation schema this worker needs is present. */
  schemaSufficient: boolean;
  schemaDetail: string;
}

export enum PreflightVerdict {
  /** Safe to start: scoped, and nothing unexpected in the way. */
  CLEAR = 'clear',
  /** The schema the reservation lifecycle needs is not there. */
  SCHEMA_INSUFFICIENT = 'schema_insufficient',
  /** Scope resolves to nothing; starting would be pointless and misleading. */
  EMPTY_SCOPE = 'empty_scope',
  /** Stale reservations need reconciling before new work is taken. */
  STALE_RESERVATIONS_PRESENT = 'stale_reservations_present',
  /** The facts could not be gathered. Refuse rather than assume zero. */
  INDETERMINATE = 'indeterminate',
}

export interface PreflightReport {
  verdict: PreflightVerdict;
  facts: PreflightFacts;
  /** Sanitized. No connection strings, credentials, or raw driver errors. */
  detail: string;
  permitsStartup: boolean;
}

/** What the preflight needs from the database. All reads. */
export interface PreflightSource {
  countDialableLeads(scope: HopperScope): Promise<{
    leads: number;
    tenants: number;
    campaigns: number;
  }>;
  /** The same count with no scope applied, to prove the allowlist narrows it. */
  countDialableLeadsUnscoped(): Promise<number>;
  countStaleReservations(scope: HopperScope): Promise<number>;
  reservationSchemaPresent(): Promise<boolean>;
}

export interface PreflightOptions {
  source: PreflightSource;
  scope: HopperScope;
  batchSize: number;
  concurrencyCap: number;
  originationEnabled: boolean;
}

const UNKNOWN_FACTS: PreflightFacts = {
  immediatelyDialableLeads: -1,
  affectedTenants: -1,
  affectedCampaigns: -1,
  maxFirstCycleReservations: -1,
  maxConcurrentCalls: -1,
  allowlistRestrictsSelection: false,
  wouldAttemptOrigination: false,
  staleReservations: -1,
  schemaSufficient: false,
  schemaDetail: 'not determined',
};

export async function runHopperPreflight(options: PreflightOptions): Promise<PreflightReport> {
  const { source, scope, batchSize, concurrencyCap, originationEnabled } = options;

  let facts: PreflightFacts;
  try {
    const schemaSufficient = await source.reservationSchemaPresent();
    const scoped = await source.countDialableLeads(scope);
    const unscoped = await source.countDialableLeadsUnscoped();
    const staleReservations = await source.countStaleReservations(scope);

    facts = {
      immediatelyDialableLeads: scoped.leads,
      affectedTenants: scoped.tenants,
      affectedCampaigns: scoped.campaigns,
      maxFirstCycleReservations: Math.min(scoped.leads, batchSize, concurrencyCap),
      maxConcurrentCalls: concurrencyCap,
      // Strictly fewer in scope than out of it. If they match, the allowlist is
      // naming everything there is, and an operator should know that before
      // treating it as a restriction.
      allowlistRestrictsSelection: scoped.leads < unscoped,
      wouldAttemptOrigination: originationEnabled && scoped.leads > 0,
      staleReservations,
      schemaSufficient,
      schemaDetail: schemaSufficient
        ? 'reservation schema present'
        : 'the lead reservation table is absent; the migration has not been applied here',
    };
  } catch {
    // Deliberately does not carry the error through: a driver error can contain
    // the datasource URL, and the URL carries the password. An indeterminate
    // preflight refuses, which is the only safe reading of "we could not tell".
    return {
      verdict: PreflightVerdict.INDETERMINATE,
      facts: UNKNOWN_FACTS,
      detail:
        'the preflight could not read the database; refusing to start rather than assume it is safe',
      permitsStartup: false,
    };
  }

  if (!facts.schemaSufficient) {
    return {
      verdict: PreflightVerdict.SCHEMA_INSUFFICIENT,
      facts,
      detail: facts.schemaDetail,
      permitsStartup: false,
    };
  }

  if (facts.staleReservations > 0) {
    // Not fatal in principle — the reaper handles these — but taking new work
    // while an unknown number of previous attempts are unresolved is how a lead
    // gets dialled twice. Reconcile first.
    return {
      verdict: PreflightVerdict.STALE_RESERVATIONS_PRESENT,
      facts,
      detail: `${facts.staleReservations} reservation(s) from a previous run are unresolved; reconcile before taking new work`,
      permitsStartup: false,
    };
  }

  if (facts.affectedTenants === 0 && facts.affectedCampaigns === 0) {
    return {
      verdict: PreflightVerdict.EMPTY_SCOPE,
      facts,
      detail: 'the configured allowlist matches no tenant or campaign with dialable leads',
      permitsStartup: false,
    };
  }

  return {
    verdict: PreflightVerdict.CLEAR,
    facts,
    detail: `${facts.immediatelyDialableLeads} lead(s) in scope; first cycle would reserve at most ${facts.maxFirstCycleReservations}`,
    permitsStartup: true,
  };
}
