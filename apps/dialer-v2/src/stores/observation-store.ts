/**
 * Dialer V2 — durable campaign observations over a real rolling window.
 *
 * ── Why observations must survive a restart ──────────────────────────────────
 *
 * The pacing controller estimates live-answer probability from a Beta-Binomial
 * posterior over (liveAnswers, attempts). Those counts used to live in the
 * observation collector's memory. A restart reset them to zero, and a
 * zero-sample posterior collapses to the prior — which the controller treats as
 * a small sample and, correctly, dials cautiously. Every deploy therefore threw
 * away the campaign's learned answer rate and started the ramp again.
 *
 * Worse, the counts were per-replica. Two replicas each observe roughly half the
 * calls, so each estimated from half the sample and neither ever reached
 * `minSampleSize`. The controller then stayed in its degraded mode indefinitely
 * while believing it lacked data it actually had.
 *
 * ── Why fixed buckets, not a sliding TTL ─────────────────────────────────────
 *
 * The previous version was one hash with `PEXPIRE` refreshed on every write.
 * Under continuous traffic that key never expires: each event pushes the expiry
 * an hour further out, so the counters run from the campaign's first event to
 * its last. It looked like a one-hour window and behaved like a lifetime total.
 * A campaign that answered well at 9am carried that evidence into 9pm, when the
 * people it is calling are demonstrably different.
 *
 * So the window is twelve five-minute buckets. A bucket is only ever written
 * while its own interval is current; nothing extends it afterwards, and it
 * expires on schedule under load exactly as it does when idle. A read sums the
 * buckets that still exist, which is the definition of a trailing window.
 *
 * ── Why the bucket comes from the EVENT time ─────────────────────────────────
 *
 * Bucket selection uses the source event's timestamp, not the moment this
 * process received it. Under ESL reconnect or ingestion lag a batch of events
 * can arrive minutes after they happened; filing them under receipt time would
 * pile a reconnect's backlog into one bucket and make the window claim a burst
 * of activity that never occurred. An event too old for any live bucket is
 * counted as rejected rather than folded into the nearest one.
 */

import { isValidTenantId, observationBucketKey } from '../config/redis-keys.js';

export interface ObservationRedis {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/**
 * KEYS[1]      = the bucket being written
 * KEYS[2..n+1] = every bucket in the window, newest first
 *
 * ARGV[1] = bucket TTL ms
 * ARGV[2] = number of field/delta arguments that follow
 * ARGV[3..] = field, delta pairs
 *
 * `hincrby` per field, so two replicas incrementing concurrently both count. A
 * read-modify-write would lose one of them.
 *
 * The window total is summed and returned in the same script, so the caller
 * never acts on a value another replica has already moved between its write and
 * its read.
 */
export const INCREMENT_AND_READ_WINDOW = [
  'local pairsN = tonumber(ARGV[2])',
  'if pairsN > 0 then',
  '  for i = 3, 2 + pairsN, 2 do',
  '    redis.call("hincrby", KEYS[1], ARGV[i], tonumber(ARGV[i + 1]))',
  '  end',
  '  redis.call("pexpire", KEYS[1], tonumber(ARGV[1]))',
  'end',
  '',
  'local total = {}',
  'for i = 2, #KEYS do',
  '  local h = redis.call("hgetall", KEYS[i])',
  '  for j = 1, #h, 2 do',
  '    total[h[j]] = (total[h[j]] or 0) + tonumber(h[j + 1])',
  '  end',
  'end',
  '',
  'local flat = {}',
  'for k, v in pairs(total) do',
  '  table.insert(flat, k)',
  // %.0f rather than tostring(): Lua 5.1 formats numbers with %.14g, so a
  // latency sum past fourteen significant digits would come back as "1.2e+14"
  // and parse to something the controller cannot use.
  '  table.insert(flat, string.format("%.0f", v))',
  'end',
  'return flat',
].join('\n');

/**
 * Counters the pacing controller consumes.
 *
 * Latency and duration are carried as sum plus count rather than as an average.
 * Averages cannot be added: summing two buckets' means weights a bucket with
 * three calls the same as one with three thousand. Sums can, so the window mean
 * is computed at read time from totals that are genuinely additive.
 */
export interface ObservationCounters {
  attempts: number;
  liveAnswers: number;
  abandons: number;
  machineAnswers: number;
  busy: number;
  noAnswer: number;
  failed: number;

