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

  /**
   * Deployment mode. `staging` and `production` refuse readiness on any
   * single-instance backend; `development` and `test` report but tolerate them.
   */
  mode: 'test' | 'development' | 'staging' | 'production';

  /**
   * Where each capability's state actually lives.
   *
   * One `storeBackend` flag used to stand for all of this, and it was
   * misleading in the specific way that matters: it reported `redis` whenever a
   * Redis CONNECTION existed, while sessions were in a process map, agent state
   * was in a process map, and decisions were written through an unfenced store
   * that discarded every fencing token it was given. A reviewer reading
   * `storeBackend: 'redis'` would reasonably conclude none of that was true.
   */
  dedupeBackend: Backend;
  decisionBackend: Backend;
  /** Whether decision writes are adjudicated against the campaign lock. */
  decisionsFenced: boolean;
  sessionBackend: Backend;
  agentStateBackend: Backend;
  sipBackend: Backend;
  observationBackend: Backend;
  channelBackend: Backend;
  extensionSource: SourceBackend;
  assignmentSource: SourceBackend;
  lockBackend: 'redis' | 'noop';

  /**
   * Whether shared state was fully reconstructed at startup.
   *
   * A replica that started with an empty map is not observing a quiet
   * deployment — it is observing nothing, and its capacity numbers are a floor
   * rather than a measurement.
   */
  reconstructionComplete: boolean;

  /**
   * Whether agent-to-campaign assignment actually resolves.
   *
   * False is not "no agents assigned" — it is "assignment cannot be resolved",
   * which is a different and much more serious statement. Without it every
   * campaign forecast has zero agents, and reporting that as an empty roster
   * would hide a capability gap behind an ordinary-looking number.
   */
  assignmentsResolvable: boolean;
  /** Decision writes refused: lock lost, token superseded, or duplicate interval. */
  shadowWritesRejected: number;
  /** Agent-state writes refused because the revision was stale. */
  agentStateStaleWrites: number;
  /** Registration writes refused because a newer event had already been applied. */
  registrationsOutOfOrder: number;
}

export type Backend = 'redis' | 'memory';
export type SourceBackend = 'database' | 'static';

export interface HealthReport {
  service: 'hopwhistle-dialer-v2';
  status: CheckStatus;
  mode: HealthSnapshot['mode'];
  live: boolean;
  ready: boolean;
  /** True only when ingestion is trustworthy enough to pace on. */
  ingestionHealthy: boolean;
  /** True only when every capability is backed by shared, durable state. */
  allBackendsShared: boolean;
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

  // ── Backends, one check each ────────────────────────────────────────────
  //
  // Each is reported separately because each fails separately. A deployment can
  // have a healthy Redis connection, distributed locks, and in-memory sessions,
  // and only the third of those is why agents are being logged out at random.
  const strict = snap.mode === 'staging' || snap.mode === 'production';
  const degraded: CheckStatus = strict ? 'fail' : 'warn';

  const backendCheck = (name: string, shared: boolean, detail: string): void => {
    checks.push({
      name,
      status: shared ? 'pass' : degraded,
      detail: shared ? undefined : detail,
    });
  };

