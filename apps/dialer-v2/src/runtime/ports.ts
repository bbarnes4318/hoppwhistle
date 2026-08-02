/**
 * Dialer V2 — the ports the runtime depends on.
 *
 * ── Why the runtime cannot keep naming concrete classes ──────────────────────
 *
 * `DialerV2Runtime` used to require `AgentSessionRegistry`, `AgentStateService`
 * and `SipRegistrationRegistry` by name. All three are synchronous in-process
 * `Map`s, and the Redis implementations that replace them are asynchronous, so
 * the Redis versions could not be substituted at all — they were built, tested,
 * and then not used, while the entrypoint went on constructing the memory ones.
 *
 * Widening the parameter types is not enough on its own. The temptation is to
 * put a Redis store BESIDE the in-memory service and write to both, keeping the
 * in-memory one authoritative because it is the one the synchronous pacing loop
 * reads. That is worse than not having Redis at all: it looks durable and
 * shared, and every read still comes from a per-replica map. So these ports are
 * async throughout, and the memory implementations are the substitutable ones —
 * not the other way round.
 *
 * In staging and production the Redis implementations are authoritative and the
 * runtime's local map is a cache that is only ever populated from an accepted
 * Redis write. A rejected write leaves the cache untouched; see
 * `applyAcceptedWrite` at the call sites.
 */

import { hashSessionToken, mintSessionToken } from '../agents/session-store.js';
import {
  AgentSessionRegistry,
  SessionRejection,
  type SessionRegistryOptions,
} from '../agents/sessions.js';
import type { AgentWriteResult, RevisionedAgentRecord } from '../stores/agent-state-store.js';
import { AgentWriteOutcome } from '../stores/agent-state-store.js';
import type { ChannelOwnership } from '../stores/channel-ownership.js';
import type { ObservationCounters, ObservationSnapshot } from '../stores/observation-store.js';
import {
  SipLifecycle,
  SipWriteOutcome,
  type SipRegistrationEvent,
  type SipRegistrationRecord,
  type SipWriteResult,
} from '../stores/sip-store.js';

/** Where an implementation actually keeps its state. Reported through health. */
export type Backend = 'redis' | 'memory';

// ── Sessions ────────────────────────────────────────────────────────────────

/**
 * A validated session, as the runtime sees it.
 *
 * Carries the token HASH, never the token. The runtime has no legitimate use
 * for the plaintext — it validates by presenting what the client sent — and a
 * value that is never held cannot be logged by accident.
 */
export interface SessionHandle {
  sessionTokenHash: string;
  tenantId: string;
  agentId: string;
  userId: string;
  issuedAtMs: number;
  expiresAtMs: number;
  lastSequence: number;
}

export interface IssuedSessionResult {
  /** Returned exactly once, to be placed in an HttpOnly cookie by the API. */
  token: string;
  sessionTokenHash: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

export interface SessionValidationResult {
  ok: boolean;
  rejection?: SessionRejection;
  session?: SessionHandle;
}

export interface AgentSessionStore {
  readonly backend: Backend;
  issue(tenantId: string, agentId: string, userId: string): Promise<IssuedSessionResult | null>;
  validate(
    presentedToken: string,
    tenantId: string,
    agentId: string,
    sequence: number
  ): Promise<SessionValidationResult>;
  isNewestForAgent(tenantId: string, agentId: string, sessionTokenHash: string): Promise<boolean>;
  revoke(tenantId: string, sessionTokenHash: string, reason: string): Promise<boolean>;
  revokeAllForAgent(tenantId: string, agentId: string, reason: string): Promise<number>;
  sweep(nowMs: number): Promise<number>;
  size(): Promise<number>;
}

/**
 * In-process sessions, behind the async port.
 *
 * Legitimate only for unit tests and single-instance development. Behind a load
 * balancer a session minted here is UNKNOWN_SESSION on every other replica, and
 * `isNewestForAgent` can only see this replica's sessions — so two tabs landing
 * on two replicas are each "newest" and the agent counts twice as capacity.
 * `composition.ts` refuses to build this in staging or production.
 */
export class MemoryAgentSessionStore implements AgentSessionStore {
  readonly backend = 'memory' as const;
  private readonly registry: AgentSessionRegistry;
  /** hash → the plaintext id the registry knows it by. */
  private readonly byHash = new Map<string, string>();
  private readonly now: () => number;