  answerLatencySumMs: number;
  answerLatencyCount: number;
  bridgeLatencySumMs: number;
  bridgeLatencyCount: number;
  callDurationSumMs: number;
  callDurationCount: number;
}

export const EMPTY_COUNTERS: Readonly<ObservationCounters> = Object.freeze({
  attempts: 0,
  liveAnswers: 0,
  abandons: 0,
  machineAnswers: 0,
  busy: 0,
  noAnswer: 0,
  failed: 0,
  answerLatencySumMs: 0,
  answerLatencyCount: 0,
  bridgeLatencySumMs: 0,
  bridgeLatencyCount: 0,
  callDurationSumMs: 0,
  callDurationCount: 0,
});

const COUNTER_FIELDS = Object.keys(EMPTY_COUNTERS) as Array<keyof ObservationCounters>;

/** A window read, with the derived means the controller actually reads. */
export interface ObservationSnapshot extends ObservationCounters {
  /** Inclusive bucket range the totals came from. */
  windowStartMs: number;
  windowEndMs: number;
  meanAnswerLatencyMs: number;
  meanBridgeLatencyMs: number;
  meanCallDurationMs: number;
}

export enum ObservationReject {
  /** Older than the oldest live bucket: the window has already forgotten it. */
  OUTSIDE_WINDOW = 'OUTSIDE_WINDOW',
  /** Timestamped further ahead than clock skew can explain. */
  FUTURE_EVENT = 'FUTURE_EVENT',
  INVALID_SCOPE = 'INVALID_SCOPE',
  UNAVAILABLE = 'UNAVAILABLE',
}

export interface ObservationStoreOptions {
  redis: ObservationRedis;
  /** Width of one bucket. Default 5 minutes. */
  bucketMs?: number;
  /** How many buckets make up the window. Default 12 ⇒ a trailing hour. */
  bucketCount?: number;
  /** How far ahead of now an event may be timestamped. Default one bucket. */
  maxSkewMs?: number;
  now?: () => number;
  onFailure?: (operation: string, error: Error) => void;
  onReject?: (reason: ObservationReject, tenantId: string, campaignId: string) => void;
}

const DEFAULT_BUCKET_MS = 5 * 60 * 1000;
const DEFAULT_BUCKET_COUNT = 12;

export class RedisObservationStore {
  /** Satisfies `CampaignObservationRepository`; reported through health. */
  readonly backend = 'redis' as const;
  private readonly bucketMs: number;
  private readonly bucketCount: number;
  private readonly maxSkewMs: number;
  private readonly now: () => number;

  private rejectedOutsideWindow = 0;
  private rejectedFuture = 0;

  constructor(private readonly options: ObservationStoreOptions) {
    this.bucketMs = Math.max(1_000, options.bucketMs ?? DEFAULT_BUCKET_MS);
    this.bucketCount = Math.max(1, options.bucketCount ?? DEFAULT_BUCKET_COUNT);
    this.maxSkewMs = options.maxSkewMs ?? this.bucketMs;
    this.now = options.now ?? (() => Date.now());
  }

  /** Total span the window covers. */
  windowMs(): number {
    return this.bucketMs * this.bucketCount;
  }

  metrics(): { rejectedOutsideWindow: number; rejectedFuture: number } {
    return {
      rejectedOutsideWindow: this.rejectedOutsideWindow,
      rejectedFuture: this.rejectedFuture,
    };
  }

  private bucketIndex(atMs: number): number {
    return Math.floor(atMs / this.bucketMs);
  }

  /** Bucket keys for the window ending at `nowMs`, newest first. */
  private windowKeys(tenantId: string, campaignId: string, nowMs: number): string[] {
    const current = this.bucketIndex(nowMs);
    const keys: string[] = [];
    for (let i = 0; i < this.bucketCount; i++) {
      keys.push(observationBucketKey(tenantId, campaignId, current - i));
    }
    return keys;
  }

  /**
   * Apply deltas for an event that occurred at `eventAtMs`, and return the
   * resulting window totals.
   *
   * A late event lands in the bucket its own timestamp belongs to, so a batch
   * delivered after an ESL reconnect is distributed across the minutes it
   * actually spans instead of spiking whichever bucket happened to be current.
   */
  applyEvent(
    tenantId: string,
    campaignId: string,
    eventAtMs: number,
    deltas: Partial<ObservationCounters>
  ): Promise<ObservationSnapshot | null> {
    return this.apply(tenantId, campaignId, eventAtMs, deltas);
  }

