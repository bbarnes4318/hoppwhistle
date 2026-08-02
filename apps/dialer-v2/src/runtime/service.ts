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

import { AssignmentResolver } from '../agents/assignments.js';
import { AgentStateService, type ReconciliationCorrection } from '../agents/service.js';
import { AgentSessionRegistry, SessionRejection, type AgentSession } from '../agents/sessions.js';
import { SipRegistrationRegistry } from '../agents/sip-registry.js';
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
import type { DistributedLock } from '../stores/coordination.js';

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
  sessions: AgentSessionRegistry;
  assignments: AssignmentResolver;
  sipRegistry: SipRegistrationRegistry;
  lock: DistributedLock;
  /** Real Redis health. There is no hardcoded value anywhere. */
  redisHealthy: () => boolean;
  onAudit?: (record: HeartbeatAudit) => void;
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
  redisHealthy: boolean;
  lockDistributed: boolean;
  shadowPassesSkippedForLock: number;
  reconcilePassesSkippedForLock: number;
  sip: { tracked: number; registered: number; processed: number; unattributed: number };
}

/** Every heartbeat outcome is auditable, accepted or not. */
export interface HeartbeatAudit {
  atMs: number;
  tenantId: string;
  agentId: string;
  accepted: boolean;
  rejection?: SessionRejection | 'INVALID_TENANT' | 'UNKNOWN_AGENT';
  sequence: number;
  sessionIdPrefix: string;
  browserClaimedSip: boolean;
  freeswitchSip: boolean;
  countedAsCapacity: boolean;
}

export class DialerV2Runtime {
  private ingestor: EventIngestor;
  private readonly collector: ObservationCollector;
  private shadow: ShadowEngine;
  private eslClient: EslClient | null = null;
  private eslRefusal: EslStartRefusal | null = null;

  private shadowTimer: unknown = null;
  private reconcileTimer: unknown = null;
  private reapTimer: unknown = null;

  private lastReconciliationAtMs: number | null = null;
  private lastShadowRunAtMs: number | null = null;
  private shadowDecisionsThisRun = 0;
  private shadowPassesSkippedForLock = 0;
  private reconcilePassesSkippedForLock = 0;

  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly log: (record: Record<string, unknown>) => void;

  constructor(private deps: RuntimeDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setInterval(fn, ms));
    this.clearTimer = deps.clearTimer ?? (h => clearInterval(h as NodeJS.Timeout));
    this.log = deps.log ?? (() => {});

    this.collector = new ObservationCollector({
      now: this.now,
      assignmentDeadlineMs: deps.config.defaultPolicy.assignmentDeadlineMs,
    });

