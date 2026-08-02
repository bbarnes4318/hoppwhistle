/**
 * Dialer V2 — fenced, idempotent shadow decision writes.
 *
 * ── The race a renewing lock does not close ──────────────────────────────────
 *
 * Renewing before each campaign is necessary but not sufficient:
 *
 *   1. Replica A renews. It genuinely holds the lock at that instant.
 *   2. A pauses — GC, scheduler, a slow database call inside evaluate().
 *   3. A's lock expires.
 *   4. Replica B acquires with a HIGHER fencing token and writes a decision.
 *   5. A resumes and writes its own, now-stale, decision.
 *
 * Nothing in the lock protocol can prevent step 5, because by then A is no
 * longer talking to the lock — it is talking to the decision store. The write
 * itself has to carry proof of authority and be rejected if that proof is stale.
 *
 * ── Why comparing tokens is not enough ───────────────────────────────────────
 *
 * The first version of this accepted a write when
 *
 *     presented token >= last ACCEPTED decision token
 *
 * which is strictly weaker than it looks. Consider:
 *
 *   1. A acquires with token 7 and pauses.
 *   2. A's lock expires. B acquires with token 8 — and then crashes, or is
 *      simply slow, and never writes.
 *   3. A resumes. The last accepted token is still 6, so 7 >= 6 and A's write is
 *      accepted — despite A demonstrably not holding the lock any more.
 *
 * Nothing was ever written under token 8, so nothing recorded that A had been
 * superseded. A rule phrased in terms of what has been WRITTEN cannot see an
 * ownership change that produced no write.
 *
 * So the write proves current authority instead of relative recency. Redis
 * checks, in one script:
 *
 *     the lock key still holds THIS owner and THIS token
 *   AND the token presented is the latest one the fence counter issued
 *   AND no decision exists for this interval bucket
 *
 * The first condition is the one that closes the gap above: an expired lock
 * holds nothing, and a re-acquired lock holds someone else's value.
 */

import {
  campaignDecisionBucketKey,
  campaignShadowFenceKey,
  campaignShadowLockKey,
  isValidTenantId,
  shadowDecisionIndexKey,
  shadowDecisionKey,
} from '../config/redis-keys.js';
import type { ShadowDecisionRecord, ShadowDecisionStore } from '../shadow/engine.js';

/**
 * KEYS[1] = campaign lock key      KEYS[4] = decision history list
 * KEYS[2] = campaign fence counter KEYS[5] = tenant campaign index
 * KEYS[3] = decision bucket key
 *
 * ARGV[1] = expected lock value ("ownerId:token")
 * ARGV[2] = presented fencing token
 * ARGV[3] = serialized decision
 * ARGV[4] = max history length      ARGV[7] = campaignId
 * ARGV[5] = history TTL ms          ARGV[8] = decidedAtMs
 * ARGV[6] = bucket TTL ms           ARGV[9] = index TTL ms
 *
 * Returns 1 accepted, 0 lock not held by this owner and token, -1 duplicate
 * bucket, -2 token superseded by a newer issue.
 *
 * `redis.call('get', k)` yields Lua `false` — not `nil` — for a missing key, so
 * an expired lock falls into the `not held` branch rather than comparing equal
 * to anything.
 */
export const ACCEPT_FENCED_DECISION = [
  "local held = redis.call('get', KEYS[1])",
  'if not held or held ~= ARGV[1] then return 0 end',
  '',
  "local fence = redis.call('get', KEYS[2])",
  'if not fence or fence ~= ARGV[2] then return -2 end',
  '',
  "if redis.call('exists', KEYS[3]) == 1 then return -1 end",
  '',
  "redis.call('set', KEYS[3], ARGV[2], 'PX', tonumber(ARGV[6]))",
  "redis.call('lpush', KEYS[4], ARGV[3])",
  "redis.call('ltrim', KEYS[4], 0, tonumber(ARGV[4]) - 1)",
  "redis.call('pexpire', KEYS[4], tonumber(ARGV[5]))",
  // The tenant index is what makes an unfiltered "recent decisions" query
  // answerable without a keyspace scan.
  "redis.call('zadd', KEYS[5], tonumber(ARGV[8]), ARGV[7])",
  "redis.call('pexpire', KEYS[5], tonumber(ARGV[9]))",
  'return 1',
].join('\n');

