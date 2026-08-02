/**
 * Dialer V2 — durable campaign observations.
 *
 * ── Why observations must survive a restart ──────────────────────────────────
 *
 * The pacing controller estimates live-answer probability from a Beta-Binomial
 * posterior over (liveAnswers, attempts). Those counts live in the observation
 * collector's memory. A restart resets them to zero, and a zero-sample
 * posterior collapses to the prior — which the controller treats as a small
 * sample and, correctly, dials cautiously. Every deploy therefore threw away
 * the campaign's learned answer rate and started the ramp again.
 *
 * Worse, the counts are per-replica. Two replicas each observe roughly half the
 * calls, so each estimates from half the sample and neither ever reaches
 * `minSampleSize`. The controller then stays in its degraded mode indefinitely
 * while believing it lacks data it actually has.
 *
 * Counters here are shared and durable, so the estimate is over the campaign's
 * whole history rather than one process's slice of it.
 *
 * ── Why the window is explicit ───────────────────────────────────────────────
 *
 * An unbounded lifetime counter is the wrong statistic: a campaign's answer
 * rate at 9am is not evidence about 9pm, and a list that never forgets makes
 * the controller progressively less responsive. Counters are bucketed by an
 * explicit window and expire, so "recent" is a stated duration rather than an
 * accident of when the process last restarted.
 */

import { isValidTenantId, observationKey } from '../config/redis-keys.js';

export interface ObservationRedis {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
}

/**
 * KEYS[1] = the campaign observation hash
 *
 * ARGV[1] = TTL ms
 * ARGV[2..] = field, delta pairs
 *
 * `hincrby` per field, so two replicas incrementing concurrently both count.
 * A read-modify-write would lose one of them.
 */
export const INCREMENT_OBSERVATIONS = [
  'for i = 2, #ARGV, 2 do',
  '  redis.call("hincrby", KEYS[1], ARGV[i], tonumber(ARGV[i + 1]))',
  'end',
  'redis.call("pexpire", KEYS[1], tonumber(ARGV[1]))',
  'return redis.call("hgetall", KEYS[1])',
].join('\n');

/** The counters the pacing controller actually consumes. */
export interface ObservationCounters {
  attempts: number;
  liveAnswers: number;
  abandons: number;
  machineAnswers: number;
  busy: number;
  noAnswer: number;
  failed: number;
}

export const EMPTY_COUNTERS: Readonly<ObservationCounters> = Object.freeze({
  attempts: 0,
  liveAnswers: 0,
  abandons: 0,
  machineAnswers: 0,
  busy: 0,
  noAnswer: 0,
  failed: 0,
});

const COUNTER_FIELDS = Object.keys(EMPTY_COUNTERS) as Array<keyof ObservationCounters>;

export interface ObservationStoreOptions {
  redis: ObservationRedis;
  /** How long a campaign's counters stay relevant. */
  windowMs?: number;
  onFailure?: (operation: string, error: Error) => void;
}

const DEFAULT_WINDOW_MS = 60 * 60 * 1000;

export class RedisObservationStore {
  private readonly windowMs: number;

  constructor(private readonly options: ObservationStoreOptions) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  }

  /**
   * Apply deltas and return the resulting shared totals.
   *
   * Returning the post-increment totals rather than requiring a second read
   * keeps the caller from acting on a value another replica has already moved.
   */
  async increment(
    tenantId: string,
    campaignId: string,
    deltas: Partial<ObservationCounters>
  ): Promise<ObservationCounters | null> {
    if (!isValidTenantId(tenantId) || !campaignId) return null;

    const args: string[] = [];
    for (const field of COUNTER_FIELDS) {
      const delta = deltas[field];
      // Only non-zero deltas are sent; a zero would still create the field and
      // make an untouched counter look observed.
      if (typeof delta === 'number' && Number.isFinite(delta) && delta !== 0) {
        args.push(field, String(Math.trunc(delta)));
      }
    }
    if (args.length === 0) return this.read(tenantId, campaignId);

    try {
      const reply = await this.options.redis.eval(
        INCREMENT_OBSERVATIONS,
        1,
        observationKey(tenantId, campaignId),
        String(this.windowMs),
        ...args
      );
      return countersFromFlat(reply);
    } catch (error) {
      this.options.onFailure?.('observation.increment', error as Error);
      return null;
    }
  }

  /**
   * Read a campaign's counters.
   *
   * Returns null — not zeros — when Redis cannot be reached. Zeros would be
   * indistinguishable from a genuinely idle campaign, and the controller treats
   * a zero sample as "no evidence, dial cautiously" rather than "unknown, do
   * not dial". The caller must decide, and it cannot decide if this lies.
   */
  async read(tenantId: string, campaignId: string): Promise<ObservationCounters | null> {
    if (!isValidTenantId(tenantId) || !campaignId) return null;
    try {
      const raw = await this.options.redis.hgetall(observationKey(tenantId, campaignId));
      return countersFromRecord(raw ?? {});
    } catch (error) {
      this.options.onFailure?.('observation.read', error as Error);
      return null;
    }
  }
}

/** Redis `hgetall` in a Lua reply is a flat [field, value, ...] array. */
function countersFromFlat(reply: unknown): ObservationCounters {
  if (!Array.isArray(reply)) return { ...EMPTY_COUNTERS };
  const record: Record<string, string> = {};
  for (let i = 0; i < reply.length - 1; i += 2) {
    record[String(reply[i])] = String(reply[i + 1]);
  }
  return countersFromRecord(record);
}

function countersFromRecord(raw: Record<string, string>): ObservationCounters {
  const out = { ...EMPTY_COUNTERS };
  for (const field of COUNTER_FIELDS) {
    const parsed = Number(raw[field]);
    // A missing or unparsable counter reads as zero, never as NaN: a NaN would
    // propagate into the posterior and produce a nonsense originate count.
    out[field] = Number.isFinite(parsed) ? parsed : 0;
  }
  return out;
}
