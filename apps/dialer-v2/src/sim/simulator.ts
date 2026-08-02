/**
 * Dialer V2 — deterministic pacing simulator.
 *
 * The mandate (§20) is explicit that predictive dialing must not be tested
 * primarily with real telephone calls. This is the harness that makes that
 * possible: a discrete-time model of agents, carriers, and contacts that drives
 * the real `decidePacing` controller and measures what actually happens.
 *
 * Everything is seeded. The same seed and config produce byte-identical results,
 * so a failing assertion is always reproducible and a regression is always
 * bisectable.
 */

import {
  DialingMode,
  type PacingDecision,
  type PacingInputs,
  type PacingState,
  decidePacing,
} from '../pacing/controller.js';

const TICK_MS = 1_000;

/** mulberry32 — small, fast, seeded. Deterministic across platforms. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleExponential(rng: () => number, meanMs: number): number {
  const u = Math.max(1e-9, 1 - rng());
  return -meanMs * Math.log(u);
}

type CallState = 'DIALING' | 'LIVE_WAITING' | 'BRIDGED' | 'DONE';
type CallOutcome = 'LIVE' | 'MACHINE' | 'NO_ANSWER' | 'BUSY' | 'FAILED';

interface SimCall {
  id: number;
  state: CallState;
  outcome: CallOutcome;
  createdMs: number;
  answerAtMs: number;
  answeredMs: number;
  endsAtMs: number;
  agentIndex: number;
}

type AgentState = 'AVAILABLE' | 'ON_CALL' | 'WRAP_UP' | 'OFFLINE';

interface SimAgent {
  state: AgentState;
  freeAtMs: number;
  busyMs: number;
  idleMs: number;
}

export interface SimulatorConfig {
  seed: number;
  ticks: number;
  agents: number;

  /** Ground-truth probability a call reaches a live human. */
  liveAnswerRate: number;
  /** Ground-truth probability a call reaches an answering machine. */
  machineRate: number;

  answerLatencyMeanMs: number;
  ringTimeoutMs: number;
  handleTimeMeanMs: number;
  wrapUpMeanMs: number;

  configuredMode: DialingMode;
  targetOccupancy: number;
  abandonTarget: number;
  abandonWarn: number;
  maxLinesPerAgent: number;
  powerLinesPerAvailableAgent: number;
  assignmentDeadlineMs: number;
  minSampleSize: number;
  minAbandonSample: number;
  maxCps: number;
  callableLeads: number;

  /** Rolling statistics window for answer-rate estimation, in ticks. */
  windowTicks: number;
  /**
   * Rolling window for abandonment, in ticks. Deliberately much shorter than
   * `windowTicks`: compliance measures abandonment over a long period, but the
   * controller has to react to it long before that average moves.
   */
  abandonWindowTicks: number;

  // ---- Fault injection -------------------------------------------------
  /** Remove this many agents at the given tick (browser crash, mass logout). */
  agentDrop?: { atTick: number; count: number };
  /** Ground-truth answer rate changes at this tick (list quality shift). */
  answerRateShift?: { atTick: number; to: number };
  /** Redis reported unhealthy across this inclusive tick range. */
  redisOutage?: { from: number; to: number };
  /** Telephony event lag injected across this inclusive tick range. */
  eventLagSpike?: { from: number; to: number; lagMs: number };
  /** Emergency stop engaged from this tick onward. */
  emergencyStopAt?: number;
  /** Carrier capacity collapses across this inclusive tick range. */
  carrierOutage?: { from: number; to: number };
}

export interface SimTickRecord {
  tick: number;
  decision: PacingDecision;
  originated: number;
  agentsAvailable: number;
  agentsOnCall: number;
  callsDialing: number;
  callsLiveWaiting: number;
  abandonedThisTick: number;
}

export interface SimulatorResult {
  config: SimulatorConfig;
  ticks: SimTickRecord[];
  totalAttempts: number;
  totalLiveAnswers: number;
  totalBridged: number;
  totalAbandoned: number;
  /** Abandoned ÷ live-answered — the compliance definition. */
  abandonRate: number;
  /** Fraction of agent-seconds spent on calls or wrapping up. */
  occupancy: number;
  maxConcurrentCalls: number;
  /** Largest tick-to-tick increase in originate count. */
  maxOriginateJump: number;
  modesUsed: DialingMode[];
}

