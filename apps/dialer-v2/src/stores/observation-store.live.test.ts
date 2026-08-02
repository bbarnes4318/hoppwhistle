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

/** Short buckets so a real window boundary can be crossed inside a test. */
const store = (bucketMs = 300, bucketCount = 3, now?: () => number) =>
  new RedisObservationStore({
    redis: redis as unknown as ObservationRedis,
    bucketMs,
    bucketCount,
    now,
  });

const TENANT = 'live-tenant';
const CAMPAIGN = 'live-camp';

describe('the window forgets on the server', () => {
  live('drops a bucket that has aged out, under continuous traffic', async () => {
    // The bug: one hash with PEXPIRE refreshed on every write never expires
    // while a campaign is busy. Traffic here is unbroken, so if the old
    // behaviour were still present nothing would ever fall out.
    const s = store(200, 3);

    await s.apply(TENANT, CAMPAIGN, Date.now(), { attempts: 100 });

    for (let i = 0; i < 8; i++) {
      await sleep(150);
      await s.apply(TENANT, CAMPAIGN, Date.now(), { attempts: 1 });
    }

    const snapshot = await s.read(TENANT, CAMPAIGN);
    expect(snapshot).not.toBeNull();
    // The original 100 is outside the trailing window and genuinely gone.
    expect(snapshot!.attempts).toBeLessThan(100);
  });

  live('a campaign that goes quiet loses its counters entirely', async () => {
    const s = store(150, 2);
    await s.apply(TENANT, CAMPAIGN, Date.now(), { attempts: 42 });
    expect((await s.read(TENANT, CAMPAIGN))!.attempts).toBe(42);

    await sleep(700);
    expect((await s.read(TENANT, CAMPAIGN))!.attempts).toBe(0);
  });

  live('sums across buckets while they are all still live', async () => {
    const s = store(300, 6);
    for (let i = 0; i < 3; i++) {
      await s.apply(TENANT, CAMPAIGN, Date.now(), { attempts: 5 });
      await sleep(310);
    }
    expect((await s.read(TENANT, CAMPAIGN))!.attempts).toBe(15);
  });
});

describe('the bucket is chosen by event time', () => {
  live('files a late event under a real earlier bucket key', async () => {
    const nowRef = { value: Date.now() };
    const s = store(1_000, 12, () => nowRef.value);

    await s.apply(TENANT, CAMPAIGN, nowRef.value - 4_000, { attempts: 3 });

    // Two distinct bucket keys exist only if selection used event time.
    await s.apply(TENANT, CAMPAIGN, nowRef.value, { attempts: 1 });
    const keys = await redis.keys(`tenant:${TENANT}:dialer:v2:campaign:${CAMPAIGN}:observation:*`);
    expect(keys.length).toBe(2);

    expect((await s.read(TENANT, CAMPAIGN))!.attempts).toBe(4);
  });

  live('rejects an event older than every live bucket', async () => {
    const nowRef = { value: Date.now() };
    const s = store(1_000, 3, () => nowRef.value);

    await s.apply(TENANT, CAMPAIGN, nowRef.value - 60_000, { attempts: 99 });
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
