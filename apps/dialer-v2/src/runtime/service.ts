/**
 * Dialer V2 — runtime orchestration.
 *
 * Wires ESL → ingestor → observation collector → shadow pacing, plus the agent
 * reconciliation loop.
 *
 * NO ORIGINATION PATH. This module imports the ESL client, whose only writes are
 * `auth` and `event plain` (guarded in `socket-transport.ts`). Nothing here
 * bridges, transfers, hangs up, or originates, and nothing writes a lead status,
 * a campaign status, a disposition, or a billing record.
 *
 * Every loop is defaulted off. Enabling ingestion does not enable origination —
 * origination does not exist to enable.
 */

import { AgentStateService, type ReconciliationCorrection } from '../agents/service.js';
import { AgentState } from '../agents/state.js';
import type { DialerV2Flags, FlagSource } from '../config/flags.js';
import { EslClient, type EslStatus } from '../esl/client.js';
import { SocketEslTransport } from '../esl/socket-transport.js';
import { EventIngestor } from '../events/ingestor.js';
import type { DedupeStore, EventStore } from '../events/store.js';
import { ObservationCollector } from '../observation/collector.js';
import { DialingMode } from '../pacing/controller.js';
import {
  ShadowEngine,
  type CampaignPolicy,
  type ShadowDecisionStore,
  type ShadowObservation,
} from '../shadow/engine.js';

export interface EslIngestConfig {
  enabled: boolean;
  host: string;
  port: number;
  password: string;
  /** Hosts this service may connect to. Empty ⇒ nothing is allowed. */
  allowedHosts: readonly string[];
}

export interface RuntimeConfig {
  esl: EslIngestConfig;
  shadowIntervalMs: number;
  reconcileIntervalMs: number;
  reapIntervalMs: number;
  maxEventAgeMs: number;
  maxEventLagMs: number;
  maxAgentStateAgeMs: number;
  defaultPolicy: Omit<CampaignPolicy, 'tenantId' | 'campaignId'>;
}

export function readEslConfig(env: NodeJS.ProcessEnv = process.env): EslIngestConfig {
  const raw = env.TENANT_DIALER_V2_ESL_INGEST_ENABLED;
  const enabled = raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
  return {
    enabled,
    host: env.FREESWITCH_ESL_HOST || env.FREESWITCH_HOST || 'freeswitch',
    port: Number.parseInt(env.FREESWITCH_ESL_PORT || '8021', 10) || 8021,
    password: env.FREESWITCH_ESL_PASSWORD || '',
    allowedHosts: (env.TENANT_DIALER_V2_ESL_ALLOWED_HOSTS || '')
      .split(',')
      .map(h => h.trim())
      .filter(h => h.length > 0),
  };
}

