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
import { ExtensionResolver } from '../agents/extension-resolver.js';
import { AgentStateService, type ReconciliationCorrection } from '../agents/service.js';
import { SessionRejection } from '../agents/sessions.js';
import { AgentState, type AgentRecord } from '../agents/state.js';
import type { DialerV2Flags, FlagSource } from '../config/flags.js';
import { EslClient, type EslStatus } from '../esl/client.js';
import { SocketEslTransport } from '../esl/socket-transport.js';
import { EventIngestor } from '../events/ingestor.js';
import type { DedupeStore, EventStore } from '../events/store.js';
import {
  TelephonyEventType,
  type NormalizedTelephonyEvent,
  type RawEslEvent,
} from '../events/types.js';
import { ObservationCollector } from '../observation/collector.js';
import { DialingMode } from '../pacing/controller.js';
import {
  ShadowEngine,
  type CampaignPolicy,
  type ShadowDecisionStore,
  type ShadowObservation,
} from '../shadow/engine.js';
import { AgentWriteOutcome } from '../stores/agent-state-store.js';
import { campaignShadowLock, globalLock, type DistributedLock } from '../stores/coordination.js';
import type { ObservationCounters } from '../stores/observation-store.js';
import {
  SIP_REGISTRATION_SUBCLASSES,
  SipLifecycle,
  SipWriteOutcome,
  readSipEventOrdering,
} from '../stores/sip-store.js';

import type {
  IssuedSessionResult,
  AgentSessionStore,
  AgentStateRepository,
  CampaignObservationRepository,
  ChannelOwnershipRepository,
  SipRegistrationRepository,
} from './ports.js';

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
  /**
   * The hot-path cache the synchronous pacing loop reads.
   *
   * Not the record. `agentStore` is the record; this is reconstructed from it at
   * startup and only ever updated after a write it accepted.
   */
  agents: AgentStateService;
  agentStore: AgentStateRepository;
  sessions: AgentSessionStore;
  assignments: AssignmentResolver;
  sip: SipRegistrationRepository;
  observations: CampaignObservationRepository;
  channels: ChannelOwnershipRepository;
  extensions: ExtensionResolver;
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
  shadowWritesRejected: number;
  /** Observed scopes whose ids could not form a valid Redis key. */
  shadowScopesUnkeyable: number;
  reconcilePassesSkippedForLock: number;
  sip: {
    resolved: number;
    quarantined: number;
    outOfOrder: number;
    forgedTenant: number;
  };
  registrationsResolved: number;
  registrationsQuarantined: number;
  registrationsForgedTenant: number;
  /** Registration writes refused because a newer event had already been applied. */
  registrationsOutOfOrder: number;
  agentStaleWrites: number;
  agentWritesUnavailable: number;
  /**
   * Whether shared state was fully reconstructed at startup.
   *
   * False means this replica is running on a partial view — some agents or
   * registrations could not be loaded — and its capacity numbers are therefore
   * a floor, not a measurement.
   */
  reconstructionComplete: boolean;
  lastRegistrationRejection: string | null;
}

