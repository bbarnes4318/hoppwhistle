/**
 * Dialer V2 — adaptive pacing controller.
 *
 * Normative spec: `docs/dialer-v2/PREDICTIVE_PACING_SPEC.md`.
 *
 * This function is PURE: no I/O, no `Date.now()`, no randomness. `nowMs` is an
 * input. That is what makes replay, shadow-mode comparison, and the
 * deterministic simulator possible, and it means the highest-risk logic in the
 * product is testable without FreeSWITCH, Redis, or a database.
 *
 * The controller is deliberately transparent statistics — Beta-Binomial
 * smoothing and an exponential survival model — rather than anything opaque.
 * Every number it produces is traceable to a measured input, and every decision
 * carries the constraint that actually bound it.
 */

export enum DialingMode {
  MANUAL = 'MANUAL',
  CLICK_TO_CALL = 'CLICK_TO_CALL',
  PREVIEW = 'PREVIEW',
  PROGRESSIVE = 'PROGRESSIVE',
  POWER = 'POWER',
  PREDICTIVE = 'PREDICTIVE',
  AGENTLESS = 'AGENTLESS',
  AI_VOICE = 'AI_VOICE',
  AI_TO_HUMAN_TRANSFER = 'AI_TO_HUMAN_TRANSFER',
  INBOUND = 'INBOUND',
  BLENDED = 'BLENDED',
}

/**
 * Aggression ordering for automatic degradation. A configured mode is a CEILING,
 * never a floor — a PREDICTIVE campaign may run PROGRESSIVE, but a PROGRESSIVE
 * campaign never runs PREDICTIVE.
 */
const MODE_RANK: Partial<Record<DialingMode, number>> = {
  [DialingMode.MANUAL]: 0,
  [DialingMode.CLICK_TO_CALL]: 0,
  [DialingMode.PREVIEW]: 1,
  [DialingMode.PROGRESSIVE]: 2,
  [DialingMode.POWER]: 3,
  [DialingMode.PREDICTIVE]: 4,
};

export enum PacingReason {
  EMERGENCY_STOP = 'EMERGENCY_STOP',
  REDIS_UNHEALTHY = 'REDIS_UNHEALTHY',
  ESL_UNHEALTHY = 'ESL_UNHEALTHY',
  AGENT_STATE_STALE = 'AGENT_STATE_STALE',
  EVENT_LAG = 'EVENT_LAG',
  ABANDON_LIMIT_REACHED = 'ABANDON_LIMIT_REACHED',
  NO_CALLABLE_LEADS = 'NO_CALLABLE_LEADS',
  NO_ELIGIBLE_AGENTS = 'NO_ELIGIBLE_AGENTS',
  NO_AVAILABLE_CAPACITY = 'NO_AVAILABLE_CAPACITY',
  AGENT_CAPACITY = 'AGENT_CAPACITY',
  MAX_LINES_PER_AGENT = 'MAX_LINES_PER_AGENT',
  CAMPAIGN_CONCURRENCY = 'CAMPAIGN_CONCURRENCY',
  TENANT_CONCURRENCY = 'TENANT_CONCURRENCY',
  GATEWAY_CAPACITY = 'GATEWAY_CAPACITY',
  MAX_CPS = 'MAX_CPS',
  LEAD_INVENTORY = 'LEAD_INVENTORY',
  RAMP_LIMIT = 'RAMP_LIMIT',
  ABANDON_DAMPING = 'ABANDON_DAMPING',
  ASSIGNMENT_LATENCY_DAMPING = 'ASSIGNMENT_LATENCY_DAMPING',
  MODE_DEGRADED = 'MODE_DEGRADED',
}

