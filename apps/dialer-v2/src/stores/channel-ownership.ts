/**
 * Dialer V2 — tenant-scoped channel ownership.
 *
 * ── The bug ──────────────────────────────────────────────────────────────────
 *
 * Ownership was a `Map<channelUuid, agentId>`, and the runtime's lookup was:
 *
 *     private channelOwnedBy(tenantId: string, agentId: string) {
 *       for (const [uuid, owner] of this.collector.channelOwners()) {
 *         if (owner === agentId && live.has(uuid)) return uuid;
 *       }
 *       void tenantId;                       // <- the tenant was discarded
 *       return null;
 *     }
 *
 * Agent ids are unique within a tenant, not across the platform. Two tenants
 * that number their agents `agent-1`, `agent-2` — which is exactly what a
 * seeded, imported, or per-tenant-sequential id scheme produces — collide on
 * every lookup. Tenant A's live call then marks tenant B's `agent-1` as ON_CALL
 * and removes them from B's dialable capacity, and reconciliation "corrects" a
 * perfectly healthy agent every pass.
 *
 * Ownership is therefore a record carrying the tenant, and every lookup requires
 * it. A channel whose tenant cannot be established is quarantined rather than
 * attributed to whoever asks first.
 *
 * ── Why it is also in Redis ──────────────────────────────────────────────────
 *
 * Ownership derives from observed telephony events, which a replica only sees
 * while its ESL connection is up. After a restart the collector is empty, so
 * every agent genuinely on a call looks like an agent with no channel, and
 * reconciliation moves them all to WRAP_UP. Persisting ownership means a
 * restarting replica can distinguish "no channel" from "I have not seen the
 * channel yet".
 */

import { channelIndexKey, channelOwnerKey, isValidTenantId } from '../config/redis-keys.js';

/**
 * Who owns a channel.
 *
 * `callId` is the application-level call, `channelUuid` the FreeSWITCH leg. Both
 * are carried because they answer different questions: the channel is what
 * reconciliation checks for liveness, the call is what an operator searches for.
 */
export interface ChannelOwnership {
  tenantId: string;
  agentId: string;
  channelUuid: string;
  callId: string | null;
  observedAtMs: number;
}

export interface ChannelRedis {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  mget(...keys: string[]): Promise<Array<string | null>>;
}

/**
 * KEYS[1] = channel owner key, KEYS[2] = tenant channel index
 * ARGV[1] = payload, ARGV[2] = channelUuid, ARGV[3] = TTL ms
 *
 * A plain overwrite: the latest observation of a channel's owner is the correct
 * one, and unlike agent state there is no competing writer with an older view —
 * ownership only ever changes when FreeSWITCH bridges a different agent, and
 * that is itself a later event.
 */
export const CLAIM_CHANNEL = [
  'redis.call("set", KEYS[1], ARGV[1], "PX", tonumber(ARGV[3]))',
  'redis.call("sadd", KEYS[2], ARGV[2])',
  'redis.call("pexpire", KEYS[2], tonumber(ARGV[3]))',
  'return 1',
].join('\n');

export const RELEASE_CHANNEL = [
  'redis.call("del", KEYS[1])',
  'redis.call("srem", KEYS[2], ARGV[1])',
  'return 1',
].join('\n');

export interface ChannelOwnershipStoreOptions {
  redis: ChannelRedis;
  /**
   * How long an unrefreshed channel record survives.
   *
   * Sized to outlive a long call but not an abandoned record: a leaked entry
   * makes an idle agent look permanently busy, which silently removes them from
   * capacity with no error anywhere.
   */
  ttlMs?: number;
  now?: () => number;
  onFailure?: (operation: string, error: Error) => void;
}

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;

export class RedisChannelOwnershipStore {
  /** Satisfies `ChannelOwnershipRepository`; reported through health. */
  readonly backend = 'redis' as const;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private quarantined = 0;

  constructor(private readonly options: ChannelOwnershipStoreOptions) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  metrics(): { quarantinedChannels: number } {
    return { quarantinedChannels: this.quarantined };
  }

  /**
   * Record that an agent owns a channel.
   *
   * A channel with no usable tenant is counted and dropped. Attributing it to a
   * default tenant is how a cross-tenant capacity bug starts.
   */
  async claim(
    tenantId: string,
    agentId: string,
    channelUuid: string,
    callId: string | null
  ): Promise<boolean> {
    if (!isValidTenantId(tenantId) || !agentId || !channelUuid) {
      this.quarantined++;
      return false;
    }

    let keys: string[];
    try {
      keys = [channelOwnerKey(tenantId, channelUuid), channelIndexKey(tenantId)];
    } catch {
      this.quarantined++;
      return false;
    }

    const record: ChannelOwnership = {
      tenantId,
      agentId,
      channelUuid,
      callId,
      observedAtMs: this.now(),
    };

    try {
      await this.options.redis.eval(
        CLAIM_CHANNEL,
        2,
        ...keys,
        // observedAtMs crosses as a string inside the payload for the same
        // reason as everywhere else: Lua 5.1 renders numbers with %.14g.
        JSON.stringify({ ...record, observedAtMs: String(record.observedAtMs) }),
        channelUuid,
        String(this.ttlMs)
      );
      return true;
    } catch (error) {
      this.options.onFailure?.('channel.claim', error as Error);
      return false;
    }
  }

  async release(tenantId: string, channelUuid: string): Promise<boolean> {
    if (!isValidTenantId(tenantId) || !channelUuid) return false;
    try {
      await this.options.redis.eval(
        RELEASE_CHANNEL,
        2,
        channelOwnerKey(tenantId, channelUuid),
        channelIndexKey(tenantId),
        channelUuid
      );
      return true;
    } catch (error) {
      this.options.onFailure?.('channel.release', error as Error);
      return false;
    }
  }

  /** Every channel attributed to this tenant. Never returns another tenant's. */
  async loadAll(tenantId: string): Promise<ChannelOwnership[]> {
    if (!isValidTenantId(tenantId)) return [];
    try {
      const uuids = await this.options.redis.smembers(channelIndexKey(tenantId));
      if (uuids.length === 0) return [];

      const raw = await this.options.redis.mget(...uuids.map(u => channelOwnerKey(tenantId, u)));

      const out: ChannelOwnership[] = [];
      for (const entry of raw) {
        if (!entry) continue;
        const parsed = parseOwnership(entry);
        // A tenant mismatch means corruption or a key-layout bug. Dropping it is
        // the only safe reading: the alternative is leaking a channel across the
        // boundary this class exists to enforce.
        if (parsed && parsed.tenantId === tenantId) out.push(parsed);
        else if (parsed) this.quarantined++;
      }
      return out;
    } catch (error) {
      this.options.onFailure?.('channel.loadAll', error as Error);
      return [];
    }
  }
}

function parseOwnership(raw: string): ChannelOwnership | null {
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    const tenantId = str(d.tenantId);
    const agentId = str(d.agentId);
    const channelUuid = str(d.channelUuid);
    if (!tenantId || !agentId || !channelUuid) return null;

    const observed = Number(d.observedAtMs);
    return {
      tenantId,
      agentId,
      channelUuid,
      callId: str(d.callId) || null,
      observedAtMs: Number.isFinite(observed) ? observed : 0,
    };
  } catch {
    return null;
  }
}