export function defaultRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const int = (name: string, fallback: number): number => {
    const n = Number.parseInt(env[name] ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  return {
    esl: readEslConfig(env),
    shadowIntervalMs: int('DIALER_V2_SHADOW_INTERVAL_MS', 1_000),
    reconcileIntervalMs: int('DIALER_V2_RECONCILE_INTERVAL_MS', 5_000),
    reapIntervalMs: int('DIALER_V2_REAP_INTERVAL_MS', 60_000),
    maxEventAgeMs: int('DIALER_V2_MAX_EVENT_AGE_MS', 60_000),
    maxEventLagMs: int('DIALER_V2_MAX_EVENT_LAG_MS', 1_000),
    maxAgentStateAgeMs: int('DIALER_V2_MAX_AGENT_STATE_AGE_MS', 30_000),
    defaultPolicy: {
      configuredMode: DialingMode.PREDICTIVE,
      targetOccupancy: 0.9,
      abandonTarget: 0.03,
      abandonWarn: 0.02,
      maxLinesPerAgent: 4,
      powerLinesPerAvailableAgent: 2,
      maxCps: int('DIALER_V2_DEFAULT_MAX_CPS', 10),
      campaignConcurrencyRemaining: int('DIALER_V2_DEFAULT_CAMPAIGN_CONCURRENCY', 100),
      tenantConcurrencyRemaining: int('DIALER_V2_DEFAULT_TENANT_CONCURRENCY', 200),
      gatewayCapacityRemaining: int('DIALER_V2_DEFAULT_GATEWAY_CAPACITY', 200),
      callableLeads: int('DIALER_V2_DEFAULT_CALLABLE_LEADS', 1_000),
      minSampleSize: 50,
      minAbandonSample: 50,
      assignmentDeadlineMs: 2_000,
    },
  };
}

export enum EslStartRefusal {
  DISABLED = 'ESL ingestion is disabled (TENANT_DIALER_V2_ESL_INGEST_ENABLED)',
  HOST_NOT_ALLOWLISTED = 'ESL host is not in TENANT_DIALER_V2_ESL_ALLOWED_HOSTS',
  NO_PASSWORD = 'FREESWITCH_ESL_PASSWORD is not set',
}

/**
 * Decide whether ESL ingestion may start. Pure, so the allowlist behaviour is
 * testable without a socket.
 *
 * The host allowlist exists because a misconfigured `FREESWITCH_ESL_HOST` would
 * otherwise send an ESL password to whatever host DNS resolved to.
 */
export function canStartEsl(config: EslIngestConfig): { ok: boolean; refusal?: EslStartRefusal } {
  if (!config.enabled) return { ok: false, refusal: EslStartRefusal.DISABLED };
  if (config.password.length === 0) return { ok: false, refusal: EslStartRefusal.NO_PASSWORD };
  if (!config.allowedHosts.includes(config.host)) {
    return { ok: false, refusal: EslStartRefusal.HOST_NOT_ALLOWLISTED };
  }
  return { ok: true };
}

export interface RuntimeDeps {
  flags: FlagSource;
  eventStore: EventStore;
  dedupe: DedupeStore;
  shadowStore: ShadowDecisionStore;
  agents: AgentStateService;
  config: RuntimeConfig;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  log?: (record: Record<string, unknown>) => void;
}

export interface RuntimeStatus {
  eslStarted: boolean;
  eslRefusal: EslStartRefusal | null;
  esl: EslStatus | null;
  lastReconciliationAtMs: number | null;
  lastShadowRunAtMs: number | null;
  shadowDecisionsThisRun: number;
  observedScopes: number;
}

export class DialerV2Runtime {
  private readonly ingestor: EventIngestor;
  private readonly collector: ObservationCollector;
  private readonly shadow: ShadowEngine;
  private eslClient: EslClient | null = null;
  private eslRefusal: EslStartRefusal | null = null;

  private shadowTimer: unknown = null;
  private reconcileTimer: unknown = null;
  private reapTimer: unknown = null;

  private lastReconciliationAtMs: number | null = null;
  private lastShadowRunAtMs: number | null = null;
  private shadowDecisionsThisRun = 0;

  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly log: (record: Record<string, unknown>) => void;

  constructor(private readonly deps: RuntimeDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setInterval(fn, ms));
    this.clearTimer = deps.clearTimer ?? (h => clearInterval(h as NodeJS.Timeout));
    this.log = deps.log ?? (() => {});

    this.collector = new ObservationCollector({
      now: this.now,
      assignmentDeadlineMs: deps.config.defaultPolicy.assignmentDeadlineMs,
    });

    this.ingestor = new EventIngestor({
      store: deps.eventStore,
      dedupe: deps.dedupe,
      now: this.now,
      onEvent: event => {
        // Observation only. Nothing downstream of this callback can dial.
        this.collector.apply(event);
        if (event.agentId) {
          deps.agents.noteFreeswitchEvent(event.tenantId, event.agentId, this.now());
        }
      },
      onError: (error, context) =>
        this.log({ msg: 'ingestor error', context, error: error.message }),
    });

    this.shadow = new ShadowEngine(deps.shadowStore);
  }

  getIngestor(): EventIngestor {
    return this.ingestor;
  }
  getCollector(): ObservationCollector {
    return this.collector;
  }

  start(): void {
    this.startEsl();

    this.shadowTimer = this.setTimer(() => {
      void this.runShadowPass();
    }, this.deps.config.shadowIntervalMs);

    this.reconcileTimer = this.setTimer(() => {
      this.runReconciliation();
    }, this.deps.config.reconcileIntervalMs);

    this.reapTimer = this.setTimer(() => {
      this.collector.reap();
    }, this.deps.config.reapIntervalMs);
  }

  private startEsl(): void {
    const gate = canStartEsl(this.deps.config.esl);
    if (!gate.ok) {
      this.eslRefusal = gate.refusal ?? null;
      // Logged without the host, port, or password.
      this.log({ msg: 'ESL ingestion not started', reason: this.eslRefusal });
      return;
    }

    const { host, port, password } = this.deps.config.esl;
    this.eslClient = new EslClient({
      createTransport: () =>
        new SocketEslTransport({
          host,
          port,
          password,
          onCommand: redacted => this.log({ msg: 'esl command', command: redacted }),
        }),
      onRawEvent: raw => {
        void this.ingestor.handleRaw(raw);
      },
      now: this.now,
      onStateChange: (state, detail) => this.log({ msg: 'esl state', state, detail }),
    });

    void this.eslClient.start();
  }

  stop(): void {
    for (const timer of [this.shadowTimer, this.reconcileTimer, this.reapTimer]) {
      if (timer !== null) this.clearTimer(timer);
    }
    this.shadowTimer = null;
    this.reconcileTimer = null;
    this.reapTimer = null;
    this.eslClient?.stop();
    this.eslClient = null;
  }

  /** Reconcile agent state against live channel ownership from the collector. */
  runReconciliation(): ReconciliationCorrection[] {
    const nowMs = this.now();
    const corrections = this.deps.agents.reconcile(nowMs, {
      liveChannelUuids: this.collector.liveChannelUuids(),
      channelOwners: this.collector.channelOwners(),
    });
    this.lastReconciliationAtMs = nowMs;
    if (corrections.length > 0) {
      this.log({ msg: 'agent corrections', count: corrections.length });
    }
    return corrections;
  }

  /**
   * One shadow pass over every observed campaign. Records a decision per
   * campaign; originates nothing.
   */
  async runShadowPass(): Promise<number> {
    const flags: DialerV2Flags = this.deps.flags.get();
    const nowMs = this.now();
    const eslStatus = this.eslClient?.getStatus() ?? null;

    let count = 0;
    for (const scope of this.collector.activeScopes()) {
      const obs = this.buildObservation(scope.tenantId, scope.campaignId, nowMs, eslStatus);
      await this.shadow.evaluate(flags, obs);
      count++;
    }

    this.lastShadowRunAtMs = nowMs;
    this.shadowDecisionsThisRun = count;
    return count;
  }

  private buildObservation(
    tenantId: string,
    campaignId: string,
    nowMs: number,
    eslStatus: EslStatus | null
  ): ShadowObservation {
    const observed = this.collector.observe(tenantId, campaignId);
    const capacity = this.deps.agents.capacity(tenantId, nowMs, campaignId);

    // Agent-state age: if nothing has ever reported, treat it as infinitely
    // stale so the controller hard-stops rather than guessing.
    const agentStateAgeMs =
      capacity.freshestHeartbeatAgeMs === null
        ? Number.MAX_SAFE_INTEGER
        : capacity.freshestHeartbeatAgeMs;

    return {
      nowMs,
      policy: { tenantId, campaignId, ...this.deps.config.defaultPolicy },
      capacity,
      calls: {
        dialing: observed.callsCreated + observed.callsOriginating,
        ringing: observed.callsProgressing + observed.callsRinging,
        answered: observed.callsAnswered,
        bridged: observed.callsBridged,
        liveAnswersWaiting: observed.liveAnswersWaiting,
      },
      rates: {
        attempts: observed.attempts,
        liveAnswers: observed.liveAnswers,
        meanAnswerLatencyMs: observed.meanAnswerLatencyMs,
        p95AnswerLatencyMs: observed.p95AnswerLatencyMs,
        meanHandleTimeMs: observed.meanCallDurationMs || 150_000,
        meanWrapUpMs: 15_000,
        abandonRate: observed.abandonRate,
        abandonSampleSize: observed.abandonSampleSize,
        assignmentLatencyMsP95: observed.p95BridgeLatencyMs,
      },
      health: {
        // No ESL client at all ⇒ unhealthy. The controller then hard-stops,
        // which is the correct answer for a dialer that cannot see the switch.
        eslHealthy: eslStatus !== null && eslStatus.connected && !eslStatus.degraded,
        redisHealthy: true,
        eventLagMs: this.ingestor.currentLagMs(),
        maxEventLagMs: this.deps.config.maxEventLagMs,
        agentStateAgeMs,
        maxAgentStateAgeMs: this.deps.config.maxAgentStateAgeMs,
      },
    };
  }

  status(): RuntimeStatus {
    return {
      eslStarted: this.eslClient !== null,
      eslRefusal: this.eslRefusal,
      esl: this.eslClient?.getStatus() ?? null,
      lastReconciliationAtMs: this.lastReconciliationAtMs,
      lastShadowRunAtMs: this.lastShadowRunAtMs,
      shadowDecisionsThisRun: this.shadowDecisionsThisRun,
      observedScopes: this.collector.activeScopes().length,
    };
  }

  /**
   * Record an agent heartbeat. Browser claims are signals, not truth: the agent
   * only becomes capacity after `runReconciliation()` corroborates them against
   * SIP registration and live FreeSWITCH channels.
   */
  recordHeartbeat(input: {
    tenantId: string;
    agentId: string;
    userId: string;
    sessionId: string;
    sequence: number;
    uiState: string | null;
    sipRegistered: boolean;
    currentCallId: string | null;
    currentChannelUuid: string | null;
    campaignIds: string[];
    queueIds: string[];
  }): { accepted: boolean; reason?: string; state?: string; countedAsCapacity: boolean } {
    const nowMs = this.now();
    const agents = this.deps.agents;

    const existing = agents.get(input.tenantId, input.agentId);
    if (existing && input.sequence > 0 && input.sequence <= existing.lastSequence) {
      // Replay or out-of-order delivery. Rejecting is safe: the next in-order
      // heartbeat refreshes liveness, and accepting a stale one could resurrect
      // an agent the reconciler has already withdrawn.
      return { accepted: false, reason: 'STALE_SEQUENCE', countedAsCapacity: false };
    }

    const record =
      existing ??
      agents.upsertAgent(input.tenantId, input.agentId, input.userId, nowMs, {
        state: AgentState.AUTHENTICATING,
      });
    if (!record) return { accepted: false, reason: 'INVALID_TENANT', countedAsCapacity: false };

    const beat = agents.heartbeat(input.tenantId, input.agentId, input.sessionId, nowMs);
    if (!beat.accepted)
      return { accepted: false, reason: 'UNKNOWN_AGENT', countedAsCapacity: false };

    agents.setSipRegistration(input.tenantId, input.agentId, input.sipRegistered, nowMs);
    record.lastSequence = input.sequence;
    record.campaignIds = input.campaignIds;
    record.queueIds = input.queueIds;
    record.currentCallId = input.currentCallId;
    record.currentChannelUuid = input.currentChannelUuid;

    // The browser's claimed UI state is applied only where the state machine
    // permits it. It cannot force an agent into ON_CALL, and it cannot clear a
    // STALE marking the reconciler set — recovery goes through AUTHENTICATING.
    if (input.uiState === 'AVAILABLE' && !beat.duplicateSession) {
      agents.transition(input.tenantId, input.agentId, AgentState.AVAILABLE, nowMs);
    } else if (input.uiState === 'PAUSED') {
      agents.transition(input.tenantId, input.agentId, AgentState.PAUSED, nowMs);
    }

    const after = agents.get(input.tenantId, input.agentId);
    return {
      accepted: true,
      state: after?.state,
      countedAsCapacity: after?.state === AgentState.AVAILABLE && after.sipRegistered,
    };
  }
}
