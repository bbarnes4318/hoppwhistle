/**
 * Dialer V2 — shared SIP registration state, ordered by FreeSWITCH event order.
 *
 * ── The bug this exists to fix ───────────────────────────────────────────────
 *
 * The ESL callback started registration handling without awaiting it:
 *
 *     onRawEvent: raw => { void this.handleRegistrationEvent(raw, subclass) }
 *
 * Handling a registration requires a database lookup to turn a SIP username into
 * an agent, and lookups do not complete in the order they were issued. So for an
 * agent who registers and then immediately unregisters:
 *
 *   1. `sofia::register` arrives.   Lookup A starts — and is slow.
 *   2. `sofia::unregister` arrives. Lookup B starts — and is fast.
 *   3. B resolves. The agent is written UNREGISTERED.
 *   4. A resolves. The agent is written REGISTERED.
 *
 * The final state is the opposite of what FreeSWITCH said, and the agent counts
 * as dialable capacity with no endpoint behind it. Every predictive call placed
 * for that agent is an abandoned call — the precise failure the whole authority
 * chain was built to prevent, reintroduced by an unawaited promise.
 *
 * Awaiting the lookup would serialise every registration behind every other and
 * would still not help, because two replicas both see the same Sofia event and
 * neither can serialise the other. The ordering therefore has to be carried by
 * the DATA and adjudicated at the write.
 *
 * ── The ordering key ─────────────────────────────────────────────────────────
 *
 * Each record carries the source event's own timestamp and FreeSWITCH's
 * `Event-Sequence`. A write is accepted only when it is strictly newer than what
 * is stored, comparing `(eventAtMs, eventSequence)` lexicographically. The
 * sequence breaks ties: FreeSWITCH's millisecond timestamp is coarse enough that
 * a register and its unregister can share one, and a tie resolved arbitrarily is
 * a coin flip on whether the agent is dialable.
 *
 * Comparison and write happen inside one Lua script, so two replicas applying
 * the same event cannot both read "older" and both write.
 */

import { isValidTenantId, sipIndexKey, sipRegistrationKey } from '../config/redis-keys.js';
import type { RawEslEvent } from '../events/types.js';

export interface SipStoreRedis {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  smembers(key: string): Promise<string[]>;
  mget(...keys: string[]): Promise<Array<string | null>>;
}

/** Registration lifecycle, derived from the sofia subclass. */
export enum SipLifecycle {
  REGISTERED = 'REGISTERED',
  UNREGISTERED = 'UNREGISTERED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
}

export const SIP_REGISTRATION_SUBCLASSES = Object.freeze([
  'sofia::register',
  'sofia::unregister',
  'sofia::expire',
  'sofia::register_failure',
]);