export const PACING_REASON_TEXT: Record<PacingReason, string> = {
  [PacingReason.EMERGENCY_STOP]: 'Emergency stop is engaged.',
  [PacingReason.REDIS_UNHEALTHY]: 'Redis is unavailable; call coordination cannot be guaranteed.',
  [PacingReason.ESL_UNHEALTHY]: 'FreeSWITCH is not reachable.',
  [PacingReason.AGENT_STATE_STALE]:
    'Agent state telemetry is stale; agents cannot be counted as capacity.',
  [PacingReason.EVENT_LAG]: 'Telephony event lag exceeds the pacing budget.',
  [PacingReason.ABANDON_LIMIT_REACHED]:
    'Abandonment has reached the configured ceiling; the campaign is pausing.',
  [PacingReason.NO_CALLABLE_LEADS]: 'No callable leads remain.',
  [PacingReason.NO_ELIGIBLE_AGENTS]: 'No eligible agents are logged in.',
  [PacingReason.NO_AVAILABLE_CAPACITY]: 'No agent capacity is forecast within the pacing horizon.',
  [PacingReason.AGENT_CAPACITY]: 'Pacing is matched to forecast agent capacity.',
  [PacingReason.MAX_LINES_PER_AGENT]: 'The maximum lines-per-agent safety ceiling is binding.',
  [PacingReason.CAMPAIGN_CONCURRENCY]: 'The campaign concurrent-call limit is binding.',
  [PacingReason.TENANT_CONCURRENCY]: 'The tenant concurrent-call limit is binding.',
  [PacingReason.GATEWAY_CAPACITY]: 'Carrier capacity is binding.',
  [PacingReason.MAX_CPS]: 'The calls-per-second limit is binding.',
  [PacingReason.LEAD_INVENTORY]: 'Remaining lead inventory is binding.',
  [PacingReason.RAMP_LIMIT]: 'Pacing is ramping up gradually to avoid oscillation.',
  [PacingReason.ABANDON_DAMPING]:
    'Pacing is reduced because abandonment is above the warning threshold.',
  [PacingReason.ASSIGNMENT_LATENCY_DAMPING]: 'Pacing is reduced because agent assignment is slow.',
  [PacingReason.MODE_DEGRADED]: 'Dialing mode was automatically degraded.',
};

export interface PacingInputs {
  nowMs: number;
  tickSeconds: number;

  configuredMode: DialingMode;

  // Agent capacity
  agentsEligible: number;
  agentsAvailable: number;
  agentsReserved: number;
  agentsOnCall: number;
  agentsWrapUp: number;

  // Calls in flight
  callsDialing: number;
  callsLiveWaiting: number;
  callsBridged: number;

  // Measured rates over the rolling window
  liveAnswers: number;
  attempts: number;
  meanAnswerLatencyMs: number;
  p95AnswerLatencyMs: number;
  meanHandleTimeMs: number;
  meanWrapUpMs: number;
  abandonRate: number;
  /**
   * Number of live-answered calls the abandonment rate was computed from. A 3%
   * rate is not representable below ~34 samples; without this the controller
   * reads one abandoned call in a quiet window as a 12% breach.
   */
  abandonSampleSize: number;
  assignmentLatencyMsP95: number;

  // Limits
  maxLinesPerAgent: number;
  powerLinesPerAvailableAgent: number;
  campaignConcurrencyRemaining: number;
  tenantConcurrencyRemaining: number;
  gatewayCapacityRemaining: number;
  maxCps: number;
  callableLeads: number;

  // Policy
  targetOccupancy: number;
  abandonTarget: number;
  abandonWarn: number;
  minSampleSize: number;
  /** Live answers required before the abandonment rate is acted on at all. */
  minAbandonSample: number;
  assignmentDeadlineMs: number;

  // Health
  eventLagMs: number;
  maxEventLagMs: number;
  agentStateAgeMs: number;
  maxAgentStateAgeMs: number;
  redisHealthy: boolean;
  eslHealthy: boolean;
  emergencyStop: boolean;
}

export interface PacingState {
  /** What the previous tick decided. Drives the ramp limit. */
  originateCount: number;
}

export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PacingDecision {
  originateCount: number;
  mode: DialingMode;
  reasons: PacingReason[];
  bindingConstraint: PacingReason;
  /** The upper-bound estimate the controller divided by. */
  pLive: number;
  /** The posterior mean live-answer rate, for reporting. */
  pLiveMean: number;
  predictedCapacity: number;
  predictedLiveAnswers: number;
  confidence: Confidence;
  /** True when abandonment has hit the hard ceiling and the campaign must pause. */
  pauseCampaign: boolean;
  /** True when abandonment is above the internal warning threshold. */
  abandonWarning: boolean;
  horizonMs: number;
}

/**
 * Beta prior: mean 0.10, weight 20. The prior mean is only used for reporting;
 * safety comes from `pacingLiveAnswerProbability`, which uses the upper bound —
 * see the note there on why the direction of this estimate is easy to invert.
 */
export const PRIOR_ALPHA = 2;
export const PRIOR_BETA = 18;

/** Numerical guard only. The real protection is MAX_LINES_PER_AGENT. */
export const P_LIVE_FLOOR = 0.01;