    this.ingestor = this.buildIngestor();
    this.shadow = new ShadowEngine(deps.shadowStore);
  }

  /**
   * Swap in real stores once Redis has connected.
   *
   * Called before `start()`. The ingestor is rebuilt so it uses the shared
   * dedupe store — without that, the in-memory dedupe created at construction
   * would remain in use and cross-instance idempotency would silently not apply.
   */
  replaceStores(next: {
    eventStore: EventStore;
    dedupe: DedupeStore;
    shadowStore: ShadowDecisionStore;
    lock: DistributedLock;
    redisHealthy: () => boolean;
  }): void {
    this.deps = {
      ...this.deps,
      eventStore: next.eventStore,
      dedupe: next.dedupe,
      shadowStore: next.shadowStore,
      lock: next.lock,
      redisHealthy: next.redisHealthy,
    };
    this.ingestor = this.buildIngestor();
    this.shadow = new ShadowEngine(next.shadowStore);
  }

  getIngestor(): EventIngestor {
    return this.ingestor;
  }
  getCollector(): ObservationCollector {
    return this.collector;
  }

  private buildIngestor(): EventIngestor {
    return new EventIngestor({
      store: this.deps.eventStore,
      dedupe: this.deps.dedupe,
      now: this.now,
      onEvent: event => {
        // Observation only. Nothing downstream of this callback can dial.
        this.collector.apply(event);
        if (event.agentId) {
          this.deps.agents.noteFreeswitchEvent(event.tenantId, event.agentId, this.now());
        }
      },
      onError: (error, context) =>
        this.log({ msg: 'ingestor error', context, error: error.message }),
    });
  }

  start(): void {
    this.startEsl();

    this.shadowTimer = this.setTimer(() => {
      void this.runShadowPass();
    }, this.deps.config.shadowIntervalMs);

    this.reconcileTimer = this.setTimer(() => {
      void this.runReconciliation();
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
        // sofia::register/unregister/expire carry SIP registration state, not
        // call state. They go to the registry, not the call ingestor.
        if (this.deps.sipRegistry.applyRegistrationEvent(raw)) return;
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

  /**
   * Reconcile agent state against live channel ownership and authoritative SIP
   * registration. Coordinated: only one replica runs a pass per interval.
   */
  async runReconciliation(): Promise<ReconciliationCorrection[]> {
    const lockName = 'reconcile';
    const acquired = await this.deps.lock.acquire(
      lockName,
      Math.max(1_000, this.deps.config.reconcileIntervalMs - 100)
    );
    if (!acquired) {
      this.reconcilePassesSkippedForLock++;
      return [];
    }

    try {
      return this.reconcileNow();
    } finally {
      await this.deps.lock.release(lockName);
    }
  }

  /**
   * The reconciliation body, without locking. Exposed for tests and for the
   * single-instance path.
   */
  reconcileNow(): ReconciliationCorrection[] {
    const nowMs = this.now();

    // Push authoritative SIP state into the agent service BEFORE reconciling,
    // so the reconciler compares against FreeSWITCH rather than a browser claim.
    for (const record of this.deps.agents.allAgents()) {
      const registered = this.deps.sipRegistry.isRegistered(record.tenantId, record.extension);
      if (record.sipRegistered !== registered) {
        this.deps.agents.setSipRegistration(record.tenantId, record.agentId, registered, nowMs);
      }
    }

    const corrections = this.deps.agents.reconcile(nowMs, {
      liveChannelUuids: this.collector.liveChannelUuids(),
      channelOwners: this.collector.channelOwners(),
    });
    this.lastReconciliationAtMs = nowMs;
    if (corrections.length > 0) {
      this.log({ msg: 'agent corrections', count: corrections.length });
    }
    this.deps.sessions.sweep(nowMs);
    this.deps.sipRegistry.sweep();
    return corrections;
  }

  /**
   * One shadow pass over every observed campaign. Records a decision per
   * campaign; originates nothing.
   */
  async runShadowPass(): Promise<number> {
    const lockName = 'shadow';
    const acquired = await this.deps.lock.acquire(
      lockName,
      Math.max(500, this.deps.config.shadowIntervalMs - 50)
    );
    if (!acquired) {
      this.shadowPassesSkippedForLock++;
      return 0;
    }
    try {
      return await this.shadowPassNow();
    } finally {
      await this.deps.lock.release(lockName);
    }
  }

  /** The shadow body, without locking. Exposed for tests. */
  async shadowPassNow(): Promise<number> {
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
        redisHealthy: this.deps.redisHealthy(),
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
      redisHealthy: this.deps.redisHealthy(),
      lockDistributed: this.deps.lock.distributed,
      shadowPassesSkippedForLock: this.shadowPassesSkippedForLock,
      reconcilePassesSkippedForLock: this.reconcilePassesSkippedForLock,
      sip: this.deps.sipRegistry.metrics(),
    };
  }

  /** Mint a server-issued session. Identity must already be verified. */
  issueSession(tenantId: string, agentId: string, userId: string): AgentSession | null {
    return this.deps.sessions.issue(tenantId, agentId, userId, this.now());
  }

  /**
   * Record an agent heartbeat.
   *
   * What the browser may influence: the session token it was issued, a
   * monotonic sequence, a UI state, and a *preference* among campaigns it is
   * already assigned to.
   *
   * What the browser may NOT influence, and which is now derived server-side:
   *  - tenant and agent identity (from the verified JWT, upstream)
   *  - session validity, expiry, and replay window (server-issued)
   *  - SIP registration (from FreeSWITCH sofia events)
   *  - current call id and channel UUID (from observed telephony events)
   *  - campaign and queue membership (from the assignment source)
   */
  async recordHeartbeat(input: {
    tenantId: string;
    agentId: string;
    userId: string;
    sessionId: string;
    sequence: number;
    uiState: string | null;
    preferredCampaignIds?: string[];
    /** Reported for comparison only; never used as truth. */
    browserClaimsSipRegistered?: boolean;
  }): Promise<{
    accepted: boolean;
    reason?: string;
    state?: string;
    countedAsCapacity: boolean;
    sipRegistered: boolean;
    campaignIds: string[];
  }> {
    const nowMs = this.now();
    const agents = this.deps.agents;

    const audit = (
      accepted: boolean,
      rejection: HeartbeatAudit['rejection'] | undefined,
      countedAsCapacity: boolean,
      freeswitchSip: boolean
    ): void => {
      this.deps.onAudit?.({
        atMs: nowMs,
        tenantId: input.tenantId,
        agentId: input.agentId,
        accepted,
        rejection,
        sequence: input.sequence,
        // Never log a whole bearer token.
        sessionIdPrefix: (input.sessionId ?? '').slice(0, 6),
        browserClaimedSip: input.browserClaimsSipRegistered === true,
        freeswitchSip,
        countedAsCapacity,
      });
    };

    const validation = this.deps.sessions.validate(
      input.sessionId,
      input.tenantId,
      input.agentId,
      input.sequence,
      nowMs
    );

    if (!validation.ok || !validation.session) {
      audit(false, validation.rejection, false, false);
      return {
        accepted: false,
        reason: validation.rejection ?? SessionRejection.UNKNOWN_SESSION,
        countedAsCapacity: false,
        sipRegistered: false,
        campaignIds: [],
      };
    }

    const session = validation.session;

    const record =
      agents.get(input.tenantId, input.agentId) ??
      agents.upsertAgent(input.tenantId, input.agentId, input.userId, nowMs, {
        state: AgentState.AUTHENTICATING,
      });
    if (!record) {
      audit(false, 'INVALID_TENANT', false, false);
      return {
        accepted: false,
        reason: 'INVALID_TENANT',
        countedAsCapacity: false,
        sipRegistered: false,
        campaignIds: [],
      };
    }

    // Liveness is recorded against the SERVER-issued session id.
    agents.heartbeat(input.tenantId, input.agentId, session.sessionId, nowMs);

    // SIP registration: FreeSWITCH is the authority. The browser's claim is
    // recorded in the audit trail so a disagreement is visible.
    const sipRegistered = this.deps.sipRegistry.isRegistered(input.tenantId, record.extension);
    agents.setSipRegistration(input.tenantId, input.agentId, sipRegistered, nowMs);

    // Campaign and queue membership: resolved server-side, narrowed only.
    const assignment = await this.deps.assignments.resolve(
      input.tenantId,
      input.agentId,
      input.preferredCampaignIds
    );
    record.campaignIds = assignment.campaignIds;
    record.queueIds = assignment.queueIds;
    record.lastSequence = input.sequence;

    // Call id and channel UUID come from observed telephony, never the browser.
    const ownedChannel = this.channelOwnedBy(input.tenantId, input.agentId);
    record.currentChannelUuid = ownedChannel;
    if (ownedChannel === null) record.currentCallId = null;

    // An older session may still beat, but must not be counted as capacity —
    // two tabs both claiming AVAILABLE would double-count the agent.
    const newest = this.deps.sessions.isNewestForAgent(session);

    if (input.uiState === 'AVAILABLE' && newest) {
      agents.transition(input.tenantId, input.agentId, AgentState.AVAILABLE, nowMs);
    } else if (input.uiState === 'PAUSED') {
      agents.transition(input.tenantId, input.agentId, AgentState.PAUSED, nowMs);
    }

    const after = agents.get(input.tenantId, input.agentId);
    const countedAsCapacity = after?.state === AgentState.AVAILABLE && sipRegistered && newest;

    audit(true, undefined, countedAsCapacity, sipRegistered);

    return {
      accepted: true,
      state: after?.state,
      countedAsCapacity,
      sipRegistered,
      campaignIds: assignment.campaignIds,
    };
  }

  /** Channel currently owned by this agent, from observed events only. */
  private channelOwnedBy(tenantId: string, agentId: string): string | null {
    const live = this.collector.liveChannelUuids();
    for (const [uuid, owner] of this.collector.channelOwners()) {
      if (owner === agentId && live.has(uuid)) return uuid;
    }
    void tenantId;
    return null;
  }
}