export function lifecycleFor(subclass: string): SipLifecycle | null {
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

export interface SipRegistrationRecord {
  tenantId: string;
  /** The resolved agent. Persisted alongside the extension, not derived from it. */
  agentId: string;
  extension: string;
  lifecycle: SipLifecycle;
  /** Source event time, epoch ms, from `Event-Date-Timestamp`. */
  eventAtMs: number;
  /** FreeSWITCH `Event-Sequence`, or 0 when the event did not carry one. */
  eventSequence: number;
  /** When this process saw it. Diagnostic only — never used for ordering. */
  receivedAtMs: number;
  /** Registration expiry reported by FreeSWITCH. Null when not supplied. */
  expiresAtMs: number | null;
  contact: string | null;
  networkIp: string | null;
  revision: number;
}

export enum SipWriteOutcome {
  APPLIED = 'APPLIED',
  /** An older or duplicate event. The stored record already reflects a newer one. */
  STALE_EVENT = 'STALE_EVENT',
  INVALID_SCOPE = 'INVALID_SCOPE',
  UNAVAILABLE = 'UNAVAILABLE',
}

export interface SipWriteResult {
  outcome: SipWriteOutcome;
  revision?: number;
  /** On STALE_EVENT, what is actually stored. */
  current?: SipRegistrationRecord;
}

/**
 * KEYS[1] = registration key, KEYS[2] = tenant SIP index
 *
 * ARGV[1] = eventAtMs      ARGV[4] = agentId
 * ARGV[2] = eventSequence  ARGV[5] = TTL ms
 * ARGV[3] = payload JSON (every numeric field already a string)
 *
 * Returns the new revision as a string, or the current serialized record when
 * the presented event is not newer. Returning the record rather than a bare
 * refusal lets the caller reconcile its cache against what actually won.
 */
export const APPLY_IF_NEWER = [
  'local current = redis.call("get", KEYS[1])',
  'local revision = 0',
  '',
  'if current then',
  '  local d = cjson.decode(current)',
  '  local ct = tonumber(d.eventAtMs)',
  '  local cs = tonumber(d.eventSequence)',
  '  local nt = tonumber(ARGV[1])',
  '  local ns = tonumber(ARGV[2])',
  '  if nt < ct then return current end',
  // Equal timestamps are common — FreeSWITCH can emit a register and its
  // unregister inside the same millisecond — so the sequence is the tiebreak,
  // and an equal sequence means this is the same event arriving twice.
  '  if nt == ct and ns <= cs then return current end',
  '  revision = tonumber(d.revision) + 1',
  'end',
  '',
  'local next = cjson.decode(ARGV[3])',
  'next.revision = revision',
  'redis.call("set", KEYS[1], cjson.encode(next), "PX", tonumber(ARGV[5]))',
  'redis.call("sadd", KEYS[2], ARGV[4])',
  'redis.call("pexpire", KEYS[2], tonumber(ARGV[5]))',
  'return "R:" .. revision',
].join('\n');

export interface SipStoreOptions {
  redis: SipStoreRedis;
  /**
   * How long a registration record survives without a refreshing event. Long
   * enough to outlive a deployment restart — reconstruction is the point — but
   * not indefinite, so an endpoint that is genuinely gone does not linger as
   * phantom capacity.
   */
  ttlMs?: number;
  /** A registration with no event for this long is treated as gone. */
  staleAfterMs?: number;
  now?: () => number;
  onFailure?: (operation: string, error: Error) => void;
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

/** Everything needed to file a registration, once identity has been resolved. */
export interface SipRegistrationEvent {
  tenantId: string;
  agentId: string;
  extension: string;
  subclass: string;
  eventAtMs: number;
  eventSequence: number;
  receivedAtMs: number;
  expiresAtMs: number | null;
  contact: string | null;
  networkIp: string | null;
}

/**
 * Read the ordering and identity fields off a raw sofia event.
 *
 * A missing `Event-Sequence` becomes 0 rather than a guess. Zero orders below
 * every real sequence, so an event that cannot prove its position never
 * displaces one that can.
 */
export function readSipEventOrdering(
  raw: RawEslEvent,
  receivedAtMs: number
): { eventAtMs: number; eventSequence: number } {
  const micros = raw['Event-Date-Timestamp'];
  let eventAtMs = receivedAtMs;
  if (micros) {
    const n = Number.parseInt(micros, 10);
    // FreeSWITCH reports MICROseconds here. Reading it as milliseconds makes
    // every event look fifty years stale.
    if (Number.isFinite(n) && n > 0) eventAtMs = Math.floor(n / 1000);
  }

  const seqRaw = raw['Event-Sequence'];
  const seq = seqRaw ? Number.parseInt(seqRaw, 10) : Number.NaN;

  return {
    eventAtMs,
    eventSequence: Number.isFinite(seq) && seq > 0 ? seq : 0,
  };
}

export class RedisSipRegistrationStore {
  /** Satisfies `SipRegistrationRepository`; reported through health. */
  readonly backend = 'redis' as const;
  private readonly ttlMs: number;
  private readonly staleAfterMs: number;
  private readonly now: () => number;

  private applied = 0;
  private staleRejected = 0;

  constructor(private readonly options: SipStoreOptions) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.now = options.now ?? (() => Date.now());
  }

  metrics(): { applied: number; staleRejected: number } {
    return { applied: this.applied, staleRejected: this.staleRejected };
  }

  async apply(event: SipRegistrationEvent): Promise<SipWriteResult> {
    const lifecycle = lifecycleFor(event.subclass);
    if (!isValidTenantId(event.tenantId) || !event.agentId || !event.extension || !lifecycle) {
      return { outcome: SipWriteOutcome.INVALID_SCOPE };
    }

    let keys: string[];
    try {
      keys = [sipRegistrationKey(event.tenantId, event.agentId), sipIndexKey(event.tenantId)];
    } catch {
      return { outcome: SipWriteOutcome.INVALID_SCOPE };
    }

    // Every numeric field crosses into Lua as a string. Lua 5.1 formats numbers
    // with %.14g, so a millisecond timestamp decoded and re-encoded by cjson is
    // one digit of growth from becoming "1.8e+12".
    const payload = JSON.stringify({
      tenantId: event.tenantId,
      agentId: event.agentId,
      extension: event.extension,
      lifecycle,
      eventAtMs: String(event.eventAtMs),
      eventSequence: String(event.eventSequence),
      receivedAtMs: String(event.receivedAtMs),
      expiresAtMs: event.expiresAtMs === null ? '' : String(event.expiresAtMs),
      contact: event.contact ?? '',
      networkIp: event.networkIp ?? '',
    });

    try {
      const reply = String(
        await this.options.redis.eval(
          APPLY_IF_NEWER,
          2,
          ...keys,
          String(event.eventAtMs),
          String(event.eventSequence),
          payload,
          event.agentId,
          String(this.ttlMs)
        )
      );

      if (reply.startsWith('R:')) {
        this.applied++;
        return { outcome: SipWriteOutcome.APPLIED, revision: Number(reply.slice(2)) };
      }

      this.staleRejected++;
      return {
        outcome: SipWriteOutcome.STALE_EVENT,
        current: parseRecord(reply) ?? undefined,
      };
    } catch (error) {
      this.options.onFailure?.('sip.apply', error as Error);
      return { outcome: SipWriteOutcome.UNAVAILABLE };
    }
  }

  async get(tenantId: string, agentId: string): Promise<SipRegistrationRecord | null> {
    if (!isValidTenantId(tenantId) || !agentId) return null;
    try {
      const raw = await this.options.redis.get(sipRegistrationKey(tenantId, agentId));
      return raw ? parseRecord(raw) : null;
    } catch (error) {
      this.options.onFailure?.('sip.get', error as Error);
      return null;
    }
  }

  /**
   * Is this agent's endpoint registered right now?
   *
   * Absence of evidence is treated as not-registered, because the cost of the
   * two errors is asymmetric: an agent wrongly excluded is idle, an agent
   * wrongly included receives a call nobody answers.
   */
  async isRegistered(tenantId: string, agentId: string): Promise<boolean> {
    const record = await this.get(tenantId, agentId);
    return record !== null && this.recordIsLive(record);
  }

  recordIsLive(record: SipRegistrationRecord): boolean {
    if (record.lifecycle !== SipLifecycle.REGISTERED) return false;
    const nowMs = this.now();
    if (record.expiresAtMs !== null && nowMs >= record.expiresAtMs) return false;
    // Missed-event guard: no refresh in a long time means gone. FreeSWITCH does
    // emit sofia::expire, but a missed event must not leave an agent
    // permanently registered.
    if (nowMs - record.eventAtMs > this.staleAfterMs) return false;
    return true;
  }

  /**
   * Every registration for a tenant, for reconstruction after a restart.
   *
   * Uses the dedicated SIP index rather than a `KEYS` scan: `KEYS` is O(n) over
   * the whole keyspace and blocks the server, which is not something a startup
   * path shared by every replica should do.
   */
  async loadAll(tenantId: string): Promise<SipRegistrationRecord[]> {
    if (!isValidTenantId(tenantId)) return [];
    try {
      const agentIds = await this.options.redis.smembers(sipIndexKey(tenantId));
      if (agentIds.length === 0) return [];

      const raw = await this.options.redis.mget(
        ...agentIds.map(id => sipRegistrationKey(tenantId, id))
      );

      const out: SipRegistrationRecord[] = [];
      for (const entry of raw) {
        if (!entry) continue;
        const parsed = parseRecord(entry);
        // A tenant mismatch is corruption or a key-layout bug; either way it
        // must not leak an endpoint into another tenant's capacity.
        if (parsed && parsed.tenantId === tenantId) out.push(parsed);
      }
      return out;
    } catch (error) {
      this.options.onFailure?.('sip.loadAll', error as Error);
      return [];
    }
  }
}

/** Numeric fields come back as strings; a corrupt entry is skipped, never thrown. */
function parseRecord(raw: string): SipRegistrationRecord | null {
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    const num = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');

    const lifecycle = str(d.lifecycle) as SipLifecycle;
    if (!Object.values(SipLifecycle).includes(lifecycle)) return null;

    const expires = str(d.expiresAtMs);

    return {
      tenantId: str(d.tenantId),
      agentId: str(d.agentId),
      extension: str(d.extension),
      lifecycle,
      eventAtMs: num(d.eventAtMs),
      eventSequence: num(d.eventSequence),
      receivedAtMs: num(d.receivedAtMs),
      expiresAtMs: expires === '' ? null : num(expires),
      contact: str(d.contact) || null,
      networkIp: str(d.networkIp) || null,
      revision: num(d.revision),
    };
  } catch {
    return null;
  }
}
