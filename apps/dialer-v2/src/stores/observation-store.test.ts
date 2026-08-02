/**
 * Rolling observation window.
 *
 * The fake executes the script's semantics — HINCRBY per field into the target
 * bucket, then sum across the window keys — so bucket SELECTION and window
 * arithmetic are tested here. That a bucket genuinely EXPIRES on schedule is
 * proven in `redis.live.test.ts`; a fake that deletes keys when it is told to
 * would be asserting its own behaviour.
 */

import { describe, expect, it, vi } from 'vitest';

import { observationBucketKey } from '../config/redis-keys.js';

import {
  INCREMENT_AND_READ_WINDOW,
  MIN_BUCKET_MS,
  ObservationReject,
  RedisObservationStore,
  resolveWindow,
  type ObservationRedis,
} from './observation-store.js';

const TENANT = 'tenant-a';
const CAMPAIGN = 'camp-1';
const BUCKET_MS = 5 * 60 * 1000;
const BUCKETS = 12;

/** Hashes keyed by bucket, with an explicit expiry the test controls. */
function fakeRedis(nowRef: { value: number }) {
  const hashes = new Map<string, Record<string, number>>();
  const expiresAt = new Map<string, number>();

  const live = (key: string): Record<string, number> | undefined => {
    const expiry = expiresAt.get(key);
    if (expiry !== undefined && nowRef.value >= expiry) {
      hashes.delete(key);
      expiresAt.delete(key);
      return undefined;
    }
    return hashes.get(key);
  };

  const redis: ObservationRedis & { hashes: Map<string, Record<string, number>> } = {
    hashes,
    eval: (script, numKeys, ...args) => {
      if (script !== INCREMENT_AND_READ_WINDOW) throw new Error('unexpected script');
      const keys = args.slice(0, numKeys).map(String);
      const rest = args.slice(numKeys).map(String);
      const [ttlMs, pairsN] = rest;
      const incrArgs = rest.slice(2, 2 + Number(pairsN));

      if (Number(pairsN) > 0) {
        const target = keys[0];
        const hash = hashes.get(target) ?? {};
        for (let i = 0; i < incrArgs.length; i += 2) {
          hash[incrArgs[i]] = (hash[incrArgs[i]] ?? 0) + Number(incrArgs[i + 1]);
        }
        hashes.set(target, hash);
        expiresAt.set(target, nowRef.value + Number(ttlMs));
      }

      const total: Record<string, number> = {};
      for (const key of keys.slice(1)) {
        const hash = live(key);
        if (!hash) continue;
        for (const [field, value] of Object.entries(hash)) {
          total[field] = (total[field] ?? 0) + value;
        }
      }
      return Promise.resolve(Object.entries(total).flatMap(([f, v]) => [f, String(v)]));
    },
  };
  return redis;
}

function build(startMs = 1_700_000_000_000) {
  const nowRef = { value: startMs };
  const redis = fakeRedis(nowRef);
  const store = new RedisObservationStore({
    redis,
    bucketMs: BUCKET_MS,
    bucketCount: BUCKETS,
    now: () => nowRef.value,
  });
  return { store, redis, nowRef };
}

describe('the window genuinely forgets', () => {
  it('drops evidence that has aged out under continuous traffic', async () => {
    // The bug this replaces: one hash with PEXPIRE refreshed on every write
    // never expires while a campaign is busy, so a "one hour window" ran from
    // the campaign's first event to its last. A 9am answer rate went on
    // influencing the 9pm forecast forever.
    const { store, nowRef } = build();

    await store.apply(TENANT, CAMPAIGN, nowRef.value, { attempts: 100, liveAnswers: 50 });

    // Twelve hours of unbroken traffic, one event every five minutes.
    for (let i = 0; i < 144; i++) {
      nowRef.value += BUCKET_MS;
      await store.apply(TENANT, CAMPAIGN, nowRef.value, { attempts: 1, liveAnswers: 1 });
    }

    const snapshot = await store.read(TENANT, CAMPAIGN);
    // Only the trailing hour survives — never the original 100.
    expect(snapshot?.attempts).toBeLessThanOrEqual(BUCKETS);
    expect(snapshot?.attempts).toBeGreaterThan(0);
  });

  it('shows 9am observations gone by 9pm', async () => {
    const nineAm = Date.UTC(2026, 7, 2, 9, 0, 0);
    const { store, nowRef } = build(nineAm);

    await store.apply(TENANT, CAMPAIGN, nineAm, { attempts: 500, liveAnswers: 400 });
    expect((await store.read(TENANT, CAMPAIGN))?.attempts).toBe(500);

    nowRef.value = Date.UTC(2026, 7, 2, 21, 0, 0);
    expect((await store.read(TENANT, CAMPAIGN))?.attempts).toBe(0);
  });

  it('sums across every unexpired bucket', async () => {
    const { store, nowRef } = build();
    for (let i = 0; i < 6; i++) {
      await store.apply(TENANT, CAMPAIGN, nowRef.value, { attempts: 10 });
      nowRef.value += BUCKET_MS;
    }
    expect((await store.read(TENANT, CAMPAIGN))?.attempts).toBe(60);
  });
});

