/**
 * Live rolling-window suite.
 *
 * The claim that matters here is that a bucket genuinely EXPIRES — on the
 * server, on its own schedule, whether or not the campaign is still busy. A
 * fake that deletes a key when the test tells it to is asserting the test's
 * behaviour, not the store's, and the bug being fixed was precisely that the
 * old key never expired under load.
 *
 * Buckets are shortened so the window can be crossed in real elapsed time.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { connectLiveRedis, flushTestDb, sleep, type LiveRedis } from '../testing/live-services.js';

import { RedisObservationStore, type ObservationRedis } from './observation-store.js';

let redis: LiveRedis;
let available = false;
let skipReason = '';

beforeAll(async () => {
  const handle = await connectLiveRedis();
  available = handle.available;
  skipReason = handle.reason ?? '';
  if (available) redis = handle.client;
});

afterEach(async () => {
  if (available) await flushTestDb(redis);
});

afterAll(async () => {
  if (available) {
    await flushTestDb(redis);
    await redis.quit();
  }
});

function live(name: string, fn: () => Promise<void>) {
  it(name, async () => {
    if (!available) {
      console.warn(`[live-observations] skipped "${name}": ${skipReason}`);
      return;
    }
    await fn();
  });
}

/**
 * `bucketMs` is floored at one second by the store — a sub-second bucket is not
 * a meaningful statistic — so tests that need to cross a boundary quickly drive
 * an injected clock rather than passing a smaller bucket that would be ignored.
 */
const store = (bucketMs = 60_000, bucketCount = 12, now?: () => number) =>
  new RedisObservationStore({
    redis: redis as unknown as ObservationRedis,
    bucketMs,
    bucketCount,
    now,
  });

const TENANT = 'live-tenant';
const CAMPAIGN = 'live-camp';

describe('the window forgets, under continuous traffic', () => {
  live('drops evidence that has aged out while the campaign stays busy', async () => {
    // The bug: one hash with PEXPIRE refreshed on every write never expires
    // while a campaign is busy, so a "one hour window" ran from the campaign's
    // first event to its last. Traffic here is unbroken throughout, which is
    // exactly the condition under which the old behaviour never forgot.
    const clock = { value: Date.now() };
    const s = store(60_000, 3, () => clock.value);

    await s.apply(TENANT, CAMPAIGN, clock.value, { attempts: 100 });
    expect((await s.read(TENANT, CAMPAIGN))!.attempts).toBe(100);

    for (let i = 0; i < 8; i++) {
      clock.value += 60_000;
      await s.apply(TENANT, CAMPAIGN, clock.value, { attempts: 1 });
    }

    const snapshot = await s.read(TENANT, CAMPAIGN);
    // Only the trailing three buckets remain. The original 100 is gone despite
    // the campaign never having gone quiet.
    expect(snapshot!.attempts).toBe(3);
  });

  live('a campaign that goes quiet reads as zero', async () => {
    const clock = { value: Date.now() };
    const s = store(60_000, 2, () => clock.value);

    await s.apply(TENANT, CAMPAIGN, clock.value, { attempts: 42 });
    expect((await s.read(TENANT, CAMPAIGN))!.attempts).toBe(42);

    clock.value += 10 * 60_000;
    expect((await s.read(TENANT, CAMPAIGN))!.attempts).toBe(0);
  });

  live('sums across every bucket still inside the window', async () => {
    const clock = { value: Date.now() };
    const s = store(60_000, 6, () => clock.value);

    for (let i = 0; i < 3; i++) {
      await s.apply(TENANT, CAMPAIGN, clock.value, { attempts: 5 });
      clock.value += 60_000;
    }
    expect((await s.read(TENANT, CAMPAIGN))!.attempts).toBe(15);
  });
});

describe('a bucket really expires on the server', () => {
  live('the key is gone after its TTL, not merely outside the window', async () => {
    // The test above proves the READ excludes an old bucket. This proves Redis
    // itself drops it, so a busy campaign cannot accumulate keys forever. The
    // TTL is window + one bucket, so the shortest honest wait is a few seconds.
    const s = store(1_000, 1);
    const at = Date.now();
    await s.apply(TENANT, CAMPAIGN, at, { attempts: 9 });

    const key = `tenant:${TENANT}:dialer:v2:campaign:${CAMPAIGN}:observation:${Math.floor(at / 1_000)}`;
    expect(await redis.exists(key)).toBe(1);

    await sleep(2_600);
    expect(await redis.exists(key)).toBe(0);
  });
});

