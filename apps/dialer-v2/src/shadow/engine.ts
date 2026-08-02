/**
 * Dialer V2 — shadow mode.
 *
 * Runs the real pacing controller against real observed state and records what
 * it WOULD have done. It never originates a call.
 *
 * That guarantee is structural, not a matter of discipline: this module does not
 * import the ESL client, does not receive a transport, and has no reference to
 * anything that can write to FreeSWITCH. The strongest statement available is
 * "there is no code path from here to an originate", and that is the statement
 * the tests assert.
 */

import type { CapacitySnapshot } from '../agents/service.js';
import { isCampaignAllowed, isTenantAllowed, type DialerV2Flags } from '../config/flags.js';
import {
  DialingMode,
  decidePacing,
  type PacingDecision,
  type PacingInputs,
  type PacingState,
} from '../pacing/controller.js';

export const CONTROLLER_VERSION = '1.1.0';

/** Live call counts for one campaign, derived from ingested telephony events. */
export interface CallObservation {
  dialing: number;
  ringing: number;
  answered: number;
  bridged: number;
  /** Answered by a human with no agent connected yet — the abandonment risk. */
  liveAnswersWaiting: number;
}

/** Rolling measurements for one campaign. */
export interface RateObservation {
  attempts: number;
  liveAnswers: number;
  meanAnswerLatencyMs: number;
  p95AnswerLatencyMs: number;
  meanHandleTimeMs: number;
  meanWrapUpMs: number;
  abandonRate: number;
  abandonSampleSize: number;
  assignmentLatencyMsP95: number;
}

export interface CampaignPolicy {
  tenantId: string;
  campaignId: string;
  configuredMode: DialingMode;
  targetOccupancy: number;
  abandonTarget: number;
  abandonWarn: number;
  maxLinesPerAgent: number;
  powerLinesPerAvailableAgent: number;
  maxCps: number;
  campaignConcurrencyRemaining: number;
  tenantConcurrencyRemaining: number;
  gatewayCapacityRemaining: number;
  callableLeads: number;
  minSampleSize: number;
  minAbandonSample: number;
  assignmentDeadlineMs: number;
}

export interface HealthObservation {
  eslHealthy: boolean;
  redisHealthy: boolean;
  eventLagMs: number;
  maxEventLagMs: number;
  agentStateAgeMs: number;
  maxAgentStateAgeMs: number;
}

export interface ShadowObservation {
  nowMs: number;
  policy: CampaignPolicy;
  capacity: CapacitySnapshot;
  calls: CallObservation;
  rates: RateObservation;
  health: HealthObservation;
}

/** Why the shadow engine declined to even run the controller. */
export enum ShadowBlockReason {
  V2_DISABLED = 'V2_DISABLED',
  SHADOW_DISABLED = 'SHADOW_DISABLED',
  EMERGENCY_STOP = 'EMERGENCY_STOP',
  TENANT_NOT_ALLOWLISTED = 'TENANT_NOT_ALLOWLISTED',
  CAMPAIGN_NOT_ALLOWLISTED = 'CAMPAIGN_NOT_ALLOWLISTED',
}

export interface ShadowDecisionRecord {
  tenantId: string;
  campaignId: string;
  decidedAtMs: number;
  controllerVersion: string;
  /** Full input vector, so the decision is reproducible offline. */
  inputs: PacingInputs;
  decision: PacingDecision | null;
  /** What the dialer WOULD have originated. Always hypothetical. */
  recommendedOriginateCount: number;
  bindingConstraint: string;
  degradationMode: string;
  safetyReasons: string[];
  blockedBy: ShadowBlockReason[];
  /** Invariant: always false. Asserted by tests. */
  originated: false;
  /** Plain-English answer to "why would the dialer act this way right now?" */
  explanation: string;
}

export interface ShadowDecisionStore {
  record(decision: ShadowDecisionRecord): Promise<void>;
  recent(tenantId: string, limit: number, campaignId?: string): Promise<ShadowDecisionRecord[]>;
}

export class InMemoryShadowDecisionStore implements ShadowDecisionStore {
  private readonly decisions: ShadowDecisionRecord[] = [];

  constructor(private readonly max = 2_000) {}

  record(decision: ShadowDecisionRecord): Promise<void> {
    this.decisions.push(decision);
    if (this.decisions.length > this.max) {
      this.decisions.splice(0, this.decisions.length - this.max);
    }
    return Promise.resolve();
  }

  recent(tenantId: string, limit: number, campaignId?: string): Promise<ShadowDecisionRecord[]> {
    const out: ShadowDecisionRecord[] = [];
    for (let i = this.decisions.length - 1; i >= 0 && out.length < limit; i--) {
      const d = this.decisions[i];
      if (d.tenantId !== tenantId) continue;
      if (campaignId && d.campaignId !== campaignId) continue;
      out.push(d);
    }
    return Promise.resolve(out);
  }

  size(): number {
    return this.decisions.length;
  }
}