/**
 * Standard deviations of Poisson arrival variance held back from the capacity
 * target. Tuned against the simulator: see `simulator.test.ts`.
 */
export const SAFETY_Z = 1.5;

const HORIZON_MIN_MS = 3_000;
const HORIZON_MAX_MS = 30_000;

/** Minimum agent pool below which predictive dialing is statistically indefensible. */
export const PREDICTIVE_MIN_AGENTS = 8;
export const POWER_MIN_AGENTS = 4;

export const DEFAULT_PACING_STATE: PacingState = Object.freeze({ originateCount: 0 });

/**
 * True when enough live answers have accumulated for the abandonment rate to
 * mean anything. Below this the controller neither brakes nor pauses on it —
 * early safety comes from progressive-mode start, the ramp limit, and the
 * lines-per-agent ceiling, all of which are active from the first tick.
 */
function abandonMeasurable(inputs: PacingInputs): boolean {
  return inputs.abandonSampleSize >= inputs.minAbandonSample;
}

function clampNonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Smoothed probability that a newly originated call reaches a live human.
 * Beta-Binomial posterior mean; the prior washes out as attempts accumulate.
 * Used for reporting.
 */
export function liveAnswerProbability(liveAnswers: number, attempts: number): number {
  const a = clampNonNegative(liveAnswers);
  const n = Math.max(clampNonNegative(attempts), a);
  const p = (a + PRIOR_ALPHA) / (n + PRIOR_ALPHA + PRIOR_BETA);
  return Math.min(1, Math.max(P_LIVE_FLOOR, p));
}

/**
 * The value the controller actually divides by — an UPPER credible bound on the
 * live-answer rate, not the posterior mean.
 *
 * This direction matters and is easy to get backwards. Demand is
 * `deficit / pLive`, so a LOW estimate of the answer rate produces MORE calls.
 * Using the posterior mean therefore over-dials whenever the estimate is
 * uncertain — exactly when over-dialing is most dangerous. Using the upper bound
 * inverts that: wide uncertainty ⇒ high assumed answer rate ⇒ fewer calls, and
 * the bound tightens onto the observed rate as evidence accumulates.
 *
 * Two standard deviations of the Beta posterior ≈ a 95% bound.
 */
export function pacingLiveAnswerProbability(liveAnswers: number, attempts: number): number {
  const a = clampNonNegative(liveAnswers);
  const n = Math.max(clampNonNegative(attempts), a);
  const total = n + PRIOR_ALPHA + PRIOR_BETA;
  const mean = (a + PRIOR_ALPHA) / total;
  const sd = Math.sqrt((mean * (1 - mean)) / total);
  return Math.min(1, Math.max(P_LIVE_FLOOR, mean + 2 * sd));
}

/**
 * Probability an in-progress activity of mean duration `meanMs` completes within
 * `horizonMs`, under an exponential survival model. Chosen for transparency: one
 * parameter, monotone in the measured mean, and its error is directly observable
 * as a forecast-error metric.
 */
export function completionProbability(horizonMs: number, meanMs: number): number {
  if (!Number.isFinite(meanMs) || meanMs <= 0) return 1;
  if (!Number.isFinite(horizonMs) || horizonMs <= 0) return 0;
  return 1 - Math.exp(-horizonMs / meanMs);
}

function resolveHorizonMs(inputs: PacingInputs): number {
  const raw = Number.isFinite(inputs.p95AnswerLatencyMs) ? inputs.p95AnswerLatencyMs : 0;
  return Math.min(HORIZON_MAX_MS, Math.max(HORIZON_MIN_MS, raw));
}

/** Forecast agents that will free up within the horizon (spec §4.3). */
export function forecastCapacity(inputs: PacingInputs, horizonMs: number): number {
  const freeingFromCalls =
    clampNonNegative(inputs.agentsOnCall) *
    completionProbability(horizonMs, inputs.meanHandleTimeMs);
  const freeingFromWrap =
    clampNonNegative(inputs.agentsWrapUp) * completionProbability(horizonMs, inputs.meanWrapUpMs);
  const capacity =
    clampNonNegative(inputs.agentsAvailable) +
    freeingFromCalls +
    freeingFromWrap -
    clampNonNegative(inputs.agentsReserved);
  return Math.max(0, capacity);
}

