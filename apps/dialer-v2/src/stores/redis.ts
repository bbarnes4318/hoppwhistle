/**
 * Dialer V2 — Redis-backed ephemeral stores.
 *
 * The correctness property that matters here is **cross-instance idempotency**.
 * With the in-memory dedupe store, two Dialer V2 replicas each accept the same
 * telephony event, so every count is doubled and every state transition runs
 * twice. Redis `SET NX PX` is a single atomic operation, so exactly one replica
 * wins regardless of how the event was fanned out.
 *
 * The Redis client is an injected minimal interface rather than an `ioredis`
 * import. Two reasons: no new dependency for a service that must stay small, and
 * every branch — including failure — is testable against a fake without running
 * a Redis server.
 *
 * ── Degradation ──────────────────────────────────────────────────────────────
 *
 * On a Redis failure these stores FAIL CLOSED for deduplication: an event whose
 * uniqueness cannot be established is treated as a duplicate and dropped, rather
 * than processed and double-counted. Losing an event costs accuracy; processing
 * one twice corrupts abandonment maths, and abandonment is the number that
 * governs whether a campaign is allowed to keep dialing.
 */

import {
  eventDedupeKey,
  isValidTenantId,
  shadowDecisionKey,
  tenantHealthKey,
} from '../config/redis-keys.js';
import type { DedupeStore } from '../events/store.js';
import type { ShadowDecisionRecord, ShadowDecisionStore } from '../shadow/engine.js';

/** The subset of a Redis client these stores use. */
export interface MinimalRedis {
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttlMs: number,
    condition: 'NX'
  ): Promise<string | null>;
  lpush(key: string, value: string): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  pexpire(key: string, ttlMs: number): Promise<unknown>;
  set2?(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>;
}

export interface RedisStoreOptions {
  redis: MinimalRedis;
  /** Called when Redis fails, so health can degrade rather than fail silently. */
  onFailure?: (operation: string, error: Error) => void;
}

/**
 * Distributed event deduplication.
 *
 * `SET key 1 PX ttl NX` returns `'OK'` for the first caller and `null` for every
 * subsequent one. That is the whole mechanism — atomic, single round-trip, and
 * correct across any number of replicas.
 */
export class RedisDedupeStore implements DedupeStore {
  private healthy = true;

  constructor(private readonly options: RedisStoreOptions) {}

  isHealthy(): boolean {
    return this.healthy;
  }

  async markSeen(tenantId: string, eventId: string, ttlMs: number): Promise<boolean> {
    // An unusable tenant id must never be turned into a key. Treating it as a
    // duplicate drops the event, which the ingestor already quarantines.
    if (!isValidTenantId(tenantId) || !eventId) return false;

    let key: string;
    try {
      key = eventDedupeKey(tenantId, eventId);
    } catch {
      return false;
    }

    try {
      const result = await this.options.redis.set(key, '1', 'PX', ttlMs, 'NX');
      this.healthy = true;
      return result === 'OK';
    } catch (error) {
      this.healthy = false;
      this.options.onFailure?.('dedupe.markSeen', error as Error);
      // Fail closed: an event whose uniqueness cannot be established is dropped
      // rather than double-counted. See the module note.
      return false;
    }
  }
}

/**
 * Shadow decisions, capped per campaign with an explicit TTL.
 *
 * A capped list rather than an unbounded one: this writes roughly one record per
 * campaign per second, and an unbounded key would consume Redis indefinitely for
 * data whose value expires in minutes.
 */
export class RedisShadowDecisionStore implements ShadowDecisionStore {
  private healthy = true;

  constructor(
    private readonly options: RedisStoreOptions,
    private readonly maxPerCampaign = 200,
    private readonly ttlMs = 6 * 60 * 60 * 1000
  ) {}

  isHealthy(): boolean {
    return this.healthy;
  }

  async record(decision: ShadowDecisionRecord): Promise<void> {
    if (!isValidTenantId(decision.tenantId)) return;

    let key: string;
    try {
      key = shadowDecisionKey(decision.tenantId, decision.campaignId);
    } catch {
      return;
    }

    try {
      await this.options.redis.lpush(key, JSON.stringify(decision));
      await this.options.redis.ltrim(key, 0, this.maxPerCampaign - 1);
      await this.options.redis.pexpire(key, this.ttlMs);
      this.healthy = true;
    } catch (error) {
      this.healthy = false;
      this.options.onFailure?.('shadow.record', error as Error);
      // Losing a shadow record is an observability gap, never a safety one:
      // shadow mode cannot place a call whether or not the record persisted.
    }
  }

  async recent(
    tenantId: string,
    limit: number,
    campaignId?: string
  ): Promise<ShadowDecisionRecord[]> {
    if (!isValidTenantId(tenantId) || !campaignId) {
      // Without a campaign there is no key to read. Returning empty is honest;
      // scanning the keyspace to find campaigns would be both slow and a way to
      // accidentally read across tenants.
      return [];
    }

    try {
      const raw = await this.options.redis.lrange(
        shadowDecisionKey(tenantId, campaignId),
        0,
        Math.max(0, limit - 1)
      );
      this.healthy = true;

      const decisions: ShadowDecisionRecord[] = [];
      for (const entry of raw) {
        try {
          const parsed = JSON.parse(entry) as ShadowDecisionRecord;
          // Defence in depth: never surface a record belonging to another
          // tenant, or one claiming a call was placed.
          if (parsed.tenantId === tenantId && parsed.originated === false) {
            decisions.push(parsed);
          }
        } catch {
          // A corrupt entry is skipped, not fatal.
        }
      }
      return decisions;
    } catch (error) {
      this.healthy = false;
      this.options.onFailure?.('shadow.recent', error as Error);
      return [];
    }
  }
}

/** Cross-instance health heartbeat, so one replica can see the others. */
export class RedisHealthBeacon {
  constructor(
    private readonly options: RedisStoreOptions,
    private readonly ttlMs = 30_000
  ) {}

  async publish(tenantId: string, payload: Record<string, unknown>): Promise<boolean> {
    if (!isValidTenantId(tenantId)) return false;
    try {
      const key = tenantHealthKey(tenantId);
      await this.options.redis.lpush(key, JSON.stringify(payload));
      await this.options.redis.ltrim(key, 0, 9);
      await this.options.redis.pexpire(key, this.ttlMs);
      return true;
    } catch (error) {
      this.options.onFailure?.('health.publish', error as Error);
      return false;
    }
  }
}