/** Every heartbeat outcome is auditable, accepted or not. */
export interface HeartbeatAudit {
  atMs: number;
  tenantId: string;
  agentId: string;
  accepted: boolean;
  rejection?: SessionRejection | 'INVALID_TENANT' | 'UNKNOWN_AGENT';
  sequence: number;
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
  private shadowWritesRejected = 0;
  private shadowScopesUnkeyable = 0;
  private registrationsResolved = 0;
  private registrationsQuarantined = 0;
  private registrationsForgedTenant = 0;
  private registrationsOutOfOrder = 0;
  private agentStaleWrites = 0;
  private agentWritesUnavailable = 0;
  private reconstructionComplete = false;
  private lastRegistrationRejection: string | null = null;
  private readonly quarantinedRegistrations: Array<{
    extension: string | null;
    sipDomain: string | null;
    subclass: string;
    reason: string;
  }> = [];

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
        // Shared counters, bucketed by the event's OWN timestamp. Deduplication
        // has already happened in the ingestor, which is what makes these
        // HINCRBYs safe to apply once per event across every replica.
        void this.recordObservation(event);
      },
      onError: (error, context) =>
        this.log({ msg: 'ingestor error', context, error: error.message }),
    });
  }

  /**
   * Translate one telephony event into shared counter deltas.
   *
   * Only outcome-bearing events contribute. A CHANNEL_CREATE is one attempt; an
   * ANSWER is one live answer; a HANGUP resolves into exactly one of abandoned,
   * busy, no-answer, or failed. Counting the same call under two headings would
   * make the abandonment rate — the number that governs whether a campaign may
   * keep dialing — quietly wrong in the permissive direction.
   */
  private async recordObservation(event: NormalizedTelephonyEvent): Promise<void> {
    if (!event.tenantId || !event.campaignId) return;

    const deltas: Partial<ObservationCounters> = {};

    switch (event.eventType) {
      case TelephonyEventType.CHANNEL_CREATE:
        deltas.attempts = 1;
        break;
      case TelephonyEventType.CHANNEL_ANSWER:
        deltas.liveAnswers = 1;
        break;
      case TelephonyEventType.CHANNEL_HANGUP_COMPLETE: {
        const cause = event.hangupCause ?? 'UNKNOWN';
        if (cause === 'USER_BUSY') deltas.busy = 1;
        else if (cause === 'NO_ANSWER' || cause === 'NO_USER_RESPONSE') deltas.noAnswer = 1;
        else if (cause !== 'NORMAL_CLEARING') deltas.failed = 1;
        break;
      }
      default:
        return;
    }

    try {
      await this.deps.observations.applyEvent(
        event.tenantId,
        event.campaignId,
        event.occurredAt,
        deltas
      );
    } catch (error) {
      this.log({ msg: 'observation write failed', error: (error as Error).message });
    }
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
        // sofia::* registration events carry endpoint state, not call state.
        // They are routed by SUBCLASS, not by whether attribution succeeded —
        // the previous code fell through to the call ingestor whenever the
        // registry declined the event, which meant every registration lacking a
        // trusted tenant variable was silently reprocessed as a call event.
        const subclass = raw['Event-Subclass'];
        if (subclass && SIP_REGISTRATION_SUBCLASSES.includes(subclass)) {
          void this.handleRegistrationEvent(raw, subclass);
          return;
        }
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
   * The single authoritative handler for every Sofia registration event.
   *
   * The SIP domain is a lookup INPUT. Identity comes back from the extension
   * resolver, never from the event. A `variable_hopwhistle_tenant_id` on the
   * event is not trusted either — it is only checked FOR AGREEMENT with the
   * resolved binding, so a forged one causes rejection rather than acceptance.
   *
   * Returns true when applied, false when quarantined. Either way the event
   * never reaches the call ingestor: a failed lookup is a quarantine, not a
   * call event.
   */
  async handleRegistrationEvent(raw: RawEslEvent, subclass: string): Promise<boolean> {
    const extension = raw['username'] ?? raw['from-user'] ?? raw['sip_auth_username'] ?? null;
    const sipDomain = raw['domain_name'] ?? raw['sip_auth_realm'] ?? raw['realm'] ?? null;

    const quarantine = (reason: string): false => {
      this.registrationsQuarantined++;
      this.lastRegistrationRejection = reason;
      this.quarantinedRegistrations.push({ extension, sipDomain, subclass, reason });
      if (this.quarantinedRegistrations.length > 500) this.quarantinedRegistrations.shift();
      this.log({ msg: 'registration quarantined', subclass, reason });
      return false;
    };

    // Ordering is read from the event BEFORE the lookup, so it reflects when
    // FreeSWITCH emitted the event rather than when a database call happened to
    // finish. That distinction is the whole point: lookups complete out of
    // order, and without it a slow register overwrites a fast unregister.
    const ordering = readSipEventOrdering(raw, this.now());

    if (!extension || !sipDomain) return quarantine('MISSING_SIP_IDENTITY');

    const resolution = await this.deps.extensions.forSipIdentity(extension, sipDomain);
    if (!resolution.ok) return quarantine(resolution.rejection);

    const binding = resolution.binding;

    // A tenant variable on the event is corroboration, not authority. If it
    // disagrees with the database binding, something is wrong — a
    // misconfiguration or a forged header — and neither answer is safe to use.
    const claimedTenant =
      raw['variable_hopwhistle_tenant_id'] ?? raw['hopwhistle_tenant_id'] ?? null;
    if (claimedTenant !== null && claimedTenant !== binding.tenantId) {
      this.registrationsForgedTenant++;
      return quarantine('TENANT_VARIABLE_CONTRADICTS_BINDING');
    }

    const expiresRaw = raw['expires'];
    const expiresSeconds = expiresRaw ? Number.parseInt(expiresRaw, 10) : Number.NaN;

    const result = await this.deps.sip.apply({
      tenantId: binding.tenantId,
      // The resolved agent is persisted alongside the extension. Storing only
      // the extension would force every later reader to redo the same lookup,
      // and a reassignment between those lookups would attribute the
      // registration to a different agent than the one it was resolved for.
      agentId: binding.agentId,
      extension: binding.extension,
      subclass,
      eventAtMs: ordering.eventAtMs,
      eventSequence: ordering.eventSequence,
      receivedAtMs: this.now(),
      expiresAtMs:
        Number.isFinite(expiresSeconds) && expiresSeconds > 0
          ? ordering.eventAtMs + expiresSeconds * 1000
          : null,
      contact: raw['contact'] ?? null,
      networkIp: raw['network-ip'] ?? null,
    });

    if (result.outcome === SipWriteOutcome.APPLIED) {
      this.registrationsResolved++;
      return true;
    }
    if (result.outcome === SipWriteOutcome.STALE_EVENT) {
      // Not an error: this is the mechanism working. A lookup finished after a
      // newer event had already been applied, and the newer one stands.
      this.registrationsOutOfOrder++;
      return false;
    }
    return quarantine(`SIP_WRITE_${result.outcome}`);
  }

  /** Registrations that could not be attributed. They contribute no capacity. */
  recentQuarantinedRegistrations(): ReadonlyArray<{
    extension: string | null;
    sipDomain: string | null;
    subclass: string;
    reason: string;
  }> {
    return this.quarantinedRegistrations;
  }

  /**
   * Reconcile agent state against live channel ownership and authoritative SIP
   * registration. Coordinated: only one replica runs a pass per interval.
   */
  async runReconciliation(): Promise<ReconciliationCorrection[]> {
    const lock = globalLock('reconcile');
    const handle = await this.deps.lock.acquire(
      lock,
      Math.max(1_000, this.deps.config.reconcileIntervalMs - 100)
    );
    if (!handle) {
      this.reconcilePassesSkippedForLock++;
      return [];
    }

    try {
      return await this.reconcileNow();
    } finally {
      await this.deps.lock.release(lock);
    }
  }

  /**
   * The reconciliation body, without locking. Exposed for tests and for the
   * single-instance path.
   */
  async reconcileNow(): Promise<ReconciliationCorrection[]> {
    const nowMs = this.now();
    const corrections: ReconciliationCorrection[] = [];

    // Push authoritative SIP state into the agent service BEFORE reconciling,
    // so the reconciler compares against FreeSWITCH rather than a browser claim.
    for (const record of this.deps.agents.allAgents()) {
      // Keyed by agent, not extension. The registration was resolved to an
      // agent when it was written, so re-deriving the mapping here would give a
      // second chance for a reassignment to attribute it to someone else.
      const registered = await this.deps.sip.isRegistered(record.tenantId, record.agentId);
      if (record.sipRegistered !== registered) {
        this.deps.agents.setSipRegistration(record.tenantId, record.agentId, registered, nowMs);
      }

      if (registered) continue;

      // Positive evidence the endpoint is gone (an unregister or expire) is not
      // a transient blip, so it bypasses the grace period entirely.
      const registration = await this.deps.sip.get(record.tenantId, record.agentId);
      if (registration && registration.lifecycle !== SipLifecycle.REGISTERED) {
        const correction = this.deps.agents.withdrawForSipLoss(
          record.tenantId,
          record.agentId,
          nowMs,
          `FreeSWITCH reported ${registration.lifecycle} for extension ${registration.extension}`
        );
        if (correction) corrections.push(correction);
      }
    }

    corrections.push(
      ...this.deps.agents.reconcile(nowMs, {
        liveChannelUuids: this.collector.liveChannelUuids(),
        channelOwners: this.collector.channelOwners(),
      })
    );
    this.lastReconciliationAtMs = nowMs;
    if (corrections.length > 0) {
      this.log({ msg: 'agent corrections', count: corrections.length });
      // A correction changes durable state, so it has to reach the shared
      // record. Leaving it only in the cache means the next replica to read the
      // agent gets the state this pass just decided was wrong.
      for (const correction of corrections) {
        await this.persistAgent(correction.tenantId, correction.agentId);
      }
    }
    await this.deps.sessions.sweep(nowMs);
    return corrections;
  }

  /**
   * Persist a cached agent record under its revision.
   *
   * The cache is NEVER advanced on a refused write. On a stale revision the
   * store hands back what is current and the cache adopts that instead — the
   * refused change is dropped rather than retried blindly, because the state it
   * was computed against no longer exists.
   */
  private async persistAgent(tenantId: string, agentId: string): Promise<AgentWriteOutcome> {
    const record = this.deps.agents.get(tenantId, agentId);
    if (!record) return AgentWriteOutcome.GONE;

    const result = await this.deps.agentStore.save({ ...record }, record.revision);

    switch (result.outcome) {
      case AgentWriteOutcome.SAVED:
        record.revision = result.revision ?? record.revision + 1;
        return result.outcome;

      case AgentWriteOutcome.STALE_REVISION:
        this.agentStaleWrites++;
        if (result.current) this.deps.agents.adopt(result.current);
        return result.outcome;

      case AgentWriteOutcome.GONE:
        // The durable record expired underneath us. Re-create from revision 0
        // rather than resurrecting under a revision nobody else has seen.
        record.revision = 0;
        return result.outcome;

      default:
        this.agentWritesUnavailable++;
        return result.outcome;
    }
  }

  /**
   * One shadow pass over every observed campaign. Records a decision per
   * campaign; originates nothing.
   */
  async runShadowPass(): Promise<number> {
    const flags: DialerV2Flags = this.deps.flags.get();
    const nowMs = this.now();
    const eslStatus = this.eslClient?.getStatus() ?? null;
    const scopes = this.collector.activeScopes();

    let count = 0;

    // Per-campaign coordination. A single global lock serialised every tenant
    // and campaign, so one slow campaign stalled the whole deployment and two
    // tenants could never progress concurrently. Each campaign now takes its
    // own lock, built by a validated tenant-scoped key builder, and that lock
    // authorises that campaign's write only.
    const ttlMs = Math.max(3_000, this.deps.config.shadowIntervalMs * 3);

    for (const scope of scopes) {
      let lock;
      try {
        lock = campaignShadowLock(scope.tenantId, scope.campaignId);
      } catch {
        // A scope whose ids cannot form a valid key cannot be locked, and a
        // decision written without a lock is not evidence.
        this.shadowScopesUnkeyable++;
        continue;
      }

      const handle = await this.deps.lock.acquire(lock, ttlMs);
      if (!handle) {
        this.shadowPassesSkippedForLock++;
        continue;
      }

      try {
        const obs = await this.buildObservation(scope.tenantId, scope.campaignId, nowMs, eslStatus);
        const record = await this.shadow.evaluate(flags, obs, {
          // Proof of ownership travels with the decision. Redis, not this
          // process, decides whether the lock is still ours at the moment of
          // the write — this replica may have paused between acquire and write.
          fencingToken: handle.fencingToken,
          lockValue: handle.lockValue,
        });
        if (record.persisted) count++;
        else this.shadowWritesRejected++;
      } finally {
        await this.deps.lock.release(lock);
      }
    }

    this.lastShadowRunAtMs = nowMs;
    this.shadowDecisionsThisRun = count;
    return count;
  }

  private async buildObservation(
    tenantId: string,
    campaignId: string,
    nowMs: number,
    eslStatus: EslStatus | null
  ): Promise<ShadowObservation> {
    const observed = this.collector.observe(tenantId, campaignId);
    const capacity = this.deps.agents.capacity(tenantId, nowMs, campaignId);

    // Rates come from the SHARED trailing window, not this replica's slice of
    // it. Two replicas each seeing half the calls would each estimate from half
    // the sample and neither would ever reach minSampleSize — the controller
    // would stay degraded while believing it lacked data it had.
    const shared = await this.deps.observations.read(tenantId, campaignId);
    const attempts = shared?.attempts ?? observed.attempts;
    const liveAnswers = shared?.liveAnswers ?? observed.liveAnswers;
    const abandons = shared?.abandons ?? observed.abandonedCount;

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
        attempts,
        liveAnswers,
        meanAnswerLatencyMs: shared?.meanAnswerLatencyMs || observed.meanAnswerLatencyMs,
        // The p95 stays local: a percentile cannot be reconstructed from sums,
        // and shipping every latency sample to Redis to compute one is not
        // worth it. Reported from this replica's view and known to be that.
        p95AnswerLatencyMs: observed.p95AnswerLatencyMs,
        meanHandleTimeMs: shared?.meanCallDurationMs || observed.meanCallDurationMs || 150_000,
        meanWrapUpMs: 15_000,
        // Compliance definition: abandoned ÷ live-answered, not ÷ attempts.
        abandonRate: liveAnswers > 0 ? abandons / liveAnswers : observed.abandonRate,
        abandonSampleSize: liveAnswers,
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
      shadowWritesRejected: this.shadowWritesRejected,
      shadowScopesUnkeyable: this.shadowScopesUnkeyable,
      reconcilePassesSkippedForLock: this.reconcilePassesSkippedForLock,
      sip: {
        resolved: this.registrationsResolved,
        quarantined: this.registrationsQuarantined,
        outOfOrder: this.registrationsOutOfOrder,
        forgedTenant: this.registrationsForgedTenant,
      },
      registrationsResolved: this.registrationsResolved,
      registrationsQuarantined: this.registrationsQuarantined,
      registrationsForgedTenant: this.registrationsForgedTenant,
      registrationsOutOfOrder: this.registrationsOutOfOrder,
      agentStaleWrites: this.agentStaleWrites,
      agentWritesUnavailable: this.agentWritesUnavailable,
      reconstructionComplete: this.reconstructionComplete,
      lastRegistrationRejection: this.lastRegistrationRejection,
    };
  }

  /**
   * Reconstruct shared state before this replica claims its evidence is
   * trustworthy.
   *
   * Called once at startup, per tenant. Until it succeeds
   * `reconstructionComplete` is false and health refuses to describe the shadow
   * history as evidence: a replica that started with an empty map is not
   * observing a quiet deployment, it is observing nothing.
   */
  async reconstruct(tenantIds: readonly string[]): Promise<{ agents: number; sip: number }> {
    let agents = 0;
    let sip = 0;
    let complete = true;

    for (const tenantId of tenantIds) {
      try {
        const records = await this.deps.agentStore.loadTenant<AgentRecord>(tenantId);
        agents += this.deps.agents.hydrate(records);

        const registrations = await this.deps.sip.loadAll(tenantId);
        sip += registrations.length;

        // Channel ownership is restored so an agent genuinely mid-call is not
        // "corrected" to WRAP_UP on the first reconciliation pass after a
        // deploy, which would drop the call from every capacity number at once.
        const channels = await this.deps.channels.loadAll(tenantId);
        for (const channel of channels) {
          const record = this.deps.agents.get(channel.tenantId, channel.agentId);
          if (record) record.currentChannelUuid = channel.channelUuid;
        }
      } catch (error) {
        complete = false;
        this.log({
          msg: 'reconstruction failed',
          tenantId,
          error: (error as Error).message,
        });
      }
    }

    this.reconstructionComplete = complete;
    this.log({ msg: 'reconstruction', agents, sip, complete });
    return { agents, sip };
  }

  /** Mint a server-issued session. Identity must already be verified. */
  issueSession(
    tenantId: string,
    agentId: string,
    userId: string
  ): Promise<IssuedSessionResult | null> {
    return this.deps.sessions.issue(tenantId, agentId, userId);
  }

  /** Revoke a session on logout. The caller holds the hash, never the token. */
  revokeSession(tenantId: string, sessionTokenHash: string, reason: string): Promise<boolean> {
    return this.deps.sessions.revoke(tenantId, sessionTokenHash, reason);
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
    /**
     * The bearer token, read server-side from an HttpOnly cookie by the API.
     *
     * Never present in a browser-visible request body and never echoed back.
     */
    sessionToken: string;
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
    extension?: string | null;
    extensionRejection?: string;
    durable?: boolean;
    writeOutcome?: AgentWriteOutcome;
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
        // No part of the token appears here. A six-character prefix of a
        // base64url token is 36 bits of the credential written to durable
        // storage on every single heartbeat, which is both a real reduction in
        // the search space and a value that ends up wherever logs are shipped.
        // The agent id already identifies the session's subject.
        browserClaimedSip: input.browserClaimsSipRegistered === true,
        freeswitchSip,
        countedAsCapacity,
      });
    };

    const validation = await this.deps.sessions.validate(
      input.sessionToken,
      input.tenantId,
      input.agentId,
      input.sequence
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

    // Liveness is recorded against the token HASH, not the token. The hash is a
    // stable per-session identifier that is safe to hold in memory and safe to
    // compare, and the duplicate-tab check needs nothing more than that.
    agents.heartbeat(input.tenantId, input.agentId, session.sessionTokenHash, nowMs);

    // Extension: resolved server-side, never taken from the browser and never
    // assumed to equal the agent id. Until this resolves, `record.extension` is
    // null and no SIP registration can ever match — which is exactly why this
    // step has to happen before the SIP check rather than after it.
    const extension = await this.deps.extensions.forAgent(input.tenantId, input.agentId);
    record.extension = extension.ok ? extension.binding.extension : null;
    if (extension.ok) record.maxConcurrentCalls = extension.binding.maxConcurrentCalls;

    // SIP registration: FreeSWITCH is the authority, read from shared state so
    // a registration seen by another replica still counts. The browser's claim
    // is recorded in the audit trail so a disagreement is visible.
    const sipRegistered = await this.deps.sip.isRegistered(input.tenantId, input.agentId);
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

    // Call id and channel UUID come from observed telephony, never the browser,
    // and the lookup requires BOTH ids — see channelOwnedBy.
    const owned = this.collector.channelOwnedBy(input.tenantId, input.agentId);
    record.currentChannelUuid = owned?.channelUuid ?? null;
    record.currentCallId = owned?.callId ?? null;
    if (owned) {
      // Persisted so a restarting replica can tell "this agent has no channel"
      // apart from "I have not observed this agent's channel yet".
      await this.deps.channels.claim(
        input.tenantId,
        input.agentId,
        owned.channelUuid,
        owned.callId
      );
    }

    // An older session may still beat, but must not be counted as capacity —
    // two tabs both claiming AVAILABLE would double-count the agent. Across
    // replicas this is only answerable from shared state.
    const newest = await this.deps.sessions.isNewestForAgent(
      input.tenantId,
      input.agentId,
      session.sessionTokenHash
    );

    if (input.uiState === 'AVAILABLE' && newest) {
      agents.transition(input.tenantId, input.agentId, AgentState.AVAILABLE, nowMs);
    } else if (input.uiState === 'PAUSED') {
      agents.transition(input.tenantId, input.agentId, AgentState.PAUSED, nowMs);
    }

    // Everything above mutated the CACHE. Nothing is true across the deployment
    // until the shared record accepts it, and a refused write must not leave
    // this replica believing a transition landed.
    const written = await this.persistAgent(input.tenantId, input.agentId);
    const durable = written === AgentWriteOutcome.SAVED;

    const after = agents.get(input.tenantId, input.agentId);
    const countedAsCapacity =
      durable && after?.state === AgentState.AVAILABLE && sipRegistered && newest;

    audit(true, undefined, countedAsCapacity, sipRegistered);

    return {
      accepted: true,
      state: after?.state,
      countedAsCapacity,
      sipRegistered,
      campaignIds: assignment.campaignIds,
      extension: record.extension,
      extensionRejection: extension.ok ? undefined : extension.rejection,
      // A heartbeat whose state could not be shared is reported as such. The
      // agent is not counted as capacity, and the caller can say why.
      durable,
      writeOutcome: written,
    };
  }
}