  async apply(
    tenantId: string,
    campaignId: string,
    eventAtMs: number,
    deltas: Partial<ObservationCounters>
  ): Promise<ObservationSnapshot | null> {
    if (!isValidTenantId(tenantId) || !campaignId || !Number.isFinite(eventAtMs)) {
      this.options.onReject?.(ObservationReject.INVALID_SCOPE, tenantId, campaignId);
      return null;
    }

    const nowMs = this.now();
    const current = this.bucketIndex(nowMs);
    const target = this.bucketIndex(eventAtMs);

    if (eventAtMs - nowMs > this.maxSkewMs) {
      this.rejectedFuture++;
      this.options.onReject?.(ObservationReject.FUTURE_EVENT, tenantId, campaignId);
      return this.read(tenantId, campaignId);
    }
    if (target <= current - this.bucketCount) {
      // The bucket this event belongs to has already expired. Counting it
      // anywhere else would be a lie about when it happened, and re-creating its
      // bucket would resurrect a slice of history the window has moved past.
      this.rejectedOutsideWindow++;
      this.options.onReject?.(ObservationReject.OUTSIDE_WINDOW, tenantId, campaignId);
      return this.read(tenantId, campaignId);
    }

    const args: string[] = [];
    for (const field of COUNTER_FIELDS) {
      const delta = deltas[field];
      // Only non-zero deltas are sent; a zero would still create the field and
      // make an untouched counter look observed.
      if (typeof delta === 'number' && Number.isFinite(delta) && delta !== 0) {
        args.push(field, String(Math.trunc(delta)));
      }
    }

    let keys: string[];
    try {
      keys = [
        observationBucketKey(tenantId, campaignId, target),
        ...this.windowKeys(tenantId, campaignId, nowMs),
      ];
    } catch {
      this.options.onReject?.(ObservationReject.INVALID_SCOPE, tenantId, campaignId);
      return null;
    }

    try {
      const reply = await this.options.redis.eval(
        INCREMENT_AND_READ_WINDOW,
        keys.length,
        ...keys,
        // One extra bucket of grace so the oldest bucket is still readable while
        // it is still inside the window.
        String(this.windowMs() + this.bucketMs),
        String(args.length),
        ...args
      );
      return this.snapshot(reply, nowMs, current);
    } catch (error) {
      this.options.onFailure?.('observation.apply', error as Error);
      return null;
    }
  }

  /**
   * Read a campaign's trailing window.
   *
   * Returns null — not zeros — when Redis cannot be reached. Zeros are
   * indistinguishable from a genuinely idle campaign, and the controller treats
   * a zero sample as "no evidence, dial cautiously" rather than "unknown, do not
   * dial". The caller must decide, and it cannot decide if this lies.
   */
  async read(tenantId: string, campaignId: string): Promise<ObservationSnapshot | null> {
    if (!isValidTenantId(tenantId) || !campaignId) return null;

    const nowMs = this.now();
    let keys: string[];
    try {
      keys = this.windowKeys(tenantId, campaignId, nowMs);
    } catch {
      return null;
    }

    try {
      const reply = await this.options.redis.eval(
        INCREMENT_AND_READ_WINDOW,
        keys.length + 1,
        // KEYS[1] is the write target; with zero deltas it is never touched, so
        // pointing it at the current bucket is harmless and keeps one script.
        keys[0],
        ...keys,
        String(this.windowMs() + this.bucketMs),
        '0'
      );
      return this.snapshot(reply, nowMs, this.bucketIndex(nowMs));
    } catch (error) {
      this.options.onFailure?.('observation.read', error as Error);
      return null;
    }
  }

  private snapshot(reply: unknown, nowMs: number, currentBucket: number): ObservationSnapshot {
    const counters = countersFromFlat(reply);
    const oldest = (currentBucket - this.bucketCount + 1) * this.bucketMs;

    return {
      ...counters,
      windowStartMs: oldest,
      windowEndMs: nowMs,
      meanAnswerLatencyMs: ratio(counters.answerLatencySumMs, counters.answerLatencyCount),
      meanBridgeLatencyMs: ratio(counters.bridgeLatencySumMs, counters.bridgeLatencyCount),
      meanCallDurationMs: ratio(counters.callDurationSumMs, counters.callDurationCount),
    };
  }
}

function ratio(sum: number, count: number): number {
  return count > 0 ? sum / count : 0;
}

/** A Lua table reply is a flat [field, value, ...] array. */
function countersFromFlat(reply: unknown): ObservationCounters {
  const out = { ...EMPTY_COUNTERS };
  if (!Array.isArray(reply)) return out;

  const raw: Record<string, string> = {};
  for (let i = 0; i < reply.length - 1; i += 2) {
    raw[String(reply[i])] = String(reply[i + 1]);
  }

  for (const field of COUNTER_FIELDS) {
    const parsed = Number(raw[field]);
    // A missing or unparsable counter reads as zero, never as NaN: a NaN would
    // propagate into the posterior and produce a nonsense originate count.
    out[field] = Number.isFinite(parsed) ? parsed : 0;
  }
  return out;
}