function resolveConfidence(inputs: PacingInputs): Confidence {
  const { attempts, agentsEligible, minSampleSize } = inputs;
  if (attempts >= minSampleSize && agentsEligible >= PREDICTIVE_MIN_AGENTS) return 'HIGH';
  if (attempts >= minSampleSize / 2 && agentsEligible >= POWER_MIN_AGENTS) return 'MEDIUM';
  return 'LOW';
}

function modeForConfidence(confidence: Confidence): DialingMode {
  if (confidence === 'HIGH') return DialingMode.PREDICTIVE;
  if (confidence === 'MEDIUM') return DialingMode.POWER;
  return DialingMode.PROGRESSIVE;
}

/**
 * Apply the configured mode as a ceiling. Modes outside the automatic
 * progression (AI_VOICE, INBOUND, AGENTLESS, …) are returned unchanged: the
 * degradation ladder does not apply to them.
 */
function resolveEffectiveMode(configured: DialingMode, byConfidence: DialingMode): DialingMode {
  const configuredRank = MODE_RANK[configured];
  const confidenceRank = MODE_RANK[byConfidence];
  if (configuredRank === undefined || confidenceRank === undefined) return configured;
  return confidenceRank < configuredRank ? byConfidence : configured;
}

/**
 * Damping multiplier from abandonment.
 *
 * Braking starts as soon as abandonment is non-zero and tightens quadratically
 * toward the ceiling. An earlier design only braked between the warning
 * threshold and the hard ceiling; measured against the simulator that produced a
 * bang-bang loop — dial hard, breach the ceiling, hard-stop, resume, breach
 * again — settling around 12% abandonment against a 3% target. Continuous
 * proportional braking converges instead of oscillating.
 *
 * Quadratic rather than linear so that a well-run campaign at a small fraction
 * of the ceiling is barely penalised, while one approaching it decelerates hard.
 */
export function abandonDamping(abandonRate: number, target: number): number {
  if (!Number.isFinite(abandonRate) || abandonRate <= 0) return 1;
  if (target <= 0) return 0;
  if (abandonRate >= target) return 0;
  const ratio = abandonRate / target;
  return Math.max(0, 1 - ratio * ratio);
}

/**
 * Damping from slow agent assignment. Linear from full rate at the deadline to
 * zero at twice the deadline: if it is taking 4 s to connect an answered call to
 * an agent, placing more calls makes the problem strictly worse.
 */
export function assignmentLatencyDamping(latencyP95Ms: number, deadlineMs: number): number {
  if (!Number.isFinite(latencyP95Ms) || deadlineMs <= 0 || latencyP95Ms <= deadlineMs) return 1;
  if (latencyP95Ms >= deadlineMs * 2) return 0;
  return 1 - (latencyP95Ms - deadlineMs) / deadlineMs;
}

interface Cap {
  reason: PacingReason;
  value: number;
}

function hardStop(
  reason: PacingReason,
  inputs: PacingInputs,
  horizonMs: number,
  pauseCampaign = false
): PacingDecision {
  return {
    originateCount: 0,
    mode: DialingMode.PROGRESSIVE,
    reasons: [reason],
    bindingConstraint: reason,
    pLive: pacingLiveAnswerProbability(inputs.liveAnswers, inputs.attempts),
    pLiveMean: liveAnswerProbability(inputs.liveAnswers, inputs.attempts),
    predictedCapacity: 0,
    predictedLiveAnswers: 0,
    confidence: 'LOW',
    pauseCampaign,
    abandonWarning: abandonMeasurable(inputs) && inputs.abandonRate >= inputs.abandonWarn,
    horizonMs,
  };
}

/**
 * Decide how many calls to originate on this tick.
 *
 * Every failure mode degrades toward FEWER calls. There is no input combination
 * — including impossible or corrupted telemetry — for which uncertainty
 * increases call volume.
 */
