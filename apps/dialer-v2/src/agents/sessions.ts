/**
 * Dialer V2 — server-issued agent sessions.
 *
 * ── Why this replaces the browser-supplied `sessionId` ───────────────────────
 *
 * The previous heartbeat accepted whatever `sessionId` the browser sent. That
 * made duplicate-session detection worthless: a second tab could simply reuse
 * the first tab's id and never be detected, and a client could rotate ids on
 * every beat to permanently avoid the duplicate check. Worse, session identity
 * is what replay protection is anchored to, so a forgeable id means forgeable
 * sequence state.
 *
 * Sessions are now minted here, server-side, bound to a verified
 * (tenantId, agentId) pair, with a TTL and a monotonic sequence the server owns.
 * The browser receives an opaque token and can only present it back.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

import { isValidTenantId } from '../config/redis-keys.js';

export interface AgentSession {
  sessionId: string;
  tenantId: string;
  agentId: string;
  userId: string;
  issuedAtMs: number;
  expiresAtMs: number;
  lastSeenAtMs: number;
  /** Highest sequence accepted. The server owns this, not the client. */
  lastSequence: number;
  /** Heartbeats accepted in the current rate-limit window. */
  windowCount: number;
  windowStartedAtMs: number;
  revokedReason: string | null;
}

export enum SessionRejection {
  UNKNOWN_SESSION = 'UNKNOWN_SESSION',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
  WRONG_AGENT = 'WRONG_AGENT',
  WRONG_TENANT = 'WRONG_TENANT',
  REPLAYED_SEQUENCE = 'REPLAYED_SEQUENCE',
  SEQUENCE_TOO_FAR_AHEAD = 'SEQUENCE_TOO_FAR_AHEAD',
  RATE_LIMITED = 'RATE_LIMITED',
  SUPERSEDED = 'SUPERSEDED',
}

export interface SessionValidation {
  ok: boolean;
  rejection?: SessionRejection;
  session?: AgentSession;
}

export interface SessionRegistryOptions {
  ttlMs?: number;
  /** Max heartbeats accepted per agent per window. */
  maxBeatsPerWindow?: number;
  rateWindowMs?: number;
  /**
   * A sequence more than this far beyond the last accepted value is rejected.
   * A client that jumps to 2^31 would otherwise permanently lock itself out of
   * its own replay window.
   */
  maxSequenceJump?: number;
  maxSessionsPerAgent?: number;
  generateId?: () => string;
}

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_MAX_BEATS = 30;
const DEFAULT_WINDOW_MS = 10_000;
const DEFAULT_MAX_SEQ_JUMP = 1_000;