describe('the bucket comes from the event, not from receipt', () => {
  it('files a late event in the bucket its own timestamp belongs to', async () => {
    // A batch delivered after an ESL reconnect would otherwise spike whichever
    // bucket happened to be current and claim a burst that never occurred.
    const { store, redis, nowRef } = build();
    const tenMinutesAgo = nowRef.value - 10 * 60 * 1000;

    await store.apply(TENANT, CAMPAIGN, tenMinutesAgo, { attempts: 1 });

    const expected = observationBucketKey(TENANT, CAMPAIGN, Math.floor(tenMinutesAgo / BUCKET_MS));
    expect(redis.hashes.has(expected)).toBe(true);
    expect(
      redis.hashes.has(observationBucketKey(TENANT, CAMPAIGN, Math.floor(nowRef.value / BUCKET_MS)))
    ).toBe(false);
  });

  it('still counts a late event that is inside the window', async () => {
    const { store, nowRef } = build();
    await store.apply(TENANT, CAMPAIGN, nowRef.value - 30 * 60 * 1000, { attempts: 3 });
    expect((await store.read(TENANT, CAMPAIGN))?.attempts).toBe(3);
  });

  it('rejects an event older than the window rather than moving it', async () => {
    // Counting it anywhere else is a lie about when it happened, and
    // re-creating its bucket resurrects a slice of history the window has
    // already moved past.
    const onReject = vi.fn();
    const nowRef = { value: 1_700_000_000_000 };
    const store = new RedisObservationStore({
      redis: fakeRedis(nowRef),
      bucketMs: BUCKET_MS,
      bucketCount: BUCKETS,
      now: () => nowRef.value,
      onReject,
    });

    await store.apply(TENANT, CAMPAIGN, nowRef.value - 4 * 60 * 60 * 1000, { attempts: 99 });

    expect(onReject).toHaveBeenCalledWith(ObservationReject.OUTSIDE_WINDOW, TENANT, CAMPAIGN);
    expect(store.metrics().rejectedOutsideWindow).toBe(1);
    expect((await store.read(TENANT, CAMPAIGN))?.attempts).toBe(0);
  });

  it('rejects an event from further ahead than clock skew explains', async () => {
    const onReject = vi.fn();
    const nowRef = { value: 1_700_000_000_000 };
    const store = new RedisObservationStore({
      redis: fakeRedis(nowRef),
      bucketMs: BUCKET_MS,
      bucketCount: BUCKETS,
      now: () => nowRef.value,
      onReject,
    });

    await store.apply(TENANT, CAMPAIGN, nowRef.value + 60 * 60 * 1000, { attempts: 5 });
    expect(onReject).toHaveBeenCalledWith(ObservationReject.FUTURE_EVENT, TENANT, CAMPAIGN);
    expect((await store.read(TENANT, CAMPAIGN))?.attempts).toBe(0);
  });
});

describe('two replicas both count', () => {
  it('does not lose an increment when two stores share one server', async () => {
    // HINCRBY rather than read-modify-write. The alternative loses one of two
    // concurrent increments, and the abandonment rate is the number that
    // governs whether a campaign may keep dialing.
    const nowRef = { value: 1_700_000_000_000 };
    const redis = fakeRedis(nowRef);
    const opts = { redis, bucketMs: BUCKET_MS, bucketCount: BUCKETS, now: () => nowRef.value };

    const a = new RedisObservationStore(opts);
    const b = new RedisObservationStore(opts);

    await Promise.all([
      a.apply(TENANT, CAMPAIGN, nowRef.value, { attempts: 1 }),
      b.apply(TENANT, CAMPAIGN, nowRef.value, { attempts: 1 }),
    ]);

    expect((await a.read(TENANT, CAMPAIGN))?.attempts).toBe(2);
  });
});

describe('latency is carried as sum and count', () => {
  it('computes a window mean that weights buckets by their sample size', async () => {
    // Averages cannot be added: summing two buckets' means would weight a
    // bucket with three calls the same as one with three thousand.
    const { store, nowRef } = build();

    await store.apply(TENANT, CAMPAIGN, nowRef.value, {
      answerLatencySumMs: 3_000,
      answerLatencyCount: 3,
    });
    nowRef.value += BUCKET_MS;
    await store.apply(TENANT, CAMPAIGN, nowRef.value, {
      answerLatencySumMs: 3_000_000,
      answerLatencyCount: 3_000,
    });

    const snapshot = await store.read(TENANT, CAMPAIGN);
    // 3003000 / 3003, not the mean of 1000 and 1000.
    expect(snapshot?.meanAnswerLatencyMs).toBeCloseTo(1_000, 5);
    expect(snapshot?.answerLatencyCount).toBe(3_003);
  });

  it('reports a zero mean rather than NaN with no samples', async () => {
    // A NaN would propagate into the posterior and produce a nonsense
    // originate count.
    const { store } = build();
    const snapshot = await store.read(TENANT, CAMPAIGN);
    expect(snapshot?.meanAnswerLatencyMs).toBe(0);
    expect(Number.isNaN(snapshot?.meanCallDurationMs)).toBe(false);
  });
});