/** Build the controller's input vector from observed state. Pure. */
export function buildPacingInputs(obs: ShadowObservation): PacingInputs {
  const { policy, capacity, calls, rates, health } = obs;
  return {
    nowMs: obs.nowMs,
    tickSeconds: 1,
    configuredMode: policy.configuredMode,

    agentsEligible: capacity.eligible,
    agentsAvailable: capacity.available,
    agentsReserved: capacity.reserved,
    agentsOnCall: capacity.onCall,
    agentsWrapUp: capacity.wrapUp,

    // Ringing calls have not resolved yet, so they belong with dialing.
    callsDialing: calls.dialing + calls.ringing,
    callsLiveWaiting: calls.liveAnswersWaiting,
    callsBridged: calls.bridged,

    liveAnswers: rates.liveAnswers,
    attempts: rates.attempts,
    meanAnswerLatencyMs: rates.meanAnswerLatencyMs,
    p95AnswerLatencyMs: rates.p95AnswerLatencyMs,
    meanHandleTimeMs: rates.meanHandleTimeMs,
    meanWrapUpMs: rates.meanWrapUpMs,
    abandonRate: rates.abandonRate,
    abandonSampleSize: rates.abandonSampleSize,
    assignmentLatencyMsP95: rates.assignmentLatencyMsP95,

    maxLinesPerAgent: policy.maxLinesPerAgent,
    powerLinesPerAvailableAgent: policy.powerLinesPerAvailableAgent,
    campaignConcurrencyRemaining: policy.campaignConcurrencyRemaining,
    tenantConcurrencyRemaining: policy.tenantConcurrencyRemaining,
    gatewayCapacityRemaining: policy.gatewayCapacityRemaining,
    maxCps: policy.maxCps,
    callableLeads: policy.callableLeads,

    targetOccupancy: policy.targetOccupancy,
    abandonTarget: policy.abandonTarget,
    abandonWarn: policy.abandonWarn,
    minSampleSize: policy.minSampleSize,
    minAbandonSample: policy.minAbandonSample,
    assignmentDeadlineMs: policy.assignmentDeadlineMs,

    eventLagMs: health.eventLagMs,
    maxEventLagMs: health.maxEventLagMs,
    agentStateAgeMs: health.agentStateAgeMs,
    maxAgentStateAgeMs: health.maxAgentStateAgeMs,
    redisHealthy: health.redisHealthy,
    eslHealthy: health.eslHealthy,
    // Shadow mode always evaluates the controller as if the stop were clear, so
    // the recorded decision reflects pacing logic rather than the kill switch.
    // The switch is recorded separately in `blockedBy`.
    emergencyStop: false,
  };
}

/** Plain-English rendering of the decision for the supervisor screen. */
export function explainDecision(
  decision: PacingDecision | null,
  blockedBy: ShadowBlockReason[],
  obs: ShadowObservation
): string {
  if (blockedBy.length > 0) {
    return `Shadow evaluation is not running: ${blockedBy.join(', ')}.`;
  }
  if (!decision) return 'No decision was produced.';

  if (decision.originateCount === 0) {
    return `The dialer would place no calls. Limiting factor: ${decision.bindingConstraint}.`;
  }

  const parts = [
    `The dialer would place ${decision.originateCount} call(s) in ${decision.mode} mode`,
    `against ${obs.capacity.available} available agent(s)`,
    `at an estimated ${(decision.pLive * 100).toFixed(1)}% live-answer rate`,
    `(limiting factor: ${decision.bindingConstraint})`,
  ];
  if (decision.mode !== obs.policy.configuredMode) {
    parts.push(`— degraded from configured ${obs.policy.configuredMode}`);
  }
  if (obs.capacity.stale > 0) {
    parts.push(`— ${obs.capacity.stale} agent(s) excluded as stale`);
  }
  return `${parts.join(' ')}.`;
}

export class ShadowEngine {
  private readonly lastState = new Map<string, PacingState>();

  constructor(private readonly store: ShadowDecisionStore) {}

  /**
   * Evaluate one campaign and persist the hypothetical decision.
   * Returns the record. Never originates.
   */
  async evaluate(flags: DialerV2Flags, obs: ShadowObservation): Promise<ShadowDecisionRecord> {
    const { tenantId, campaignId } = obs.policy;

    const blockedBy: ShadowBlockReason[] = [];
    if (!flags.enabled) blockedBy.push(ShadowBlockReason.V2_DISABLED);
    if (!flags.shadowEnabled) blockedBy.push(ShadowBlockReason.SHADOW_DISABLED);
    if (flags.emergencyStop) blockedBy.push(ShadowBlockReason.EMERGENCY_STOP);
    if (!isTenantAllowed(flags, tenantId)) blockedBy.push(ShadowBlockReason.TENANT_NOT_ALLOWLISTED);
    if (!isCampaignAllowed(flags, campaignId)) {
      blockedBy.push(ShadowBlockReason.CAMPAIGN_NOT_ALLOWLISTED);
    }

    const inputs = buildPacingInputs(obs);

    let decision: PacingDecision | null = null;
    if (blockedBy.length === 0) {
      const key = `${tenantId} ${campaignId}`;
      const prev = this.lastState.get(key) ?? { originateCount: 0 };
      decision = decidePacing(inputs, prev);
      this.lastState.set(key, { originateCount: decision.originateCount });
    }

    const record: ShadowDecisionRecord = {
      tenantId,
      campaignId,
      decidedAtMs: obs.nowMs,
      controllerVersion: CONTROLLER_VERSION,
      inputs,
      decision,
      recommendedOriginateCount: decision?.originateCount ?? 0,
      bindingConstraint: decision?.bindingConstraint ?? 'NOT_EVALUATED',
      degradationMode: decision?.mode ?? obs.policy.configuredMode,
      safetyReasons: decision?.reasons ?? [],
      blockedBy,
      originated: false,
      explanation: explainDecision(decision, blockedBy, obs),
    };

    await this.store.record(record);
    return record;
  }
}
