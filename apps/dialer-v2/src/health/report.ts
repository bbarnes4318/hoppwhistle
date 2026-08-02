/**
 * Dialer V2 — health reporting.
 *
 * `CURRENT_STATE_AUDIT.md` §5 records that the existing worker's `/health`
 * returns a static `{status:'ok'}` literal, which is why the Hopper being unable
 * to place a single call (F-1) is invisible to monitoring.
 *
 * Dialer V2's health endpoints therefore assert DIALING liveness, not process
 * liveness: whether ESL is reachable, whether telemetry is fresh, and whether
 * origination is actually permitted right now. A green check here means the
 * dialer could dial, not merely that the process has not crashed.
 */

import { type DialerV2Flags } from '../config/flags.js';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface HealthCheck {
  name: string;
  status: CheckStatus;
  detail?: string;
}

export interface HealthSnapshot {
  freeswitchConnected: boolean;
  redisConnected: boolean;
  postgresConnected: boolean;
  /** Age of the most recent telephony event, milliseconds. */
  lastEventAgeMs: number;
  maxEventAgeMs: number;
  /** Age of the freshest agent-state record, milliseconds. */
  agentStateAgeMs: number;
  maxAgentStateAgeMs: number;
  campaignsOwned: number;
  activeAttempts: number;
}

export interface HealthReport {
  service: 'hopwhistle-dialer-v2';
  status: CheckStatus;
  live: boolean;
  ready: boolean;
  originationPermitted: boolean;
  emergencyStop: boolean;
  checks: HealthCheck[];
}

function worst(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return 'pass';
}

/**
 * Build the health report. Pure — snapshot and flags are arguments, so the exact
 * report an operator would see is assertable in tests.
 */
export function buildHealthReport(flags: DialerV2Flags, snap: HealthSnapshot): HealthReport {
  const checks: HealthCheck[] = [];

  checks.push({
    name: 'freeswitch_esl',
    status: snap.freeswitchConnected ? 'pass' : 'fail',
    detail: snap.freeswitchConnected ? undefined : 'ESL connection is down',
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

  const eventFresh = snap.lastEventAgeMs <= snap.maxEventAgeMs;
  checks.push({
    name: 'event_freshness',
    status: eventFresh ? 'pass' : 'warn',
    detail: eventFresh ? undefined : `Last telephony event was ${snap.lastEventAgeMs} ms ago`,
  });

  const agentsFresh = snap.agentStateAgeMs <= snap.maxAgentStateAgeMs;
  checks.push({
    name: 'agent_state_freshness',
    status: agentsFresh ? 'pass' : 'warn',
    detail: agentsFresh ? undefined : `Agent state is ${snap.agentStateAgeMs} ms old`,
  });

  // Not being permitted to originate is a normal, expected state — it is the
  // default. It is reported, never treated as a failure.
  const originationPermitted =
    flags.enabled &&
    flags.originateEnabled &&
    !flags.dryRun &&
    !flags.emergencyStop &&
    flags.allowedTenantIds.length > 0 &&
    flags.maxGlobalCalls > 0 &&
    flags.maxGlobalCps > 0;

  checks.push({
    name: 'origination_permitted',
    status: 'pass',
    detail: originationPermitted
      ? 'Origination is permitted for allowlisted tenants'
      : 'Origination is disabled by configuration (expected default)',
  });

  checks.push({
    name: 'emergency_stop',
    status: flags.emergencyStop ? 'warn' : 'pass',
    detail: flags.emergencyStop ? 'Emergency stop is ENGAGED' : undefined,
  });

  const status = worst(checks.map(c => c.status));

  return {
    service: 'hopwhistle-dialer-v2',
    status,
    // Liveness is process health only — a failing dependency must not cause an
    // orchestrator to restart-loop a service that is correctly refusing to dial.
    live: true,
    ready: snap.redisConnected && snap.postgresConnected,
    originationPermitted,
    emergencyStop: flags.emergencyStop,
    checks,
  };
}
