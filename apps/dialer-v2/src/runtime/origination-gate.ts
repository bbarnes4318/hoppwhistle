/**
 * Dialer V2 — the origination gate.
 *
 * This is the single decision point for "may Dialer V2 place a call right now".
 * It implements the fourteen conditions in the Master Engineering Mandate §3 and
 * `TARGET_ARCHITECTURE.md` §5.
 *
 * Two design decisions worth stating explicitly:
 *
 * 1. It returns EVERY failing condition, not the first one. The mandate (§22)
 *    requires that a supervisor can see exactly why a campaign is not dialing;
 *    a gate that short-circuits on the first failure can only ever answer that
 *    question one round-trip at a time.
 *
 * 2. It is pure. Health, capacity, schedule, and compliance results are gathered
 *    by the caller and passed in. That keeps the safety-critical logic
 *    exhaustively testable with no FreeSWITCH, no Redis, and no database, and it
 *    means the same function can be replayed against recorded state.
 */

import { type DialerV2Flags, isCampaignAllowed, isTenantAllowed } from '../config/flags.js';

export enum GateFailure {
  V2_DISABLED = 'V2_DISABLED',
  ORIGINATION_DISABLED = 'ORIGINATION_DISABLED',
  DRY_RUN = 'DRY_RUN',
  EMERGENCY_STOP = 'EMERGENCY_STOP',
  TENANT_NOT_ALLOWLISTED = 'TENANT_NOT_ALLOWLISTED',
  CAMPAIGN_NOT_ALLOWLISTED = 'CAMPAIGN_NOT_ALLOWLISTED',
  FREESWITCH_UNHEALTHY = 'FREESWITCH_UNHEALTHY',
  REDIS_UNHEALTHY = 'REDIS_UNHEALTHY',
  POSTGRES_UNHEALTHY = 'POSTGRES_UNHEALTHY',
  CAMPAIGN_NOT_ACTIVE = 'CAMPAIGN_NOT_ACTIVE',
  OUTSIDE_SCHEDULE = 'OUTSIDE_SCHEDULE',
  COMPLIANCE_BLOCKED = 'COMPLIANCE_BLOCKED',
  NO_CARRIER_CAPACITY = 'NO_CARRIER_CAPACITY',
  NO_CALLER_ID_AVAILABLE = 'NO_CALLER_ID_AVAILABLE',
  AGENT_STATE_STALE = 'AGENT_STATE_STALE',
  PACING_DISALLOWS = 'PACING_DISALLOWS',
  GLOBAL_CALL_CEILING = 'GLOBAL_CALL_CEILING',
  GLOBAL_CPS_CEILING = 'GLOBAL_CPS_CEILING',
  CAMPAIGN_NOT_ON_V2 = 'CAMPAIGN_NOT_ON_V2',
}

/** Human-readable text rendered verbatim in the supervisor UI. */
export const GATE_FAILURE_TEXT: Record<GateFailure, string> = {
  [GateFailure.V2_DISABLED]: 'Dialer V2 is disabled platform-wide.',
  [GateFailure.ORIGINATION_DISABLED]: 'Dialer V2 origination is disabled platform-wide.',
  [GateFailure.DRY_RUN]: 'Dialer V2 is in dry-run mode; calls are computed but never placed.',
  [GateFailure.EMERGENCY_STOP]: 'Emergency stop is engaged. No new calls will be placed.',
  [GateFailure.TENANT_NOT_ALLOWLISTED]: 'This tenant is not on the Dialer V2 allowlist.',
  [GateFailure.CAMPAIGN_NOT_ALLOWLISTED]: 'This campaign is not on the Dialer V2 allowlist.',
  [GateFailure.FREESWITCH_UNHEALTHY]: 'FreeSWITCH is not reachable.',
  [GateFailure.REDIS_UNHEALTHY]: 'Redis is unavailable, so call coordination cannot be guaranteed.',
  [GateFailure.POSTGRES_UNHEALTHY]: 'PostgreSQL is unavailable, so the attempt cannot be recorded.',
  [GateFailure.CAMPAIGN_NOT_ACTIVE]: 'The campaign is not active.',
  [GateFailure.OUTSIDE_SCHEDULE]: 'The campaign is outside its calling schedule.',
  [GateFailure.COMPLIANCE_BLOCKED]: 'A compliance rule blocked this call.',
  [GateFailure.NO_CARRIER_CAPACITY]: 'No carrier capacity is available.',
  [GateFailure.NO_CALLER_ID_AVAILABLE]: 'No authorised caller ID is available for this tenant.',
  [GateFailure.AGENT_STATE_STALE]: 'Agent state telemetry is stale.',
  [GateFailure.PACING_DISALLOWS]: 'The pacing controller is not requesting another call.',
  [GateFailure.GLOBAL_CALL_CEILING]: 'The platform-wide concurrent call ceiling has been reached.',
  [GateFailure.GLOBAL_CPS_CEILING]: 'The platform-wide calls-per-second ceiling has been reached.',
  [GateFailure.CAMPAIGN_NOT_ON_V2]: 'This campaign is not opted in to Dialer V2.',
};