/** Constant-time session-id comparison — these are bearer credentials. */
function idsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export class AgentSessionRegistry {
  private readonly sessions = new Map<string, AgentSession>();
  /** tenantId+agentId → sessionIds, newest last. */
  private readonly byAgent = new Map<string, string[]>();

  private readonly ttlMs: number;
  private readonly maxBeatsPerWindow: number;
  private readonly rateWindowMs: number;
  private readonly maxSequenceJump: number;
  private readonly maxSessionsPerAgent: number;
  private readonly generateId: () => string;

  constructor(options: SessionRegistryOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxBeatsPerWindow = options.maxBeatsPerWindow ?? DEFAULT_MAX_BEATS;
    this.rateWindowMs = options.rateWindowMs ?? DEFAULT_WINDOW_MS;
    this.maxSequenceJump = options.maxSequenceJump ?? DEFAULT_MAX_SEQ_JUMP;
    this.maxSessionsPerAgent = options.maxSessionsPerAgent ?? 3;
    // 256 bits of entropy: these are bearer tokens, not display identifiers.
    this.generateId = options.generateId ?? (() => randomBytes(32).toString('base64url'));
  }

  private agentKey(tenantId: string, agentId: string): string {
    return `${tenantId} ${agentId}`;
  }

  /**
   * Mint a session. The caller must already have verified the identity — this
   * registry never derives a tenant or agent from client input.
   */
  issue(tenantId: string, agentId: string, userId: string, nowMs: number): AgentSession | null {
    if (!isValidTenantId(tenantId) || !agentId) return null;

    const session: AgentSession = {
      sessionId: this.generateId(),
      tenantId,
      agentId,
      userId,
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + this.ttlMs,
      lastSeenAtMs: nowMs,
      lastSequence: 0,
      windowCount: 0,
      windowStartedAtMs: nowMs,
      revokedReason: null,
    };

    this.sessions.set(session.sessionId, session);

    const key = this.agentKey(tenantId, agentId);
    const existing = this.byAgent.get(key) ?? [];
    existing.push(session.sessionId);

    // Bound concurrent sessions per agent. The oldest is revoked rather than
    // silently dropped, so the agent-state service can withdraw capacity.
    while (existing.length > this.maxSessionsPerAgent) {
      const oldest = existing.shift();
      if (oldest) this.revoke(oldest, 'exceeded max sessions per agent');
    }
    this.byAgent.set(key, existing);

    return session;
  }

  /** All live session ids for an agent, oldest first. */
  sessionsFor(tenantId: string, agentId: string): AgentSession[] {
    const ids = this.byAgent.get(this.agentKey(tenantId, agentId)) ?? [];
    return ids.map(id => this.sessions.get(id)).filter((s): s is AgentSession => s !== undefined);
  }

  revoke(sessionId: string, reason: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.revokedReason !== null) return false;
    session.revokedReason = reason;
    return true;
  }

  revokeAllForAgent(tenantId: string, agentId: string, reason: string): number {
    let n = 0;
    for (const session of this.sessionsFor(tenantId, agentId)) {
      if (this.revoke(session.sessionId, reason)) n++;
    }
    return n;
  }

  /**
   * Validate a presented session against a verified identity and a sequence.
   *
   * Every check is against server-held state. Nothing the browser sends other
   * than the opaque id and the sequence number is consulted, and both are
   * checked rather than trusted.
   */
  validate(
    sessionId: string,
    tenantId: string,
    agentId: string,
    sequence: number,
    nowMs: number
  ): SessionValidation {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return { ok: false, rejection: SessionRejection.UNKNOWN_SESSION };
    }

    // Look up by exact key first, then confirm with a constant-time compare so
    // the map lookup itself is not the only guard.
    const session = this.sessions.get(sessionId);
    if (!session || !idsMatch(session.sessionId, sessionId)) {
      return { ok: false, rejection: SessionRejection.UNKNOWN_SESSION };
    }
    if (session.revokedReason !== null) {
      return { ok: false, rejection: SessionRejection.REVOKED, session };
    }
    if (nowMs >= session.expiresAtMs) {
      return { ok: false, rejection: SessionRejection.EXPIRED, session };
    }
    // A stolen session must not work against a different identity.
    if (session.tenantId !== tenantId) {
      return { ok: false, rejection: SessionRejection.WRONG_TENANT, session };
    }
    if (session.agentId !== agentId) {
      return { ok: false, rejection: SessionRejection.WRONG_AGENT, session };
    }

    // Rate limit before sequence, so a flood cannot be used to burn through the
    // sequence space.
    if (nowMs - session.windowStartedAtMs > this.rateWindowMs) {
      session.windowStartedAtMs = nowMs;
      session.windowCount = 0;
    }
    if (session.windowCount >= this.maxBeatsPerWindow) {
      return { ok: false, rejection: SessionRejection.RATE_LIMITED, session };
    }

    if (sequence <= session.lastSequence) {
      return { ok: false, rejection: SessionRejection.REPLAYED_SEQUENCE, session };
    }
    if (sequence > session.lastSequence + this.maxSequenceJump) {
      return { ok: false, rejection: SessionRejection.SEQUENCE_TOO_FAR_AHEAD, session };
    }

    session.lastSequence = sequence;
    session.lastSeenAtMs = nowMs;
    session.windowCount++;
    return { ok: true, session };
  }

  /**
   * Is this the newest live session for its agent? A heartbeat from an older
   * session is accepted but must not be counted as capacity — two tabs both
   * claiming AVAILABLE would otherwise double-count the agent.
   */
  isNewestForAgent(session: AgentSession): boolean {
    const ids = this.byAgent.get(this.agentKey(session.tenantId, session.agentId)) ?? [];
    const live = ids.filter(id => this.sessions.get(id)?.revokedReason === null);
    return live[live.length - 1] === session.sessionId;
  }

  /** Drop expired and revoked sessions. Returns how many were removed. */
  sweep(nowMs: number): number {
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (session.revokedReason !== null || nowMs >= session.expiresAtMs) {
        this.sessions.delete(id);
        const key = this.agentKey(session.tenantId, session.agentId);
        const ids = (this.byAgent.get(key) ?? []).filter(existing => existing !== id);
        if (ids.length === 0) this.byAgent.delete(key);
        else this.byAgent.set(key, ids);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.sessions.size;
  }
}