export interface FencedRedis {
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
}

export enum DecisionRejection {
  /** The lock is gone, expired, or now held by someone else. */
  LOCK_NOT_HELD = 'LOCK_NOT_HELD',
  /** A newer token has since been issued for this campaign. */
  STALE_FENCING_TOKEN = 'STALE_FENCING_TOKEN',
  DUPLICATE_INTERVAL = 'DUPLICATE_INTERVAL',
  INVALID_TENANT = 'INVALID_TENANT',
  STORE_UNAVAILABLE = 'STORE_UNAVAILABLE',
  /** A write arrived with no proof of authority at all. */
  UNFENCED_WRITE = 'UNFENCED_WRITE',
}

export interface DecisionWriteResult {
  accepted: boolean;
  rejection?: DecisionRejection;
}

/** Proof that the caller still holds this campaign's lock. */
export interface DecisionAuthority {
  fencingToken: number;
  /** The exact value the lock key must still hold. */
  lockValue: string;
}

/** Re-exported under its original name; the builder now lives with the keys. */
export const decisionBucketKey = campaignDecisionBucketKey;

export interface FencedDecisionStoreOptions {
  redis: FencedRedis;
  intervalMs: number;
  maxPerCampaign?: number;
  historyTtlMs?: number;
  /**
   * How many campaigns an unfiltered tenant query will fan out across. A cap is
   * necessary — a tenant with thousands of campaigns would otherwise issue
   * thousands of LRANGEs for one supervisor page load — but it is reported
   * rather than applied silently.
   */
  maxCampaignsPerTenantQuery?: number;
  onRejection?: (rejection: DecisionRejection, record: ShadowDecisionRecord) => void;
  onFailure?: (operation: string, error: Error) => void;
  onTruncated?: (tenantId: string, examined: number, total: number) => void;
}

/**
 * A shadow decision store that requires proof of current lock ownership on
 * every write.
 *
 * Implements `ShadowDecisionStore` so it drops into the existing runtime, but
 * `record()` alone cannot write: a decision with no authority is treated as
 * unauthenticated and rejected.
 */
export class FencedShadowDecisionStore implements ShadowDecisionStore {
  private readonly maxPerCampaign: number;
  private readonly historyTtlMs: number;
  private readonly maxCampaigns: number;
  private lockNotHeldRejections = 0;
  private staleTokenRejections = 0;
  private duplicateIntervalRejections = 0;
  private unfencedRejections = 0;

  constructor(private readonly options: FencedDecisionStoreOptions) {
    this.maxPerCampaign = options.maxPerCampaign ?? 200;
    this.historyTtlMs = options.historyTtlMs ?? 6 * 60 * 60 * 1000;
    this.maxCampaigns = options.maxCampaignsPerTenantQuery ?? 50;
  }

  /** Marker the engine uses to refuse a fenced write to an unfenced store. */
  readonly fenced = true;

  metrics(): {
    lockNotHeldRejections: number;
    staleTokenRejections: number;
    duplicateIntervalRejections: number;
    unfencedRejections: number;
  } {
    return {
      lockNotHeldRejections: this.lockNotHeldRejections,
      staleTokenRejections: this.staleTokenRejections,
      duplicateIntervalRejections: this.duplicateIntervalRejections,
      unfencedRejections: this.unfencedRejections,
    };
  }

