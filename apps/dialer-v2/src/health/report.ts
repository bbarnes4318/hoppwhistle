/**
 * Dialer V2 — health reporting.
 *
 * `CURRENT_STATE_AUDIT.md` §5 records that the existing worker's `/health`
 * returns a static `{status:'ok'}` literal, which is why the Hopper being unable
 * to place a single call (F-1) is invisible to monitoring.
 *
 * These endpoints therefore assert DIALING liveness, not process liveness.
 * Readiness fails when reliable event ingestion is unavailable, because a dialer
 * that cannot see telephony events cannot safely pace — and a green check in
 * that state is worse than no check at all.
 */

import { type DialerV2Flags } from '../config/flags.js';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface HealthCheck {
  name: string;
  status: CheckStatus;
  detail?: string;
}

export interface HealthSnapshot {
  eslConnected: boolean;
  eslDegraded: boolean;
  eslDetail: string;
  eslConsecutiveFailures: number;

  redisConnected: boolean;
  postgresConnected: boolean;

  /** Null when no telephony event has ever been received. */
  lastEventAgeMs: number | null;
  maxEventAgeMs: number;
  eventLagMs: number;
  maxEventLagMs: number;

  /** Events that could not be attributed to a tenant. */
  unresolvedEventCount: number;
  staleAgentCount: number;
  totalAgentCount: number;
  /** Age of the last completed reconciliation pass. */
  reconciliationLagMs: number | null;
  maxReconciliationLagMs: number;

  campaignsObserved: number;
  shadowDecisionsRecorded: number;

  /** Where state actually lives. 'memory' is single-instance only. */
  storeBackend: 'redis' | 'memory';
  /** Where agent sessions actually live. */
  sessionBackend: 'redis' | 'memory';
  /** False when loop coordination is the single-instance no-op lock. */
  lockDistributed: boolean;
  /**
   * Whether agent-to-campaign assignment can be resolved at all.
   *
   * False is not "no agents assigned" — it is "this schema models no
   * assignment", which is a different and much more serious statement. Without
   * it every campaign forecast has zero agents, and reporting that as an empty
   * roster would hide a capability gap behind an ordinary-looking number.
   */
  assignmentsResolvable: boolean;
  /** Decision writes refused because the fencing token was stale or duplicated. */
  shadowWritesRejected: number;
  /** Agent-state writes refused because the revision was stale. */
  agentStateStaleWrites: number;
}

export interface HealthReport {
  service: 'hopwhistle-dialer-v2';
  status: CheckStatus;
  live: boolean;
  ready: boolean;
  /** True only when ingestion is trustworthy enough to pace on. */
  ingestionHealthy: boolean;
  /**
   * True only when the shadow history is evidence worth promoting on.
   *
   * Separate from `ready` on purpose. A deployment can be perfectly healthy —
   * ingesting events, writing decisions — and still be producing decisions that
   * mean nothing, because no agent resolves to any campaign or because state is
   * not shared between replicas. Reporting that as "ready" would let a Phase 3
   * decision be taken on numbers that were never trustworthy.
   */
  shadowEvidenceTrustworthy: boolean;
  originationPermitted: boolean;
  originationImplemented: boolean;
  emergencyStop: boolean;
  shadowEnabled: boolean;
  checks: HealthCheck[];
}

function worst(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return 'pass';
}