  constructor(options: SessionRegistryOptions & { now?: () => number } = {}) {
    this.registry = new AgentSessionRegistry({
      ...options,
      generateId: options.generateId ?? mintSessionToken,
    });
    this.now = options.now ?? (() => Date.now());
  }

  issue(tenantId: string, agentId: string, userId: string): Promise<IssuedSessionResult | null> {
    const session = this.registry.issue(tenantId, agentId, userId, this.now());
    if (!session) return Promise.resolve(null);

    const sessionTokenHash = hashSessionToken(session.sessionId);
    this.byHash.set(sessionTokenHash, session.sessionId);
    return Promise.resolve({
      token: session.sessionId,
      sessionTokenHash,
      issuedAtMs: session.issuedAtMs,
      expiresAtMs: session.expiresAtMs,
    });
  }

  validate(
    presentedToken: string,
    tenantId: string,
    agentId: string,
    sequence: number
  ): Promise<SessionValidationResult> {
    const result = this.registry.validate(presentedToken, tenantId, agentId, sequence, this.now());
    if (!result.ok || !result.session) {
      return Promise.resolve({ ok: false, rejection: result.rejection });
    }
    const s = result.session;
    return Promise.resolve({
      ok: true,
      session: {
        sessionTokenHash: hashSessionToken(s.sessionId),
        tenantId: s.tenantId,
        agentId: s.agentId,
        userId: s.userId,
        issuedAtMs: s.issuedAtMs,
        expiresAtMs: s.expiresAtMs,
        lastSequence: s.lastSequence,
      },
    });
  }

  isNewestForAgent(tenantId: string, agentId: string, sessionTokenHash: string): Promise<boolean> {
    const id = this.byHash.get(sessionTokenHash);
    if (!id) return Promise.resolve(false);
    const session = this.registry.sessionsFor(tenantId, agentId).find(s => s.sessionId === id);
    return Promise.resolve(session ? this.registry.isNewestForAgent(session) : false);
  }

  revoke(_tenantId: string, sessionTokenHash: string, reason: string): Promise<boolean> {
    const id = this.byHash.get(sessionTokenHash);
    return Promise.resolve(id ? this.registry.revoke(id, reason) : false);
  }

  revokeAllForAgent(tenantId: string, agentId: string, reason: string): Promise<number> {
    return Promise.resolve(this.registry.revokeAllForAgent(tenantId, agentId, reason));
  }

  sweep(nowMs: number): Promise<number> {
    return Promise.resolve(this.registry.sweep(nowMs));
  }

  size(): Promise<number> {
    return Promise.resolve(this.registry.size());
  }
}

// ── Agent state ─────────────────────────────────────────────────────────────

export interface AgentStateRepository {
  readonly backend: Backend;
  load<T extends RevisionedAgentRecord>(tenantId: string, agentId: string): Promise<T | null>;
  save<T extends RevisionedAgentRecord>(
    record: T,
    expectedRevision: number
  ): Promise<AgentWriteResult<T>>;
  loadTenant<T extends RevisionedAgentRecord>(tenantId: string): Promise<T[]>;
  staleWrites(): number;
}

/**
 * In-process agent state behind the async port.
 *
 * Implements the same revision rule as the Redis store so a test exercising
 * optimistic concurrency does not silently pass because the fake had no such
 * concept. What it CANNOT do is share — one object is trivially consistent with
 * itself — which is why the sharing claims are proven only against real Redis.
 */
export class MemoryAgentStateRepository implements AgentStateRepository {
  readonly backend = 'memory' as const;
  private readonly records = new Map<string, RevisionedAgentRecord>();
  private stale = 0;

