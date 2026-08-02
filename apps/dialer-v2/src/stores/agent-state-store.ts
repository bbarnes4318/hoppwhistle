/**
 * Dialer V2 — durable, shared agent state and SIP registrations.
 *
 * ── What was wrong with holding this only in memory ──────────────────────────
 *
 * `AgentStateService` keeps every `AgentRecord` in a `Map`, and
 * `SipRegistrationRegistry` does the same for registrations. On one process
 * that is fine. Across a real deployment it means:
 *
 *  - A restart loses every agent's state. The pacing controller then sees zero
 *    available agents and stops dialling until every agent re-heartbeats — or,
 *    worse, sees agents as OFFLINE while FreeSWITCH still has them on calls.
 *  - SIP registrations are only known to the replica whose ESL connection saw
 *    the `sofia::register`. A second replica believes the same agent has no
 *    endpoint and refuses to count it.
 *  - Two replicas can write conflicting states for one agent with no way to
 *    tell which is newer.
 *
 * This makes Redis the durable record. The in-memory map stays as the hot-path
 * cache the synchronous pacing loop reads; Redis is what it is reconstructed
 * from.
 *
 * ── Why writes carry a revision ──────────────────────────────────────────────
 *
 * Two replicas writing the same agent is not hypothetical: a browser heartbeat
 * can land on replica A while the FreeSWITCH event for the same agent lands on
 * replica B. Last-write-wins would let a replica that read the record a second
 * ago overwrite a newer transition — an agent moved to ON_CALL could be
 * reverted to AVAILABLE and then dialled again while already talking.
 *
 * So every record carries a monotonic `revision`, and a write is accepted only
 * if the revision it was based on is still current. A rejected write returns
 * the current record, so the caller can re-apply rather than guess.
 */

import {
  agentIndexKey,
  agentStateKey,
  isValidTenantId,
  sipRegistrationKey,
} from '../config/redis-keys.js';

export interface AgentStateRedis {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  smembers(key: string): Promise<string[]>;
  mget(...keys: string[]): Promise<Array<string | null>>;
}

/**
 * KEYS[1] = agent state key
 * KEYS[2] = tenant agent index
 *
 * ARGV[1] = expected revision (-1 ⇒ create only if absent)
 * ARGV[2] = serialized record, already carrying its NEW revision
 * ARGV[3] = agentId
 * ARGV[4] = TTL ms for the record
 *
 * Returns 'OK', or the current serialized record when the revision is stale.
 * Returning the record rather than a bare failure means the caller can re-apply
 * its change to fresh state instead of re-reading and racing again.
 */
export const SAVE_IF_REVISION = [
  'local current = redis.call("get", KEYS[1])',
  'local expected = tonumber(ARGV[1])',
  '',
  'if current then',
  '  local decoded = cjson.decode(current)',
  '  if expected < 0 then return current end',
  '  if tonumber(decoded.revision) ~= expected then return current end',
  'elseif expected > 0 then',
  // The record vanished — expired, or evicted. Recreating it under an old
  // revision would resurrect state that may since have been superseded.
  '  return "GONE"',
  'end',
  '',
  'redis.call("set", KEYS[1], ARGV[2], "PX", tonumber(ARGV[4]))',
  'redis.call("sadd", KEYS[2], ARGV[3])',
  'redis.call("pexpire", KEYS[2], tonumber(ARGV[4]))',
  'return "OK"',
].join('\n');

export enum AgentWriteOutcome {
  SAVED = 'SAVED',
  STALE_REVISION = 'STALE_REVISION',
  GONE = 'GONE',
  INVALID_TENANT = 'INVALID_TENANT',
  UNAVAILABLE = 'UNAVAILABLE',
}

/** Anything with a tenant, an agent, and a revision can be stored here. */
export interface RevisionedAgentRecord {
  tenantId: string;
  agentId: string;
  revision: number;
  [field: string]: unknown;
}

export interface AgentWriteResult<T> {
  outcome: AgentWriteOutcome;
  /** On STALE_REVISION, the record that is actually current. */
  current?: T;
  /** On SAVED, the revision that was written. */
  revision?: number;
}

export interface AgentStateStoreOptions {
  redis: AgentStateRedis;
  /**
   * How long a record survives without being written again.
   *
   * Long enough to outlive a deployment restart — the point is reconstruction —
   * but not indefinite, so an agent that is genuinely gone does not linger as
   * phantom capacity forever.
   */
  ttlMs?: number;
  onFailure?: (operation: string, error: Error) => void;
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

export class RedisAgentStateStore {
  private readonly ttlMs: number;
  private staleWrites = 0;

  constructor(private readonly options: AgentStateStoreOptions) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  metrics(): { staleWrites: number } {
    return { staleWrites: this.staleWrites };
  }