export function buildHealthReport(flags: DialerV2Flags, snap: HealthSnapshot): HealthReport {
  const checks: HealthCheck[] = [];

  const eslStatus: CheckStatus = snap.eslConnected ? (snap.eslDegraded ? 'warn' : 'pass') : 'fail';
  checks.push({
    name: 'freeswitch_esl',
    status: eslStatus,
    detail: snap.eslConnected
      ? snap.eslDegraded
        ? `connected but degraded: ${snap.eslDetail}`
        : undefined
      : `disconnected (${snap.eslConsecutiveFailures} consecutive failures): ${snap.eslDetail}`,
  });

  checks.push({
    name: 'redis',
    status: snap.redisConnected ? 'pass' : 'fail',
    detail: snap.redisConnected ? undefined : 'Redis is unreachable',
  });
  checks.push({
    name: 'postgres',
    status: snap.postgresConnected ? 'pass' : 'fail',
    detail: snap.postgresConnected ? undefined : 'PostgreSQL is unreachable',
  });

  // "No event yet" is genuinely different from "events have stopped". A service
  // that has just started has not failed; one that saw events and went quiet has.
  const eventStatus: CheckStatus =
    snap.lastEventAgeMs === null
      ? 'warn'
      : snap.lastEventAgeMs > snap.maxEventAgeMs
        ? 'fail'
        : 'pass';
  checks.push({
    name: 'event_freshness',
    status: eventStatus,
    detail:
      snap.lastEventAgeMs === null
        ? 'no telephony event has been received yet'
        : snap.lastEventAgeMs > snap.maxEventAgeMs
          ? `last telephony event was ${snap.lastEventAgeMs} ms ago`
          : undefined,
  });

  const lagStatus: CheckStatus = snap.eventLagMs > snap.maxEventLagMs ? 'warn' : 'pass';
  checks.push({
    name: 'event_lag',
    status: lagStatus,
    detail: lagStatus === 'warn' ? `event lag is ${snap.eventLagMs} ms` : undefined,
  });

  checks.push({
    name: 'unresolved_events',
    status: snap.unresolvedEventCount > 0 ? 'warn' : 'pass',
    detail:
      snap.unresolvedEventCount > 0
        ? `${snap.unresolvedEventCount} event(s) quarantined without a resolvable tenant`
        : undefined,
  });

  checks.push({
    name: 'stale_agents',
    status: snap.staleAgentCount > 0 ? 'warn' : 'pass',
    detail:
      snap.staleAgentCount > 0
        ? `${snap.staleAgentCount} of ${snap.totalAgentCount} agent(s) are stale and excluded from capacity`
        : undefined,
  });

  const reconcileStatus: CheckStatus =
    snap.reconciliationLagMs === null
      ? 'warn'
      : snap.reconciliationLagMs > snap.maxReconciliationLagMs
        ? 'fail'
        : 'pass';
  checks.push({
    name: 'reconciliation',
    status: reconcileStatus,
    detail:
      snap.reconciliationLagMs === null
        ? 'no reconciliation pass has completed yet'
        : reconcileStatus === 'fail'
          ? `last reconciliation was ${snap.reconciliationLagMs} ms ago`
          : undefined,
  });

  const originationPermitted =
    flags.enabled &&
    flags.originateEnabled &&
    !flags.dryRun &&
    !flags.emergencyStop &&
    flags.allowedTenantIds.length > 0 &&
    flags.maxGlobalCalls > 0 &&
    flags.maxGlobalCps > 0;

  // Not being permitted to originate is the expected default, never a failure.
  checks.push({
    name: 'origination_permitted',
    status: 'pass',
    detail: originationPermitted
      ? 'Configuration would permit origination, but no origination code path exists in this build'
      : 'Origination is disabled by configuration (expected default)',
  });

  // Where state actually lives, stated rather than implied.
  checks.push({
    name: 'state_backend',
    status: snap.storeBackend === 'redis' ? 'pass' : 'warn',
    detail:
      snap.storeBackend === 'redis'
        ? undefined
        : 'state is in process memory: single-instance only, and lost on restart',
  });

  checks.push({
    name: 'session_backend',
    status: snap.sessionBackend === 'redis' ? 'pass' : 'warn',
    detail:
      snap.sessionBackend === 'redis'
        ? undefined
        : 'agent sessions are in process memory: a session issued here is unknown to every other replica',
  });

  checks.push({
    name: 'loop_coordination',
    status: snap.lockDistributed ? 'pass' : 'warn',
    detail: snap.lockDistributed
      ? undefined
      : 'coordination is the no-op lock: safe for one instance, double-processing with more than one',
  });

  // The gap that would otherwise read as an ordinary empty roster.
  checks.push({
    name: 'campaign_assignments',
    status: snap.assignmentsResolvable ? 'pass' : 'warn',
    detail: snap.assignmentsResolvable
      ? undefined
      : 'no agent-to-campaign assignment exists in the schema, so every campaign forecast has zero agents',
  });

  checks.push({
    name: 'rejected_writes',
    status: snap.shadowWritesRejected > 0 || snap.agentStateStaleWrites > 0 ? 'warn' : 'pass',
    detail:
      snap.shadowWritesRejected > 0 || snap.agentStateStaleWrites > 0
        ? `${snap.shadowWritesRejected} shadow decision(s) and ${snap.agentStateStaleWrites} agent write(s) refused as stale`
        : undefined,
  });

  checks.push({
    name: 'emergency_stop',
    status: flags.emergencyStop ? 'warn' : 'pass',
    detail: flags.emergencyStop ? 'Emergency stop is ENGAGED' : undefined,
  });

  checks.push({
    name: 'shadow_mode',
    status: 'pass',
    detail: flags.shadowEnabled
      ? `shadow mode active; ${snap.shadowDecisionsRecorded} decision(s) recorded across ${snap.campaignsObserved} campaign(s)`
      : 'shadow mode disabled',
  });

  // Ingestion is trustworthy only when the connection is up, not degraded, and
  // events are actually flowing. This is the gate the pacing controller keys off.
  const ingestionHealthy =
    snap.eslConnected &&
    !snap.eslDegraded &&
    snap.lastEventAgeMs !== null &&
    snap.lastEventAgeMs <= snap.maxEventAgeMs;

  // Everything the shadow history depends on to mean anything. Deliberately
  // stricter than `ready`: a deployment can be healthy and still be recording
  // decisions that are not evidence.
  const shadowEvidenceTrustworthy =
    ingestionHealthy &&
    snap.redisConnected &&
    snap.postgresConnected &&
    snap.storeBackend === 'redis' &&
    snap.lockDistributed &&
    snap.assignmentsResolvable;

  return {
    service: 'hopwhistle-dialer-v2',
    status: worst(checks.map(c => c.status)),
    // Liveness is process health only — a failing dependency must not cause an
    // orchestrator to restart-loop a service that is correctly refusing to dial.
    live: true,
    ready: snap.redisConnected && snap.postgresConnected && ingestionHealthy,
    ingestionHealthy,
    shadowEvidenceTrustworthy,
    originationPermitted,
    originationImplemented: false,
    emergencyStop: flags.emergencyStop,
    shadowEnabled: flags.shadowEnabled,
    checks,
  };
}