  private key(tenantId: string, agentId: string): string {
    return `${tenantId} ${agentId}`;
  }

  staleWrites(): number {
    return this.stale;
  }

  load<T extends RevisionedAgentRecord>(tenantId: string, agentId: string): Promise<T | null> {
    return Promise.resolve((this.records.get(this.key(tenantId, agentId)) as T) ?? null);
  }

  save<T extends RevisionedAgentRecord>(
    record: T,
    expectedRevision: number
  ): Promise<AgentWriteResult<T>> {
    if (!record.tenantId || !record.agentId) {
      return Promise.resolve({ outcome: AgentWriteOutcome.INVALID_TENANT });
    }
    const key = this.key(record.tenantId, record.agentId);
    const current = this.records.get(key);

    if (current && expectedRevision === 0) {
      this.stale++;
      return Promise.resolve({
        outcome: AgentWriteOutcome.STALE_REVISION,
        current: current as T,
      });
    }
    if (!current && expectedRevision > 0) {
      return Promise.resolve({ outcome: AgentWriteOutcome.GONE });
    }
    if (current && current.revision !== expectedRevision) {
      this.stale++;
      return Promise.resolve({
        outcome: AgentWriteOutcome.STALE_REVISION,
        current: current as T,
      });
    }

    const revision = expectedRevision + 1;
    this.records.set(key, { ...record, revision });
    return Promise.resolve({ outcome: AgentWriteOutcome.SAVED, revision });
  }

  loadTenant<T extends RevisionedAgentRecord>(tenantId: string): Promise<T[]> {
    const out: T[] = [];
    for (const record of this.records.values()) {
      if (record.tenantId === tenantId) out.push(record as T);
    }
    return Promise.resolve(out);
  }
}

// ── SIP registrations ───────────────────────────────────────────────────────

export interface SipRegistrationRepository {
  readonly backend: Backend;
  apply(event: SipRegistrationEvent): Promise<SipWriteResult>;
  get(tenantId: string, agentId: string): Promise<SipRegistrationRecord | null>;
  isRegistered(tenantId: string, agentId: string): Promise<boolean>;
  loadAll(tenantId: string): Promise<SipRegistrationRecord[]>;
}

/**
 * In-process SIP state behind the async port.
 *
 * Applies the same `(eventAtMs, eventSequence)` ordering rule as the Redis
 * store, so the out-of-order-lookup bug is caught here too rather than only in
 * the live suite.
 */
export class MemorySipRegistrationRepository implements SipRegistrationRepository {
  readonly backend = 'memory' as const;
  private readonly records = new Map<string, SipRegistrationRecord>();
  private readonly staleAfterMs: number;
  private readonly now: () => number;