export function defaultSimulatorConfig(overrides: Partial<SimulatorConfig> = {}): SimulatorConfig {
  return {
    seed: 1,
    ticks: 900,
    agents: 12,
    liveAnswerRate: 0.18,
    machineRate: 0.22,
    answerLatencyMeanMs: 7_000,
    ringTimeoutMs: 15_000,
    handleTimeMeanMs: 150_000,
    wrapUpMeanMs: 15_000,
    configuredMode: DialingMode.PREDICTIVE,
    targetOccupancy: 0.9,
    abandonTarget: 0.03,
    abandonWarn: 0.02,
    maxLinesPerAgent: 4,
    powerLinesPerAvailableAgent: 2,
    assignmentDeadlineMs: 2_000,
    minSampleSize: 50,
    minAbandonSample: 50,
    maxCps: 30,
    callableLeads: 1_000_000,
    windowTicks: 600,
    abandonWindowTicks: 600,
    ...overrides,
  };
}

/**
 * Run the simulation. Pure with respect to the seed — no clock, no
 * `Math.random`, no I/O.
 */
export function runSimulation(config: SimulatorConfig): SimulatorResult {
  const rng = createRng(config.seed);

  const agents: SimAgent[] = Array.from({ length: config.agents }, () => ({
    state: 'AVAILABLE' as AgentState,
    freeAtMs: 0,
    busyMs: 0,
    idleMs: 0,
  }));

  const calls: SimCall[] = [];
  const records: SimTickRecord[] = [];

  // Rolling windows, indexed by tick.
  const attemptsPerTick: number[] = [];
  const liveAnswersPerTick: number[] = [];
  const abandonsPerTick: number[] = [];

  const handleSamples: number[] = [];
  const wrapSamples: number[] = [];
  const answerLatencySamples: number[] = [];
  const assignmentLatencySamples: number[] = [];

  let nextCallId = 1;
  let totalAttempts = 0;
  let totalLiveAnswers = 0;
  let totalBridged = 0;
  let totalAbandoned = 0;
  let maxConcurrentCalls = 0;
  let liveAnswerRate = config.liveAnswerRate;
  let activeAgents = config.agents;

  let prevState: PacingState = { originateCount: 0 };
  let maxOriginateJump = 0;
  let prevOriginated = 0;
  const modesUsed = new Set<DialingMode>();

  const windowSum = (arr: number[], tick: number, span = config.windowTicks): number => {
    const start = Math.max(0, tick - span);
    let sum = 0;
    for (let i = start; i < arr.length; i++) sum += arr[i];
    return sum;
  };

  const mean = (arr: number[], fallback: number): number => {
    if (arr.length === 0) return fallback;
    // Bound the sample buffer so long runs stay O(1) per tick.
    const slice = arr.length > 500 ? arr.slice(-500) : arr;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  };

  const percentile = (arr: number[], p: number, fallback: number): number => {
    if (arr.length === 0) return fallback;
    const slice = (arr.length > 500 ? arr.slice(-500) : arr).slice().sort((a, b) => a - b);
    const idx = Math.min(slice.length - 1, Math.max(0, Math.floor(slice.length * p)));
    return slice[idx];
  };

  for (let tick = 0; tick < config.ticks; tick++) {
    const nowMs = tick * TICK_MS;
    attemptsPerTick[tick] = 0;
    liveAnswersPerTick[tick] = 0;
    abandonsPerTick[tick] = 0;

    // ---- Fault injection -------------------------------------------------
    if (config.answerRateShift && tick === config.answerRateShift.atTick) {
      liveAnswerRate = config.answerRateShift.to;
    }
    if (config.agentDrop && tick === config.agentDrop.atTick) {
      let toDrop = config.agentDrop.count;
      for (const agent of agents) {
        if (toDrop <= 0) break;
        if (agent.state !== 'OFFLINE') {
          agent.state = 'OFFLINE';
          toDrop--;
          activeAgents--;
        }
      }
      // Calls bridged to a dropped agent are torn down.
      for (const call of calls) {
        if (call.state === 'BRIDGED' && agents[call.agentIndex]?.state === 'OFFLINE') {
          call.state = 'DONE';
        }
      }
    }
    const redisHealthy = !(
      config.redisOutage &&
      tick >= config.redisOutage.from &&
      tick <= config.redisOutage.to
    );
    const eventLagMs =
      config.eventLagSpike && tick >= config.eventLagSpike.from && tick <= config.eventLagSpike.to
        ? config.eventLagSpike.lagMs
        : 0;
    const emergencyStop = config.emergencyStopAt !== undefined && tick >= config.emergencyStopAt;
    const carrierDown =
      config.carrierOutage && tick >= config.carrierOutage.from && tick <= config.carrierOutage.to;

    // ---- Advance agents --------------------------------------------------
    for (const agent of agents) {
      if (agent.state === 'OFFLINE') continue;
      if (agent.state === 'ON_CALL' && nowMs >= agent.freeAtMs) {
        const wrap = sampleExponential(rng, config.wrapUpMeanMs);
        wrapSamples.push(wrap);
        agent.state = 'WRAP_UP';
        agent.freeAtMs = nowMs + wrap;
      } else if (agent.state === 'WRAP_UP' && nowMs >= agent.freeAtMs) {
        agent.state = 'AVAILABLE';
      }
      if (agent.state === 'AVAILABLE') agent.idleMs += TICK_MS;
      else agent.busyMs += TICK_MS;
    }

    // ---- Advance calls ---------------------------------------------------
    for (const call of calls) {
      if (call.state === 'DIALING') {
        if (call.outcome === 'LIVE' || call.outcome === 'MACHINE') {
          if (nowMs >= call.answerAtMs) {
            if (call.outcome === 'MACHINE') {
              // Campaign policy in this model: hang up on machines.
              call.state = 'DONE';
            } else {
              call.state = 'LIVE_WAITING';
              call.answeredMs = nowMs;
              answerLatencySamples.push(nowMs - call.createdMs);
              liveAnswersPerTick[tick]++;
              totalLiveAnswers++;
            }
          }
        } else if (nowMs - call.createdMs >= config.ringTimeoutMs) {
          call.state = 'DONE';
        }
      } else if (call.state === 'BRIDGED' && nowMs >= call.endsAtMs) {
        call.state = 'DONE';
      }
    }

    // ---- Assign live answers to agents ----------------------------------
    for (const call of calls) {
      if (call.state !== 'LIVE_WAITING') continue;
      const agentIndex = agents.findIndex(a => a.state === 'AVAILABLE');
      if (agentIndex >= 0) {
        const handle = sampleExponential(rng, config.handleTimeMeanMs);
        handleSamples.push(handle);
        assignmentLatencySamples.push(nowMs - call.answeredMs);
        agents[agentIndex].state = 'ON_CALL';
        agents[agentIndex].freeAtMs = nowMs + handle;
        call.state = 'BRIDGED';
        call.agentIndex = agentIndex;
        call.endsAtMs = nowMs + handle;
        totalBridged++;
      } else if (nowMs - call.answeredMs >= config.assignmentDeadlineMs) {
        // Nobody could take it inside the deadline: this is an abandoned call.
        call.state = 'DONE';
        abandonsPerTick[tick]++;
        totalAbandoned++;
      }
    }

    // ---- Observe state ---------------------------------------------------
    const callsDialing = calls.filter(c => c.state === 'DIALING').length;
    const callsLiveWaiting = calls.filter(c => c.state === 'LIVE_WAITING').length;
    const callsBridged = calls.filter(c => c.state === 'BRIDGED').length;
    maxConcurrentCalls = Math.max(
      maxConcurrentCalls,
      callsDialing + callsLiveWaiting + callsBridged
    );

    const agentsAvailable = agents.filter(a => a.state === 'AVAILABLE').length;
    const agentsOnCall = agents.filter(a => a.state === 'ON_CALL').length;
    const agentsWrapUp = agents.filter(a => a.state === 'WRAP_UP').length;

    const windowAttempts = windowSum(attemptsPerTick, tick);
    const windowLive = windowSum(liveAnswersPerTick, tick);
    const abandonWindowLive = windowSum(liveAnswersPerTick, tick, config.abandonWindowTicks);
    const abandonWindowAbandons = windowSum(abandonsPerTick, tick, config.abandonWindowTicks);
    const observedAbandonRate =
      abandonWindowLive > 0 ? abandonWindowAbandons / abandonWindowLive : 0;

    const inputs: PacingInputs = {
      nowMs,
      tickSeconds: 1,
      configuredMode: config.configuredMode,
      agentsEligible: activeAgents,
      agentsAvailable,
      agentsReserved: 0,
      agentsOnCall,
      agentsWrapUp,
      callsDialing,
      callsLiveWaiting,
      callsBridged,
      liveAnswers: windowLive,
      attempts: windowAttempts,
      meanAnswerLatencyMs: mean(answerLatencySamples, config.answerLatencyMeanMs),
      p95AnswerLatencyMs: percentile(answerLatencySamples, 0.95, config.answerLatencyMeanMs * 2),
      meanHandleTimeMs: mean(handleSamples, config.handleTimeMeanMs),
      meanWrapUpMs: mean(wrapSamples, config.wrapUpMeanMs),
      abandonRate: observedAbandonRate,
      abandonSampleSize: abandonWindowLive,
      assignmentLatencyMsP95: percentile(assignmentLatencySamples, 0.95, 0),
      maxLinesPerAgent: config.maxLinesPerAgent,
      powerLinesPerAvailableAgent: config.powerLinesPerAvailableAgent,
      campaignConcurrencyRemaining: 10_000,
      tenantConcurrencyRemaining: 10_000,
      gatewayCapacityRemaining: carrierDown ? 0 : 10_000,
      maxCps: config.maxCps,
      callableLeads: Math.max(0, config.callableLeads - totalAttempts),
      targetOccupancy: config.targetOccupancy,
      abandonTarget: config.abandonTarget,
      abandonWarn: config.abandonWarn,
      minSampleSize: config.minSampleSize,
      minAbandonSample: config.minAbandonSample,
      assignmentDeadlineMs: config.assignmentDeadlineMs,
      eventLagMs,
      maxEventLagMs: 1_000,
      agentStateAgeMs: 0,
      maxAgentStateAgeMs: 10_000,
      redisHealthy,
      eslHealthy: true,
      emergencyStop,
    };

    // ---- Decide and act --------------------------------------------------
    const decision = decidePacing(inputs, prevState);
    modesUsed.add(decision.mode);

    for (let i = 0; i < decision.originateCount; i++) {
      const roll = rng();
      let outcome: CallOutcome;
      if (roll < liveAnswerRate) outcome = 'LIVE';
      else if (roll < liveAnswerRate + config.machineRate) outcome = 'MACHINE';
      else if (roll < liveAnswerRate + config.machineRate + 0.1) outcome = 'BUSY';
      else outcome = 'NO_ANSWER';

      const latency = Math.min(
        config.ringTimeoutMs,
        sampleExponential(rng, config.answerLatencyMeanMs)
      );

      calls.push({
        id: nextCallId++,
        state: 'DIALING',
        outcome,
        createdMs: nowMs,
        answerAtMs: nowMs + latency,
        answeredMs: 0,
        endsAtMs: 0,
        agentIndex: -1,
      });
      attemptsPerTick[tick]++;
      totalAttempts++;
    }

    maxOriginateJump = Math.max(maxOriginateJump, decision.originateCount - prevOriginated);
    prevOriginated = decision.originateCount;
    prevState = { originateCount: decision.originateCount };

    records.push({
      tick,
      decision,
      originated: decision.originateCount,
      agentsAvailable,
      agentsOnCall,
      callsDialing,
      callsLiveWaiting,
      abandonedThisTick: abandonsPerTick[tick],
    });

    // Reap finished calls so the array does not grow without bound.
    if (calls.length > 5_000) {
      for (let i = calls.length - 1; i >= 0; i--) {
        if (calls[i].state === 'DONE') calls.splice(i, 1);
      }
    }
  }

  const totalAgentMs = agents.reduce((sum, a) => sum + a.busyMs + a.idleMs, 0);
  const busyAgentMs = agents.reduce((sum, a) => sum + a.busyMs, 0);

  return {
    config,
    ticks: records,
    totalAttempts,
    totalLiveAnswers,
    totalBridged,
    totalAbandoned,
    abandonRate: totalLiveAnswers > 0 ? totalAbandoned / totalLiveAnswers : 0,
    occupancy: totalAgentMs > 0 ? busyAgentMs / totalAgentMs : 0,
    maxConcurrentCalls,
    maxOriginateJump,
    modesUsed: [...modesUsed],
  };
}
