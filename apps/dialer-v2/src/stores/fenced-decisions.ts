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
 * So every decision write includes its fencing token, and Redis decides:
 *
 *   accept  ⟺  token >= last accepted token for this campaign
 *         AND  no decision already exists for this interval bucket
 *
 * Both conditions are evaluated inside one Lua script, so the check and the
 * write cannot be interleaved.
 */

import { shadowDecisionKey, isValidTenantId } from '../config/redis-keys.js';
import type { ShadowDecisionRecord, ShadowDecisionStore } from '../shadow/engine.js';

/**
 * KEYS[1] = fence key   (highest accepted fencing token for this campaign)
 * KEYS[2] = bucket key  (idempotency marker for this interval)
 * KEYS[3] = list key    (the decision history)
 *
 * ARGV[1] = fencing token
 * ARGV[2] = serialized decision
 * ARGV[3] = max history length
 * ARGV[4] = history TTL ms
 * ARGV[5] = bucket TTL ms
 *
 * Returns 1 accepted, 0 stale token, -1 duplicate bucket.
 */
export const ACCEPT_FENCED_DECISION = [
  "local last = redis.call('get', KEYS[1])",
  'if last and tonumber(last) > tonumber(ARGV[1]) then',
  '  return 0',
  'end',
  "if redis.call('exists', KEYS[2]) == 1 then",
  '  return -1',
  'end',
  "redis.call('set', KEYS[1], ARGV[1])",
  "redis.call('set', KEYS[2], ARGV[1], 'PX', tonumber(ARGV[5]))",
  "redis.call('lpush', KEYS[3], ARGV[2])",
  "redis.call('ltrim', KEYS[3], 0, tonumber(ARGV[3]) - 1)",
  "redis.call('pexpire', KEYS[3], tonumber(ARGV[4]))",
  'return 1',
].join('\n');

export interface FencedRedis {
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
}

export enum DecisionRejection {
  STALE_FENCING_TOKEN = 'STALE_FENCING_TOKEN',
  DUPLICATE_INTERVAL = 'DUPLICATE_INTERVAL',
  INVALID_TENANT = 'INVALID_TENANT',
  STORE_UNAVAILABLE = 'STORE_UNAVAILABLE',
}

export interface DecisionWriteResult {
  accepted: boolean;
  rejection?: DecisionRejection;
}

/**
 * Identity of a decision slot: one decision may exist per campaign per
 * controller version per interval bucket. Including the controller version means
 * a deliberate controller upgrade is not mistaken for a duplicate.
 */
export function decisionBucketKey(
  tenantId: string,
  campaignId: string,
  controllerVersion: string,
  decidedAtMs: number,
  intervalMs: number
): string {
  const bucket = Math.floor(decidedAtMs / Math.max(1, intervalMs));
  return `${shadowDecisionKey(tenantId, campaignId)}:bucket:${controllerVersion}:${bucket}`;
}

export interface FencedDecisionStoreOptions {
  redis: FencedRedis;
  intervalMs: number;
  maxPerCampaign?: number;
  historyTtlMs?: number;
  onRejection?: (rejection: DecisionRejection, record: ShadowDecisionRecord) => void;
  onFailure?: (operation: string, error: Error) => void;
}

/**
 * A shadow decision store that requires a fencing token on every write.
 *
 * Implements `ShadowDecisionStore` so it drops into the existing runtime, but
 * `record()` alone is not enough to write: a decision with no token is treated
 * as unauthenticated and rejected. `recordFenced()` is the real entry point.
 */
export class FencedShadowDecisionStore implements ShadowDecisionStore {
  private readonly maxPerCampaign: number;
  private readonly historyTtlMs: number;
  private staleTokenRejections = 0;
  private duplicateIntervalRejections = 0;

  constructor(private readonly options: FencedDecisionStoreOptions) {
    this.maxPerCampaign = options.maxPerCampaign ?? 200;
    this.historyTtlMs = options.historyTtlMs ?? 6 * 60 * 60 * 1000;
  }

  metrics(): { staleTokenRejections: number; duplicateIntervalRejections: number } {
    return {
      staleTokenRejections: this.staleTokenRejections,
      duplicateIntervalRejections: this.duplicateIntervalRejections,
    };
  }

  async recordFenced(
    record: ShadowDecisionRecord,
    fencingToken: number
  ): Promise<DecisionWriteResult> {
    if (!isValidTenantId(record.tenantId)) {
      return { accepted: false, rejection: DecisionRejection.INVALID_TENANT };
    }

    const listKey = shadowDecisionKey(record.tenantId, record.campaignId);
    const fenceKey = `${listKey}:fence`;
    const bucketKey = decisionBucketKey(
      record.tenantId,
      record.campaignId,
      record.controllerVersion,
      record.decidedAtMs,
      this.options.intervalMs
    );

    try {
      const result = await this.options.redis.eval(
        ACCEPT_FENCED_DECISION,
        3,
        fenceKey,
        bucketKey,
        listKey,
        String(fencingToken),
        JSON.stringify(record),
        String(this.maxPerCampaign),
        String(this.historyTtlMs),
        // The bucket marker only needs to outlive its own interval.
        String(Math.max(this.options.intervalMs * 4, 5_000))
      );

      const code = Number(result);
      if (code === 1) return { accepted: true };

      const rejection =
        code === 0 ? DecisionRejection.STALE_FENCING_TOKEN : DecisionRejection.DUPLICATE_INTERVAL;
      if (rejection === DecisionRejection.STALE_FENCING_TOKEN) this.staleTokenRejections++;
      else this.duplicateIntervalRejections++;

      this.options.onRejection?.(rejection, record);
      return { accepted: false, rejection };
    } catch (error) {
      this.options.onFailure?.('decision.recordFenced', error as Error);
      // Fail closed. A decision that cannot be written under a verified token is
      // not written at all — recording it unfenced would defeat the mechanism.
      return { accepted: false, rejection: DecisionRejection.STORE_UNAVAILABLE };
    }
  }

  /**
   * `ShadowDecisionStore` compatibility. Deliberately refuses.
   *
   * An unfenced write cannot prove it is not stale, so accepting one here would
   * quietly reintroduce the race this class exists to close.
   */
  record(decision: ShadowDecisionRecord): Promise<void> {
    this.options.onRejection?.(DecisionRejection.STALE_FENCING_TOKEN, decision);
    return Promise.reject(
      new Error('FencedShadowDecisionStore requires recordFenced() with a fencing token')
    );
  }

  async recent(
    tenantId: string,
    limit: number,
    campaignId?: string
  ): Promise<ShadowDecisionRecord[]> {
    if (!isValidTenantId(tenantId) || !campaignId) return [];
    try {
      const raw = await this.options.redis.lrange(
        shadowDecisionKey(tenantId, campaignId),
        0,
        Math.max(0, limit - 1)
      );
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
    } catch (error) {
      this.options.onFailure?.('decision.recent', error as Error);
      return [];
    }
  }
}