export function decidePacing(
  inputs: PacingInputs,
  prev: PacingState = DEFAULT_PACING_STATE
): PacingDecision {
  const horizonMs = resolveHorizonMs(inputs);

  // ---- §4.1 hard stops, in order -----------------------------------------
  if (inputs.emergencyStop) return hardStop(PacingReason.EMERGENCY_STOP, inputs, horizonMs);
  if (!inputs.redisHealthy) return hardStop(PacingReason.REDIS_UNHEALTHY, inputs, horizonMs);
  if (!inputs.eslHealthy) return hardStop(PacingReason.ESL_UNHEALTHY, inputs, horizonMs);
  if (inputs.agentStateAgeMs > inputs.maxAgentStateAgeMs) {
    return hardStop(PacingReason.AGENT_STATE_STALE, inputs, horizonMs);
  }
  if (inputs.eventLagMs > inputs.maxEventLagMs) {
    return hardStop(PacingReason.EVENT_LAG, inputs, horizonMs);
  }
  if (abandonMeasurable(inputs) && inputs.abandonRate >= inputs.abandonTarget) {
    return hardStop(PacingReason.ABANDON_LIMIT_REACHED, inputs, horizonMs, true);
  }
  if (clampNonNegative(inputs.callableLeads) === 0) {
    return hardStop(PacingReason.NO_CALLABLE_LEADS, inputs, horizonMs);
  }
  if (clampNonNegative(inputs.agentsEligible) === 0) {
    return hardStop(PacingReason.NO_ELIGIBLE_AGENTS, inputs, horizonMs);
  }

  // ---- §4.2 / §4.3 estimation --------------------------------------------
  const pLive = pacingLiveAnswerProbability(inputs.liveAnswers, inputs.attempts);
  const pLiveMean = liveAnswerProbability(inputs.liveAnswers, inputs.attempts);
  const predictedCapacity = forecastCapacity(inputs, horizonMs);
  const confidence = resolveConfidence(inputs);
  const mode = resolveEffectiveMode(inputs.configuredMode, modeForConfidence(confidence));

  const reasons: PacingReason[] = [];
  if (mode !== inputs.configuredMode) reasons.push(PacingReason.MODE_DEGRADED);

  // ---- §4.4 demand -------------------------------------------------------
  const callsDialing = clampNonNegative(inputs.callsDialing);
  const inflightLive = callsDialing * pLive + clampNonNegative(inputs.callsLiveWaiting);

  let rawCount: number;
  let demandReason: PacingReason;

  if (mode === DialingMode.PROGRESSIVE || mode === DialingMode.PREVIEW) {
    // One call per genuinely available agent. Progressive can never
    // intentionally create more live answers than available agents.
    rawCount = clampNonNegative(inputs.agentsAvailable) - callsDialing;
    demandReason = PacingReason.AGENT_CAPACITY;
  } else if (mode === DialingMode.POWER) {
    const ratio = Math.max(1, inputs.powerLinesPerAvailableAgent);
    rawCount = clampNonNegative(inputs.agentsAvailable) * ratio - callsDialing;
    demandReason = PacingReason.AGENT_CAPACITY;
  } else {
    // Live answers arrive as a roughly Poisson process, so the count that shows
    // up in any short interval has standard deviation ~sqrt(mean). Aiming at the
    // mean therefore overshoots capacity about half the time, and every
    // overshoot is an abandoned call to a real person. Hold back a buffer of
    // `SAFETY_Z` standard deviations.
    //
    // The buffer is proportionally larger for small campaigns — sqrt(4)/4 = 50%
    // of a 4-agent target versus sqrt(100)/100 = 10% of a 100-agent one — which
    // is the same reason predictive dialing is gated on a minimum agent pool.
    const nominalTarget = predictedCapacity * inputs.targetOccupancy;
    const targetLive = Math.max(0, nominalTarget - SAFETY_Z * Math.sqrt(nominalTarget));
    const deficitLive = targetLive - inflightLive;
    rawCount = deficitLive <= 0 ? 0 : Math.ceil(deficitLive / pLive);
    demandReason = PacingReason.AGENT_CAPACITY;
  }

  rawCount = Math.max(0, Math.floor(rawCount));

  if (rawCount === 0) {
    return {
      originateCount: 0,
      mode,
      reasons: [...reasons, PacingReason.NO_AVAILABLE_CAPACITY],
      bindingConstraint: PacingReason.NO_AVAILABLE_CAPACITY,
      pLive,
      pLiveMean,
      predictedCapacity,
      predictedLiveAnswers: inflightLive,
      confidence,
      pauseCampaign: false,
      abandonWarning: abandonMeasurable(inputs) && inputs.abandonRate >= inputs.abandonWarn,
      horizonMs,
    };
  }

  // ---- §4.6 damping ------------------------------------------------------
  const abandonFactor = abandonMeasurable(inputs)
    ? abandonDamping(inputs.abandonRate, inputs.abandonTarget)
    : 1;
  const latencyFactor = assignmentLatencyDamping(
    inputs.assignmentLatencyMsP95,
    inputs.assignmentDeadlineMs
  );

  let damped = rawCount;
  if (abandonFactor < 1) {
    damped = Math.floor(damped * abandonFactor);
    reasons.push(PacingReason.ABANDON_DAMPING);
  }
  if (latencyFactor < 1) {
    damped = Math.floor(damped * latencyFactor);
    reasons.push(PacingReason.ASSIGNMENT_LATENCY_DAMPING);
  }

  // ---- §4.5 constraints --------------------------------------------------
  const caps: Cap[] = [
    {
      reason: PacingReason.MAX_LINES_PER_AGENT,
      value: inputs.maxLinesPerAgent * clampNonNegative(inputs.agentsEligible) - callsDialing,
    },
    { reason: PacingReason.CAMPAIGN_CONCURRENCY, value: inputs.campaignConcurrencyRemaining },
    { reason: PacingReason.TENANT_CONCURRENCY, value: inputs.tenantConcurrencyRemaining },
    { reason: PacingReason.GATEWAY_CAPACITY, value: inputs.gatewayCapacityRemaining },
    { reason: PacingReason.MAX_CPS, value: Math.floor(inputs.maxCps * inputs.tickSeconds) },
    { reason: PacingReason.LEAD_INVENTORY, value: inputs.callableLeads },
    // Growth is geometric-with-offset so a campaign can ramp from zero, but a
    // spike is impossible. Reduction is deliberately NOT rate-limited.
    { reason: PacingReason.RAMP_LIMIT, value: Math.floor(prev.originateCount * 1.5 + 1) },
  ];

  let originateCount = damped;
  let bindingConstraint = damped < rawCount ? PacingReason.ABANDON_DAMPING : demandReason;
  if (damped < rawCount && latencyFactor < 1 && abandonFactor === 1) {
    bindingConstraint = PacingReason.ASSIGNMENT_LATENCY_DAMPING;
  }

  for (const cap of caps) {
    const capped = Math.max(0, Math.floor(cap.value));
    if (capped < originateCount) {
      originateCount = capped;
      bindingConstraint = cap.reason;
      if (!reasons.includes(cap.reason)) reasons.push(cap.reason);
    }
  }

  if (originateCount === 0 && bindingConstraint === demandReason) {
    bindingConstraint = PacingReason.NO_AVAILABLE_CAPACITY;
  }
  if (!reasons.includes(bindingConstraint)) reasons.push(bindingConstraint);

  return {
    originateCount,
    mode,
    reasons,
    bindingConstraint,
    pLive,
    pLiveMean,
    predictedCapacity,
    predictedLiveAnswers: inflightLive + originateCount * pLive,
    confidence,
    pauseCampaign: false,
    abandonWarning: abandonMeasurable(inputs) && inputs.abandonRate >= inputs.abandonWarn,
    horizonMs,
  };
}