  /**
   * Persist a record.
   *
   * `expectedRevision` is the revision the caller based its change on. Pass 0
   * for a record that has never been written; the write then succeeds only if
   * nothing exists yet, so two replicas racing to create the same agent cannot
   * both win.
   */
  async save<T extends RevisionedAgentRecord>(
    record: T,
    expectedRevision: number
  ): Promise<AgentWriteResult<T>> {
    if (!isValidTenantId(record.tenantId) || !record.agentId) {
      return { outcome: AgentWriteOutcome.INVALID_TENANT };
    }

    const revision = expectedRevision + 1;
    const next = { ...record, revision };

    try {
      const reply = String(
        await this.options.redis.eval(
          SAVE_IF_REVISION,
          2,
          agentStateKey(record.tenantId, record.agentId),
          agentIndexKey(record.tenantId),
          String(expectedRevision === 0 ? -1 : expectedRevision),
          JSON.stringify(next),
          record.agentId,
          String(this.ttlMs)
        )
      );

      if (reply === 'OK') return { outcome: AgentWriteOutcome.SAVED, revision };
      if (reply === 'GONE') return { outcome: AgentWriteOutcome.GONE };

      this.staleWrites++;
      return {
        outcome: AgentWriteOutcome.STALE_REVISION,
        current: safeParse<T>(reply) ?? undefined,
      };
    } catch (error) {
      this.options.onFailure?.('agentState.save', error as Error);
      // Fail closed: report that the write did not happen. Reporting success
      // would leave the in-memory cache believing it is durable when it is not.
      return { outcome: AgentWriteOutcome.UNAVAILABLE };
    }
  }

  async load<T extends RevisionedAgentRecord>(
    tenantId: string,
    agentId: string
  ): Promise<T | null> {
    if (!isValidTenantId(tenantId) || !agentId) return null;
    try {
      const raw = await this.options.redis.get(agentStateKey(tenantId, agentId));
      return raw ? safeParse<T>(raw) : null;
    } catch (error) {
      this.options.onFailure?.('agentState.load', error as Error);
      return null;
    }
  }

  /**
   * Reconstruct every agent for a tenant. This is what a replica calls on
   * startup instead of beginning with an empty map.
   *
   * Records whose tenant does not match the requested one are dropped rather
   * than returned: a mismatch means either corruption or a key-layout bug, and
   * neither should be able to leak an agent into another tenant's capacity.
   */
  async loadAll<T extends RevisionedAgentRecord>(tenantId: string): Promise<T[]> {
    if (!isValidTenantId(tenantId)) return [];
    try {
      const agentIds = await this.options.redis.smembers(agentIndexKey(tenantId));
      if (agentIds.length === 0) return [];

      const raw = await this.options.redis.mget(...agentIds.map(id => agentStateKey(tenantId, id)));

      const out: T[] = [];
      for (const entry of raw) {
        if (!entry) continue;
        const parsed = safeParse<T>(entry);
        if (parsed && parsed.tenantId === tenantId) out.push(parsed);
      }
      return out;
    } catch (error) {
      this.options.onFailure?.('agentState.loadAll', error as Error);
      return [];
    }
  }

  /**
   * Persist an observed SIP registration.
   *
   * Separate from agent state on purpose. A registration is an observation
   * about the world — FreeSWITCH said this endpoint registered — while agent
   * state is a decision this system made. Conflating them means an ESL
   * reconnect that replays registrations would rewrite agent state.
   */
  async saveSipRegistration(
    tenantId: string,
    agentId: string,
    registration: Record<string, unknown>,
    ttlMs?: number
  ): Promise<boolean> {
    if (!isValidTenantId(tenantId) || !agentId) return false;
    try {
      await this.options.redis.eval(
        'redis.call("set", KEYS[1], ARGV[1], "PX", tonumber(ARGV[2]))\nreturn "OK"',
        1,
        sipRegistrationKey(tenantId, agentId),
        JSON.stringify({ ...registration, tenantId, agentId }),
        String(ttlMs ?? this.ttlMs)
      );
      return true;
    } catch (error) {
      this.options.onFailure?.('sip.save', error as Error);
      return false;
    }
  }

  async loadSipRegistration<T>(tenantId: string, agentId: string): Promise<T | null> {
    if (!isValidTenantId(tenantId) || !agentId) return null;
    try {
      const raw = await this.options.redis.get(sipRegistrationKey(tenantId, agentId));
      return raw ? safeParse<T>(raw) : null;
    } catch (error) {
      this.options.onFailure?.('sip.load', error as Error);
      return null;
    }
  }

  /**
   * Every SIP registration for a tenant, for reconstruction after a restart.
   *
   * Uses the agent index rather than a `KEYS` scan: `KEYS` is O(n) over the
   * whole keyspace and blocks the server, which is not something a startup path
   * shared by every replica should do.
   */
  async loadAllSipRegistrations<T>(tenantId: string): Promise<T[]> {
    if (!isValidTenantId(tenantId)) return [];
    try {
      const agentIds = await this.options.redis.smembers(agentIndexKey(tenantId));
      if (agentIds.length === 0) return [];

      const raw = await this.options.redis.mget(
        ...agentIds.map(id => sipRegistrationKey(tenantId, id))
      );
      return raw
        .filter((e): e is string => e !== null)
        .flatMap(e => {
          const parsed = safeParse<T>(e);
          return parsed ? [parsed] : [];
        });
    } catch (error) {
      this.options.onFailure?.('sip.loadAll', error as Error);
      return [];
    }
  }
}

/** A corrupt entry is skipped, never thrown — one bad record must not blind a replica to the rest. */
function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