describe('the bucket is chosen by event time', () => {
  live('files a late event under a real earlier bucket key', async () => {
    const nowRef = { value: Date.now() };
    const s = store(60_000, 12, () => nowRef.value);

    await s.apply(TENANT, CAMPAIGN, nowRef.value - 4 * 60_000, { attempts: 3 });

    // Two distinct bucket keys exist only if selection used event time.
    await s.apply(TENANT, CAMPAIGN, nowRef.value, { attempts: 1 });
    const keys = await redis.keys(`tenant:${TENANT}:dialer:v2:campaign:${CAMPAIGN}:observation:*`);
    expect(keys.length).toBe(2);

    expect((await s.read(TENANT, CAMPAIGN))!.attempts).toBe(4);
  });

  live('rejects an event older than every live bucket', async () => {
    const nowRef = { value: Date.now() };
    const s = store(60_000, 3, () => nowRef.value);

    await s.apply(TENANT, CAMPAIGN, nowRef.value - 60 * 60_000, { attempts: 99 });
    expect(s.metrics().rejectedOutsideWindow).toBe(1);
    expect((await s.read(TENANT, CAMPAIGN))!.attempts).toBe(0);
  });
});

describe('two replicas share one window', () => {
  live('both replicas count toward one sample', async () => {
    // Each replica observing half the calls meant each estimated from half the
    // sample, and neither ever reached minSampleSize — so the controller stayed
    // degraded while believing it lacked data it actually had.
    const a = store(60_000, 12);
    const b = store(60_000, 12);
    const at = Date.now();

    await a.apply(TENANT, CAMPAIGN, at, { attempts: 30, liveAnswers: 6 });
    await b.apply(TENANT, CAMPAIGN, at, { attempts: 40, liveAnswers: 9 });

    expect(await a.read(TENANT, CAMPAIGN)).toMatchObject({ attempts: 70, liveAnswers: 15 });
  });

  live('fifty concurrent increments lose nothing', async () => {
    // HINCRBY, not read-modify-write. The latter would drop most of these.
    const s = store(60_000, 12);
    const at = Date.now();
    await Promise.all(
      Array.from({ length: 50 }, () => s.apply(TENANT, CAMPAIGN, at, { attempts: 1 }))
    );
    expect((await s.read(TENANT, CAMPAIGN))!.attempts).toBe(50);
  });

  live('a restart reads back the same trailing window', async () => {
    // A restart used to reset counts to zero, and a zero-sample posterior
    // collapses to the prior — so every deploy threw away the learned answer
    // rate and started the ramp again.
    const at = Date.now();
    await store(60_000, 12).apply(TENANT, CAMPAIGN, at, { attempts: 500, liveAnswers: 110 });

    expect(await store(60_000, 12).read(TENANT, CAMPAIGN)).toMatchObject({
      attempts: 500,
      liveAnswers: 110,
    });
  });
});

describe('latency sums survive the Lua number formatter', () => {
  live('a large sum comes back exact, not in scientific notation', async () => {
    // Lua 5.1 renders numbers with %.14g. `tostring()` on a sum past fourteen
    // significant digits yields "1.2e+14", which parses to something the
    // controller cannot use. The script formats with %.0f for this reason.
    const s = store(60_000, 12);
    const at = Date.now();
    const big = 99_999_999_999_999;

    await s.apply(TENANT, CAMPAIGN, at, {
      answerLatencySumMs: big,
      answerLatencyCount: 1,
    });

    const snapshot = await s.read(TENANT, CAMPAIGN);
    expect(snapshot!.answerLatencySumMs).toBe(big);
    expect(snapshot!.meanAnswerLatencyMs).toBe(big);
  });

  live('the window mean weights buckets by their sample size', async () => {
    const s = store(60_000, 12);
    const at = Date.now();

    await s.apply(TENANT, CAMPAIGN, at, { answerLatencySumMs: 3_000, answerLatencyCount: 3 });
    await s.apply(TENANT, CAMPAIGN, at, {
      answerLatencySumMs: 3_000_000,
      answerLatencyCount: 3_000,
    });

    expect((await s.read(TENANT, CAMPAIGN))!.meanAnswerLatencyMs).toBeCloseTo(1_000, 5);
  });
});

describe('counters do not cross scopes', () => {
  live('keeps campaigns and tenants apart on a real keyspace', async () => {
    const s = store(60_000, 12);
    const at = Date.now();

    await s.apply(TENANT, 'camp-1', at, { attempts: 10 });
    await s.apply(TENANT, 'camp-2', at, { attempts: 3 });
    await s.apply('other-tenant', 'camp-1', at, { attempts: 7 });

    expect((await s.read(TENANT, 'camp-1'))!.attempts).toBe(10);
    expect((await s.read(TENANT, 'camp-2'))!.attempts).toBe(3);
    expect((await s.read('other-tenant', 'camp-1'))!.attempts).toBe(7);
  });

  live('a campaign that was never observed reads as zeros, not null', async () => {
    // Zeros mean "no evidence"; null means "unknown". Only an unreachable
    // server produces null.
    expect(await store().read(TENANT, 'never-seen')).toMatchObject({
      attempts: 0,
      liveAnswers: 0,
    });
  });
});