/** Baseline inputs for tests and the simulator. Not used on runtime paths. */
export function baselinePacingInputs(overrides: Partial<PacingInputs> = {}): PacingInputs {
  return {
    nowMs: 0,
    tickSeconds: 1,
    configuredMode: DialingMode.PREDICTIVE,
    agentsEligible: 10,
    agentsAvailable: 5,
    agentsReserved: 0,
    agentsOnCall: 5,
    agentsWrapUp: 0,
    callsDialing: 0,
    callsLiveWaiting: 0,
    callsBridged: 0,
    liveAnswers: 100,
    attempts: 500,
    meanAnswerLatencyMs: 6_000,
    p95AnswerLatencyMs: 12_000,
    meanHandleTimeMs: 180_000,
    meanWrapUpMs: 20_000,
    abandonRate: 0,
    abandonSampleSize: 500,
    assignmentLatencyMsP95: 500,
    maxLinesPerAgent: 4,
    powerLinesPerAvailableAgent: 2,
    campaignConcurrencyRemaining: 1_000,
    tenantConcurrencyRemaining: 1_000,
    gatewayCapacityRemaining: 1_000,
    maxCps: 1_000,
    callableLeads: 100_000,
    targetOccupancy: 0.9,
    abandonTarget: 0.03,
    abandonWarn: 0.02,
    minSampleSize: 50,
    minAbandonSample: 50,
    assignmentDeadlineMs: 2_000,
    eventLagMs: 0,
    maxEventLagMs: 1_000,
    agentStateAgeMs: 0,
    maxAgentStateAgeMs: 10_000,
    redisHealthy: true,
    eslHealthy: true,
    emergencyStop: false,
    ...overrides,
  };
}