describe('a restart reads back the same window', () => {
  it('gives a fresh store the totals the previous one wrote', async () => {
    const nowRef = { value: 1_700_000_000_000 };
    const redis = fakeRedis(nowRef);
    const opts = { redis, bucketMs: BUCKET_MS, bucketCount: BUCKETS, now: () => nowRef.value };

    await new RedisObservationStore(opts).apply(TENANT, CAMPAIGN, nowRef.value, {
      attempts: 7,
      liveAnswers: 4,
    });

    // A restart used to reset the counts to zero, and a zero-sample posterior
    // collapses to the prior — so every deploy threw away the learned answer
    // rate and started the ramp again.
    const afterRestart = await new RedisObservationStore(opts).read(TENANT, CAMPAIGN);
    expect(afterRestart).toMatchObject({ attempts: 7, liveAnswers: 4 });
  });
});

describe('failures and bad scopes', () => {
  it('returns null rather than zeros when Redis is unreachable', async () => {
    // Zeros are indistinguishable from a genuinely idle campaign, and the
    // controller reads a zero sample as "dial cautiously" rather than "unknown".
    const store = new RedisObservationStore({
      redis: { eval: () => Promise.reject(new Error('down')) },
    });
    expect(await store.read(TENANT, CAMPAIGN)).toBeNull();
    expect(await store.apply(TENANT, CAMPAIGN, Date.now(), { attempts: 1 })).toBeNull();
  });

  it('refuses a reserved tenant or an empty campaign', async () => {
    const { store } = build();
    expect(await store.read('global', CAMPAIGN)).toBeNull();
    expect(await store.apply(TENANT, '', Date.now(), { attempts: 1 })).toBeNull();
  });

  it('sends only non-zero, whole deltas', async () => {
    // A zero would create the field and make an untouched counter look
    // observed; a fraction is not a valid HINCRBY argument.
    const evalSpy = vi.fn(() => Promise.resolve([]));
    const nowRef = { value: 1_700_000_000_000 };
    const store = new RedisObservationStore({
      redis: { eval: evalSpy },
      bucketMs: BUCKET_MS,
      now: () => nowRef.value,
    });

    await store.apply(TENANT, CAMPAIGN, nowRef.value, {
      attempts: 2.7,
      liveAnswers: 0,
      abandons: 1,
    });

    const args = (evalSpy.mock.calls[0] as unknown[]).map(String);
    expect(args).toContain('2');
    expect(args).toContain('abandons');
    expect(args).not.toContain('liveAnswers');
  });
});

describe('an unusable window is refused, not quietly widened', () => {
  // This was `Math.max(1_000, options.bucketMs ?? DEFAULT)`. A caller asking for
  // a 200 ms bucket got 1000 ms and nothing anywhere reported the substitution —
  // the same defect class this store exists to fix. It cost two CI runs, on
  // assertions that could not have held against a window that never advanced.
  it('rejects a bucket shorter than a second', () => {
    expect(() => resolveWindow(200, 12)).toThrow(RangeError);
    expect(() => resolveWindow(200, 12)).toThrow(/at least 1000 ms; received 200/);
  });

  it('rejects zero and negative bucket widths', () => {
    expect(() => resolveWindow(0, 12)).toThrow(RangeError);
    expect(() => resolveWindow(-5_000, 12)).toThrow(RangeError);
  });

  it('rejects a bucket width that is not a number', () => {
    // A deployment variable of "abc" parses to NaN. Treating that as absent
    // would hide the typo behind a default that looked deliberate.
    expect(() => resolveWindow(Number.NaN, 12)).toThrow(RangeError);
  });

  it('rejects a fractional or non-positive bucket count', () => {
    expect(() => resolveWindow(60_000, 0)).toThrow(/positive integer/);
    expect(() => resolveWindow(60_000, 2.5)).toThrow(/positive integer/);
    expect(() => resolveWindow(60_000, Number.NaN)).toThrow(/positive integer/);
  });

  it('accepts the boundary exactly', () => {
    expect(resolveWindow(MIN_BUCKET_MS, 1)).toEqual({ bucketMs: 1_000, bucketCount: 1 });
  });

  it('applies the trailing-hour default when neither is supplied', () => {
    expect(resolveWindow(undefined, undefined)).toEqual({
      bucketMs: 5 * 60 * 1000,
      bucketCount: 12,
    });
  });

  it('refuses to construct a store with an unusable window', () => {
    // The constructor must not accept what the validator rejects, or the
    // validation is decorative.
    expect(
      () => new RedisObservationStore({ redis: { eval: () => Promise.resolve([]) }, bucketMs: 200 })
    ).toThrow(RangeError);
  });
});