export interface GateContext {
  tenantId: string;
  campaignId: string;
  /** From `dialer_v2_campaign_config.dialerVersion`. Only 2 may proceed. */
  campaignDialerVersion: number;

  freeswitchHealthy: boolean;
  redisHealthy: boolean;
  postgresHealthy: boolean;

  campaignActive: boolean;
  withinSchedule: boolean;

  compliancePassed: boolean;
  complianceDetail?: string;

  carrierCapacityAvailable: boolean;
  callerIdAvailable: boolean;

  /** Age of the freshest agent-state data, milliseconds. */
  agentStateAgeMs: number;
  maxAgentStateAgeMs: number;

  /** The pacing controller's decision for this tick. */
  pacingAllows: boolean;

  globalActiveCalls: number;
  globalCpsUsed: number;
}

export interface GateResult {
  allowed: boolean;
  failures: GateFailure[];
  /** Ordered, human-readable explanations for the supervisor UI. */
  explanations: string[];
}

/**
 * Evaluate all conditions. Never throws — a gate that can throw is a gate that
 * can be bypassed by an unhandled rejection somewhere up the stack.
 */
export function evaluateOriginationGate(flags: DialerV2Flags, ctx: GateContext): GateResult {
  const failures: GateFailure[] = [];

  // 1–4: platform switches.
  if (!flags.enabled) failures.push(GateFailure.V2_DISABLED);
  if (!flags.originateEnabled) failures.push(GateFailure.ORIGINATION_DISABLED);
  if (flags.dryRun) failures.push(GateFailure.DRY_RUN);
  if (flags.emergencyStop) failures.push(GateFailure.EMERGENCY_STOP);

  // 5–6: allowlists.
  if (!isTenantAllowed(flags, ctx.tenantId)) failures.push(GateFailure.TENANT_NOT_ALLOWLISTED);
  if (!isCampaignAllowed(flags, ctx.campaignId))
    failures.push(GateFailure.CAMPAIGN_NOT_ALLOWLISTED);

  // The campaign must have explicitly opted in to V2. This is what keeps the
  // Hopper and Dialer V2 from ever contending for the same campaign.
  if (ctx.campaignDialerVersion !== 2) failures.push(GateFailure.CAMPAIGN_NOT_ON_V2);

  // 7–9: dependency health.
  if (!ctx.freeswitchHealthy) failures.push(GateFailure.FREESWITCH_UNHEALTHY);
  if (!ctx.redisHealthy) failures.push(GateFailure.REDIS_UNHEALTHY);
  if (!ctx.postgresHealthy) failures.push(GateFailure.POSTGRES_UNHEALTHY);

  // 10: campaign status and schedule.
  if (!ctx.campaignActive) failures.push(GateFailure.CAMPAIGN_NOT_ACTIVE);
  if (!ctx.withinSchedule) failures.push(GateFailure.OUTSIDE_SCHEDULE);

  // 11: compliance.
  if (!ctx.compliancePassed) failures.push(GateFailure.COMPLIANCE_BLOCKED);

  // 12: carrier and caller-ID capacity.
  if (!ctx.carrierCapacityAvailable) failures.push(GateFailure.NO_CARRIER_CAPACITY);
  if (!ctx.callerIdAvailable) failures.push(GateFailure.NO_CALLER_ID_AVAILABLE);

  // 13: agent-state freshness, only enforced when configured to be.
  if (flags.requireHealthyAgentHeartbeats && ctx.agentStateAgeMs > ctx.maxAgentStateAgeMs) {
    failures.push(GateFailure.AGENT_STATE_STALE);
  }

  // 14: pacing.
  if (!ctx.pacingAllows) failures.push(GateFailure.PACING_DISALLOWS);

  // Platform ceilings.
  if (ctx.globalActiveCalls >= flags.maxGlobalCalls) failures.push(GateFailure.GLOBAL_CALL_CEILING);
  if (ctx.globalCpsUsed >= flags.maxGlobalCps) failures.push(GateFailure.GLOBAL_CPS_CEILING);

  const explanations = failures.map(f => {
    if (f === GateFailure.COMPLIANCE_BLOCKED && ctx.complianceDetail) {
      return `${GATE_FAILURE_TEXT[f]} (${ctx.complianceDetail})`;
    }
    return GATE_FAILURE_TEXT[f];
  });

  return { allowed: failures.length === 0, failures, explanations };
}

/**
 * A context in which every non-flag condition is satisfied. Used by tests to
 * isolate one variable at a time, and by the preflight UI as the "everything
 * else is fine" baseline. Not exported into runtime call paths.
 */
export function permissiveContext(overrides: Partial<GateContext> = {}): GateContext {
  return {
    tenantId: 'tenant-test',
    campaignId: 'campaign-test',
    campaignDialerVersion: 2,
    freeswitchHealthy: true,
    redisHealthy: true,
    postgresHealthy: true,
    campaignActive: true,
    withinSchedule: true,
    compliancePassed: true,
    carrierCapacityAvailable: true,
    callerIdAvailable: true,
    agentStateAgeMs: 0,
    maxAgentStateAgeMs: 10_000,
    pacingAllows: true,
    globalActiveCalls: 0,
    globalCpsUsed: 0,
    ...overrides,
  };
}