  constructor(options: { staleAfterMs?: number; now?: () => number } = {}) {
    this.staleAfterMs = options.staleAfterMs ?? 5 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  private key(tenantId: string, agentId: string): string {
    return `${tenantId} ${agentId}`;
  }

  apply(event: SipRegistrationEvent): Promise<SipWriteResult> {
    const lifecycle = lifecycleOf(event.subclass);
    if (!event.tenantId || !event.agentId || !event.extension || !lifecycle) {
      return Promise.resolve({ outcome: SipWriteOutcome.INVALID_SCOPE });
    }

    const key = this.key(event.tenantId, event.agentId);
    const current = this.records.get(key);

    if (current) {
      const older =
        event.eventAtMs < current.eventAtMs ||
        (event.eventAtMs === current.eventAtMs && event.eventSequence <= current.eventSequence);
      if (older) {
        return Promise.resolve({ outcome: SipWriteOutcome.STALE_EVENT, current });
      }
    }

    const revision = current ? current.revision + 1 : 0;
    const record: SipRegistrationRecord = {
      tenantId: event.tenantId,
      agentId: event.agentId,
      extension: event.extension,
      lifecycle,
      eventAtMs: event.eventAtMs,
      eventSequence: event.eventSequence,
      receivedAtMs: event.receivedAtMs,
      expiresAtMs: event.expiresAtMs,
      contact: event.contact,
      networkIp: event.networkIp,
      revision,
    };
    this.records.set(key, record);
    return Promise.resolve({ outcome: SipWriteOutcome.APPLIED, revision });
  }

  get(tenantId: string, agentId: string): Promise<SipRegistrationRecord | null> {
    return Promise.resolve(this.records.get(this.key(tenantId, agentId)) ?? null);
  }

  isRegistered(tenantId: string, agentId: string): Promise<boolean> {
    const record = this.records.get(this.key(tenantId, agentId));
    if (!record || record.lifecycle !== SipLifecycle.REGISTERED) return Promise.resolve(false);

    const nowMs = this.now();
    if (record.expiresAtMs !== null && nowMs >= record.expiresAtMs) return Promise.resolve(false);
    if (nowMs - record.eventAtMs > this.staleAfterMs) return Promise.resolve(false);
    return Promise.resolve(true);
  }

  loadAll(tenantId: string): Promise<SipRegistrationRecord[]> {
    const out: SipRegistrationRecord[] = [];
    for (const record of this.records.values()) {
      if (record.tenantId === tenantId) out.push(record);
    }
    return Promise.resolve(out);
  }
}

function lifecycleOf(subclass: string): SipLifecycle | null {
  switch (subclass) {
    case 'sofia::register':
      return SipLifecycle.REGISTERED;
    case 'sofia::unregister':
      return SipLifecycle.UNREGISTERED;
    case 'sofia::expire':
      return SipLifecycle.EXPIRED;
    case 'sofia::register_failure':
      return SipLifecycle.FAILED;
    default:
      return null;
  }
}

// ── Observations ────────────────────────────────────────────────────────────

export interface CampaignObservationRepository {
  readonly backend: Backend;
  applyEvent(
    tenantId: string,
    campaignId: string,
    eventAtMs: number,
    deltas: Partial<ObservationCounters>
  ): Promise<ObservationSnapshot | null>;
  read(tenantId: string, campaignId: string): Promise<ObservationSnapshot | null>;
}

// ── Channel ownership ───────────────────────────────────────────────────────

export interface ChannelOwnershipRepository {
  readonly backend: Backend;
  claim(
    tenantId: string,
    agentId: string,
    channelUuid: string,
    callId: string | null
  ): Promise<boolean>;
  release(tenantId: string, channelUuid: string): Promise<boolean>;
  loadAll(tenantId: string): Promise<ChannelOwnership[]>;
}

/** In-process channel ownership behind the async port. */
export class MemoryChannelOwnershipRepository implements ChannelOwnershipRepository {
  readonly backend = 'memory' as const;
  private readonly owned = new Map<string, ChannelOwnership>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  private key(tenantId: string, channelUuid: string): string {
    return `${tenantId} ${channelUuid}`;
  }

  claim(
    tenantId: string,
    agentId: string,
    channelUuid: string,
    callId: string | null
  ): Promise<boolean> {
    if (!tenantId || !agentId || !channelUuid) return Promise.resolve(false);
    this.owned.set(this.key(tenantId, channelUuid), {
      tenantId,
      agentId,
      channelUuid,
      callId,
      observedAtMs: this.now(),
    });
    return Promise.resolve(true);
  }

  release(tenantId: string, channelUuid: string): Promise<boolean> {
    return Promise.resolve(this.owned.delete(this.key(tenantId, channelUuid)));
  }

  loadAll(tenantId: string): Promise<ChannelOwnership[]> {
    const out: ChannelOwnership[] = [];
    for (const record of this.owned.values()) {
      if (record.tenantId === tenantId) out.push(record);
    }
    return Promise.resolve(out);
  }
}
