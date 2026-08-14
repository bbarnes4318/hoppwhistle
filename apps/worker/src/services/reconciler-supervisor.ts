/**
 * The one place the attempt reconciler may be started from.
 *
 * Same shape as `hopper-supervisor.ts`, and for the same reason: the decision to
 * run something that can free a lead belongs somewhere testable against a fake,
 * not inline in an entrypoint where the only way to check it is to read the file
 * and believe it.
 *
 * ── Why it needs a scope even though it cannot dial ──────────────────────────
 *
 * The reconciler ends reservations, and ending a reservation returns a lead to
 * the dialable pool. Running it unscoped would mean one replica making that
 * decision for every tenant in the database, which is the shape of the problem
 * the Hopper gate exists to prevent. It reuses the Hopper's allowlist variables
 * — the attempts it reconciles were created under that scope — but reads them
 * independently of `LEGACY_HOPPER_ENABLED`, because the attempts most needing
 * reconciliation are the ones left behind after the Hopper was turned off.
 */

import { HOPPER_ENV, readAllowlist, type GateEnv } from '../config/hopper-gate.js';
import {
  RECONCILER_ENV,
  resolveReconciliationPolicy,
  type ReconciliationPolicy,
} from '../config/reconciliation-policy.js';

export enum ReconcilerState {
  /** Not enabled. The ordinary, shipped state. */
  DISABLED = 'disabled',
  /** Configuration is malformed or unscoped. Names the problem. */
  REFUSED_CONFIGURATION = 'refused_configuration',
  /** Enabled for a named scope, cycling. */
  RUNNING = 'running',
  /** Started and then failed. */
  FAILED = 'failed',
}

export interface ReconcilerStatus {
  state: ReconcilerState;
  /** Sanitized: built from variable names and counts, never from a value. */
  detail: string;
  scope: { tenantIds: readonly string[]; campaignIds: readonly string[] };
  policy: ReconciliationPolicy | null;
}

export interface SupervisorLog {
  info(record: Record<string, unknown>): void;
  warn(record: Record<string, unknown>): void;
  error(record: Record<string, unknown>): void;
}

const EMPTY_SCOPE = Object.freeze({
  tenantIds: Object.freeze([]),
  campaignIds: Object.freeze([]),
});

/**
 * Decide whether the reconciler may run, and under what scope.
 *
 * Pure. Order matches the Hopper gate: malformed refuses, not-enabled disables,
 * enabled-without-scope refuses. "On, for everything" is unreachable by omission
 * here exactly as it is there.
 */
export function resolveReconcilerGate(env: GateEnv): ReconcilerStatus {
  const resolution = resolveReconciliationPolicy(env);
  if (!resolution.ok) {
    return {
      state: ReconcilerState.REFUSED_CONFIGURATION,
      detail: resolution.reason,
      scope: EMPTY_SCOPE,
      policy: null,
    };
  }

  if (!resolution.policy.enabled) {
    return {
      state: ReconcilerState.DISABLED,
      detail: `${RECONCILER_ENV.enabled} is not "true"`,
      scope: EMPTY_SCOPE,
      policy: resolution.policy,
    };
  }

  const tenantIds = readAllowlist(env, HOPPER_ENV.tenants);
  const campaignIds = readAllowlist(env, HOPPER_ENV.campaigns);

  if (tenantIds.length === 0 && campaignIds.length === 0) {
    return {
      state: ReconcilerState.REFUSED_CONFIGURATION,
      detail: `${RECONCILER_ENV.enabled} is "true" but neither ${HOPPER_ENV.tenants} nor ${HOPPER_ENV.campaigns} names anything; the reconciler is never enabled for everything`,
      scope: EMPTY_SCOPE,
      policy: resolution.policy,
    };
  }

  return {
    state: ReconcilerState.RUNNING,
    detail: `scoped to ${tenantIds.length} tenant(s) and ${campaignIds.length} campaign(s)`,
    scope: Object.freeze({
      tenantIds: Object.freeze([...tenantIds]),
      campaignIds: Object.freeze([...campaignIds]),
    }),
    policy: resolution.policy,
  };
}

/** Whether the decision permits the cycle to run at all. */
export function permitsReconciliation(status: ReconcilerStatus): boolean {
  return status.state === ReconcilerState.RUNNING;
}

/** The surface the supervisor needs. Narrow, so tests need no real reconciler. */
export interface CyclingReconciler {
  runOnce(scope: {
    tenantIds: readonly string[];
    campaignIds: readonly string[];
  }): Promise<{ claimed: number; released: number; parkedForReview: number }>;
}

/**
 * Decide, and if permitted, run one cycle.
 *
 * **Never throws.** A reconciler that cannot run must not take billing, the
 * ClickHouse ETL, or industry research down with it.
 */
export async function superviseReconciler(
  env: GateEnv,
  reconciler: CyclingReconciler,
  log: SupervisorLog
): Promise<ReconcilerStatus> {
  const gate = resolveReconcilerGate(env);

  if (!permitsReconciliation(gate)) {
    log.warn({ msg: 'Attempt reconciler not started', state: gate.state, reason: gate.detail });
    return gate;
  }

  try {
    const report = await reconciler.runOnce(gate.scope);
    log.info({
      msg: 'Attempt reconciler cycle complete',
      claimed: report.claimed,
      released: report.released,
      parkedForReview: report.parkedForReview,
    });
    return gate;
  } catch (error) {
    log.error({ msg: 'Attempt reconciler cycle failed', err: error });
    return {
      ...gate,
      state: ReconcilerState.FAILED,
      detail: 'the reconciler cycle failed; see the worker log',
    };
  }
}