  backendCheck(
    'dedupe_backend',
    snap.dedupeBackend === 'redis',
    'event deduplication is per-process: two replicas each accept the same event, so every count is doubled'
  );
  backendCheck(
    'decision_backend',
    snap.decisionBackend === 'redis',
    'shadow decisions are in process memory: lost on restart and invisible to every other replica'
  );
  backendCheck(
    'decision_fencing',
    snap.decisionsFenced,
    'decision writes are not adjudicated against the campaign lock: a replica that lost its lock mid-pass can still write'
  );
  backendCheck(
    'session_backend',
    snap.sessionBackend === 'redis',
    'agent sessions are in process memory: a session issued here is unknown to every other replica'
  );
  backendCheck(
    'agent_state_backend',
    snap.agentStateBackend === 'redis',
    'agent state is in process memory: a restart loses every agent, and two replicas cannot see each other'
  );
  backendCheck(
    'sip_backend',
    snap.sipBackend === 'redis',
    'SIP registrations are in process memory: only the replica whose ESL saw the register believes the agent has an endpoint'
  );
  backendCheck(
    'observation_backend',
    snap.observationBackend === 'redis',
    'observation counters are per-replica: each estimates from half the sample and neither reaches the minimum'
  );
  backendCheck(
    'channel_backend',
    snap.channelBackend === 'redis',
    'channel ownership is per-replica: agents on live calls look idle to every replica that did not observe the bridge'
  );
  backendCheck(
    'extension_source',
    snap.extensionSource === 'database',
    'extension resolution uses static developer fixtures, not real agent records'
  );
  backendCheck(
    'assignment_source',
    snap.assignmentSource === 'database',
    'campaign assignment uses static developer fixtures, not real agent records'
  );
  backendCheck(
    'loop_coordination',
    snap.lockBackend === 'redis',
    'coordination is the no-op lock: safe for one instance, double-processing with more than one'
  );
  backendCheck(
    'state_reconstruction',
    snap.reconstructionComplete,
    'shared state was not fully reconstructed at startup: capacity is a floor, not a measurement'
  );

  // The gap that would otherwise read as an ordinary empty roster.
  checks.push({
    name: 'campaign_assignments',
    status: snap.assignmentsResolvable ? 'pass' : 'warn',
    detail: snap.assignmentsResolvable
      ? undefined
      : 'no agent has resolved to any campaign, so every campaign forecast has zero agents',
  });

  const refused =
    snap.shadowWritesRejected + snap.agentStateStaleWrites + snap.registrationsOutOfOrder;
  checks.push({
    name: 'rejected_writes',
    // Refusals are the mechanism working, not a fault. Reported so a sudden
    // rise — which means replicas are contending far more than expected — is
    // visible, but never failing.
    status: refused > 0 ? 'warn' : 'pass',
    detail:
      refused > 0
        ? `${snap.shadowWritesRejected} decision(s), ${snap.agentStateStaleWrites} agent write(s) and ${snap.registrationsOutOfOrder} registration(s) refused as stale`
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

  /**
   * Every backend that has to be shared for a decision to mean anything.
   *
   * Enumerated rather than inferred from a single flag. The point is that no
   * one of these implies any other: Redis being connected says nothing about
   * whether sessions are in it, and decisions being in Redis says nothing about
   * whether they are fenced.
   */
  const allBackendsShared =
    snap.dedupeBackend === 'redis' &&
    snap.decisionBackend === 'redis' &&
    snap.decisionsFenced &&
    snap.sessionBackend === 'redis' &&
    snap.agentStateBackend === 'redis' &&
    snap.sipBackend === 'redis' &&
    snap.observationBackend === 'redis' &&
    snap.channelBackend === 'redis' &&
    snap.extensionSource === 'database' &&
    snap.assignmentSource === 'database' &&
    snap.lockBackend === 'redis';

  // Everything the shadow history depends on to mean anything. Deliberately
  // stricter than `ready`: a deployment can be healthy and still be recording
  // decisions that are not evidence.
  const shadowEvidenceTrustworthy =
    ingestionHealthy &&
    snap.redisConnected &&
    snap.postgresConnected &&
    allBackendsShared &&
    snap.reconstructionComplete &&
    snap.assignmentsResolvable;

  // In staging and production a single-instance backend is a defect, so
  // readiness fails on it. In development it is a stated choice and only warns.
  const ready =
    snap.redisConnected &&
    snap.postgresConnected &&
    ingestionHealthy &&
    (!strict || (allBackendsShared && snap.reconstructionComplete));

  return {
    service: 'hopwhistle-dialer-v2',
    status: worst(checks.map(c => c.status)),
    mode: snap.mode,
    // Liveness is process health only — a failing dependency must not cause an
    // orchestrator to restart-loop a service that is correctly refusing to dial.
    live: true,
    ready,
    ingestionHealthy,
    allBackendsShared,
    shadowEvidenceTrustworthy,
    originationPermitted,
    originationImplemented: false,
    emergencyStop: flags.emergencyStop,
    shadowEnabled: flags.shadowEnabled,
    checks,
  };
}