  async recordFenced(
    record: ShadowDecisionRecord,
    authority: DecisionAuthority
  ): Promise<DecisionWriteResult> {
    if (!isValidTenantId(record.tenantId)) {
      return { accepted: false, rejection: DecisionRejection.INVALID_TENANT };
    }

    let keys: string[];
    try {
      keys = [
        // Built here rather than passed in, so the lock this write is checked
        // against is provably the same lock the runtime took for this campaign.
        campaignShadowLockKey(record.tenantId, record.campaignId),
        campaignShadowFenceKey(record.tenantId, record.campaignId),
        campaignDecisionBucketKey(
          record.tenantId,
          record.campaignId,
          record.controllerVersion,
          record.decidedAtMs,
          this.options.intervalMs
        ),
        shadowDecisionKey(record.tenantId, record.campaignId),
        shadowDecisionIndexKey(record.tenantId),
      ];
    } catch {
      return { accepted: false, rejection: DecisionRejection.INVALID_TENANT };
    }

    try {
      const result = await this.options.redis.eval(
        ACCEPT_FENCED_DECISION,
        5,
        ...keys,
        authority.lockValue,
        String(authority.fencingToken),
        JSON.stringify(record),
        String(this.maxPerCampaign),
        String(this.historyTtlMs),
        // The bucket marker only needs to outlive its own interval.
        String(Math.max(this.options.intervalMs * 4, 5_000)),
        record.campaignId,
        String(record.decidedAtMs),
        String(this.historyTtlMs)
      );

      const code = Number(result);
      if (code === 1) return { accepted: true };

      const rejection = this.classify(code);
      this.options.onRejection?.(rejection, record);
      return { accepted: false, rejection };
    } catch (error) {
      this.options.onFailure?.('decision.recordFenced', error as Error);
      // Fail closed. A decision that cannot be written under verified authority
      // is not written at all — recording it unfenced defeats the mechanism.
      return { accepted: false, rejection: DecisionRejection.STORE_UNAVAILABLE };
    }
  }

  private classify(code: number): DecisionRejection {
    if (code === 0) {
      this.lockNotHeldRejections++;
      return DecisionRejection.LOCK_NOT_HELD;
    }
    if (code === -2) {
      this.staleTokenRejections++;
      return DecisionRejection.STALE_FENCING_TOKEN;
    }
    this.duplicateIntervalRejections++;
    return DecisionRejection.DUPLICATE_INTERVAL;
  }

  /**
   * `ShadowDecisionStore` compatibility. Deliberately refuses.
   *
   * An unfenced write cannot prove it is not stale, so accepting one here would
   * quietly reintroduce the race this class exists to close.
   */
  record(decision: ShadowDecisionRecord): Promise<void> {
    this.unfencedRejections++;
    this.options.onRejection?.(DecisionRejection.UNFENCED_WRITE, decision);
    return Promise.reject(
      new Error('FencedShadowDecisionStore requires recordFenced() with proof of lock ownership')
    );
  }

  /**
   * Recent decisions.
   *
   * With a campaign, one list read. Without one, the tenant index names every
   * campaign that has recorded a decision and each is read and merged — the
   * store used to return an empty list here, which is indistinguishable from
   * "this tenant has never recorded a decision".
   */
  async recent(
    tenantId: string,
    limit: number,
    campaignId?: string
  ): Promise<ShadowDecisionRecord[]> {
    if (!isValidTenantId(tenantId)) return [];

    try {
      if (campaignId) return await this.readCampaign(tenantId, campaignId, limit);

      const campaigns = await this.options.redis.zrevrange(shadowDecisionIndexKey(tenantId), 0, -1);
      const examined = campaigns.slice(0, this.maxCampaigns);
      if (campaigns.length > examined.length) {
        this.options.onTruncated?.(tenantId, examined.length, campaigns.length);
      }

      const merged: ShadowDecisionRecord[] = [];
      for (const id of examined) {
        merged.push(...(await this.readCampaign(tenantId, id, limit)));
      }
      merged.sort((a, b) => b.decidedAtMs - a.decidedAtMs);
      return merged.slice(0, limit);
    } catch (error) {
      this.options.onFailure?.('decision.recent', error as Error);
      return [];
    }
  }

  private async readCampaign(
    tenantId: string,
    campaignId: string,
    limit: number
  ): Promise<ShadowDecisionRecord[]> {
    let key: string;
    try {
      key = shadowDecisionKey(tenantId, campaignId);
    } catch {
      // A campaign id that cannot form a key cannot have produced a decision.
      return [];
    }

    const raw = await this.options.redis.lrange(key, 0, Math.max(0, limit - 1));
    const out: ShadowDecisionRecord[] = [];
    for (const entry of raw) {
      try {
        const parsed = JSON.parse(entry) as ShadowDecisionRecord;
        if (parsed.tenantId === tenantId && parsed.originated === false) out.push(parsed);
      } catch {
        // A corrupt entry is skipped, not fatal.
      }
    }
    return out;
  }
}
