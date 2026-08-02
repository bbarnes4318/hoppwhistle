/**
 * Live Redis suite. Runs against a real server, never a fake.
 *
 * Everything here is chosen because a hand-written fake would agree with the
 * code under test rather than check it: Lua's `false`-not-`nil` for a missing
 * key, integer reply coercion, `SET NX PX` atomicity, real wall-clock TTL
 * expiry, and `EVAL` argument stringification.
 *
 * Skips when no server is reachable. In CI `DIALER_V2_REQUIRE_LIVE_SERVICES`
 * is set, which turns an unreachable server into a failure — a suite that
 * silently skips in CI is the same false green as one that never ran.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ShadowDecisionRecord } from '../shadow/engine.js';
import { connectLiveRedis, flushTestDb, sleep, type LiveRedis } from '../testing/live-services.js';

import {
  RELEASE_IF_OWNER,
  RENEW_IF_OWNER,
  RedisDistributedLock,
  type LockRedis,
} from './coordination.js';
import {
  ACCEPT_FENCED_DECISION,
  DecisionRejection,
  FencedShadowDecisionStore,
  type FencedRedis,
} from './fenced-decisions.js';
import { RedisDedupeStore, RedisShadowDecisionStore, type MinimalRedis } from './redis.js';

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

/** Reports the reason rather than vanishing from the output. */
function live(name: string, fn: () => Promise<void>) {
  it(name, async () => {
    if (!available) {
      console.warn(`[live-redis] skipped "${name}": ${skipReason}`);
      return;
    }
    await fn();
  });
}

const asLock = () => redis as unknown as LockRedis;
const asMinimal = () => redis as unknown as MinimalRedis;
const asFenced = () => redis as unknown as FencedRedis;

function decision(overrides: Partial<ShadowDecisionRecord> = {}): ShadowDecisionRecord {
  return {
    tenantId: 'live-tenant',
    campaignId: 'live-camp',
    decidedAtMs: 1_800_000_000_000,
    controllerVersion: '1.1.0',
    inputs: {} as ShadowDecisionRecord['inputs'],
    decision: null,
    recommendedOriginateCount: 2,
    bindingConstraint: 'AGENT_CAPACITY',
    degradationMode: 'PREDICTIVE',
    safetyReasons: [],
    blockedBy: [],
    originated: false,
    explanation: 'live',
    ...overrides,
  };
}

describe('Lua semantics a fake cannot reproduce', () => {
  live('RELEASE_IF_OWNER compares against a missing key without erroring', async () => {
    // redis.call('get') on a missing key returns Lua `false`, not `nil`. A fake
    // that returns undefined and compares loosely would never show this.
    const result = await redis.eval(RELEASE_IF_OWNER, 1, 'nonexistent', 'owner-a:1');
    expect(Number(result)).toBe(0);
  });

  live('RELEASE_IF_OWNER refuses to delete a lock owned by someone else', async () => {
    await redis.set('lock', 'owner-b:2');
    expect(Number(await redis.eval(RELEASE_IF_OWNER, 1, 'lock', 'owner-a:1'))).toBe(0);
    expect(await redis.get('lock')).toBe('owner-b:2');
  });

  live('RELEASE_IF_OWNER deletes its own lock', async () => {
    await redis.set('lock', 'owner-a:1');
    expect(Number(await redis.eval(RELEASE_IF_OWNER, 1, 'lock', 'owner-a:1'))).toBe(1);
    expect(await redis.exists('lock')).toBe(0);
  });

  live('RENEW_IF_OWNER extends only the owner TTL, measured on the server', async () => {
    await redis.set('lock', 'owner-a:1', 'PX', 500);
    expect(Number(await redis.eval(RENEW_IF_OWNER, 1, 'lock', 'owner-b:2', 5_000))).toBe(0);
    expect(await redis.pttl('lock')).toBeLessThanOrEqual(500);

    expect(Number(await redis.eval(RENEW_IF_OWNER, 1, 'lock', 'owner-a:1', 5_000))).toBe(1);
    expect(await redis.pttl('lock')).toBeGreaterThan(1_000);
  });

  live('EVAL coerces the -1 duplicate reply to an integer, not a string', async () => {
    const first = await redis.eval(
      ACCEPT_FENCED_DECISION,
      3,
      'fence',
      'bucket',
      'list',
      '1',
      '{}',
      '10',
      '60000',
      '5000'
    );
    expect(first).toBe(1);
    expect(typeof first).toBe('number');

    const dup = await redis.eval(
      ACCEPT_FENCED_DECISION,
      3,
      'fence',
      'bucket',
      'list',
      '2',
      '{}',
      '10',
      '60000',
      '5000'
    );
    expect(dup).toBe(-1);
  });
});

describe('real TTL expiry', () => {
  live('a lock genuinely becomes acquirable after its TTL lapses', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'replica-a' });
    const b = new RedisDistributedLock({ redis: asLock(), ownerId: 'replica-b' });

    expect(await a.acquire('ttl-lock', 200)).not.toBeNull();
    expect(await b.acquire('ttl-lock', 200)).toBeNull();

    await sleep(350);

    // No clock was faked. Redis expired the key on its own.
    expect(await b.acquire('ttl-lock', 200)).not.toBeNull();
  });

  live('a renewing holder keeps the lock past the original TTL', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'replica-a' });
    const b = new RedisDistributedLock({ redis: asLock(), ownerId: 'replica-b' });

    expect(await a.acquire('renewed', 300)).not.toBeNull();
    await sleep(150);
    expect(await a.renew('renewed', 1_500)).toBe(true);
    await sleep(300);

    expect(await b.acquire('renewed', 300)).toBeNull();
    expect(await a.renew('renewed', 300)).toBe(true);
  });

  live('renew reports false once the lock has actually been lost', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'replica-a' });
    expect(await a.acquire('lost', 150)).not.toBeNull();
    await sleep(300);
    expect(await a.renew('lost', 1_000)).toBe(false);
  });
});

describe('SET NX PX is atomic on the server', () => {
  live('exactly one of many concurrent acquirers wins', async () => {
    const locks = Array.from(
      { length: 12 },
      (_, i) => new RedisDistributedLock({ redis: asLock(), ownerId: `replica-${i}` })
    );

    const handles = await Promise.all(locks.map(l => l.acquire('contended', 5_000)));
    expect(handles.filter(h => h !== null)).toHaveLength(1);
  });

  live('fencing tokens increase monotonically across real acquisitions', async () => {
    const tokens: number[] = [];
    for (let i = 0; i < 5; i++) {
      const lock = new RedisDistributedLock({ redis: asLock(), ownerId: `replica-${i}` });
      const handle = await lock.acquire('sequenced', 5_000);
      expect(handle).not.toBeNull();
      tokens.push(handle!.fencingToken);
      await lock.release('sequenced');
    }

    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i]).toBeGreaterThan(tokens[i - 1]);
    }
  });
});

describe('the pause-resume race against a real server', () => {
  live('a replica that resumes after losing its lock has its write refused', async () => {
    const store = new FencedShadowDecisionStore({ redis: asFenced(), intervalMs: 1_000 });

    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'replica-a' });
    const b = new RedisDistributedLock({ redis: asLock(), ownerId: 'replica-b' });

    // 1. A acquires with a short TTL and is about to evaluate.
    const handleA = await a.acquire('campaign:live-tenant:live-camp:shadow', 200);
    expect(handleA).not.toBeNull();

    // 2. A pauses long enough for its lock to lapse. Real elapsed time, real
    //    server-side expiry — this is the step a fake clock cannot honestly test.
    await sleep(350);

    // 3. B takes over with a strictly higher token and writes.
    const handleB = await b.acquire('campaign:live-tenant:live-camp:shadow', 5_000);
    expect(handleB).not.toBeNull();
    expect(handleB!.fencingToken).toBeGreaterThan(handleA!.fencingToken);

    const wroteB = await store.recordFenced(
      decision({ recommendedOriginateCount: 42, decidedAtMs: 1_800_000_000_000 }),
      handleB!.fencingToken
    );
    expect(wroteB.accepted).toBe(true);

    // 4. A resumes, still believing it holds the lock, and writes.
    const wroteA = await store.recordFenced(
      decision({ recommendedOriginateCount: 7, decidedAtMs: 1_800_000_002_000 }),
      handleA!.fencingToken
    );

    expect(wroteA.accepted).toBe(false);
    expect(wroteA.rejection).toBe(DecisionRejection.STALE_FENCING_TOKEN);

    // Only B's decision is in the history Phase 3 will be judged on.
    const history = await store.recent('live-tenant', 10, 'live-camp');
    expect(history).toHaveLength(1);
    expect(history[0].recommendedOriginateCount).toBe(42);
  });

  live('one decision per campaign per interval survives concurrent replicas', async () => {
    const store = new FencedShadowDecisionStore({ redis: asFenced(), intervalMs: 1_000 });

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        store.recordFenced(decision({ recommendedOriginateCount: i }), i + 1)
      )
    );

    expect(results.filter(r => r.accepted)).toHaveLength(1);
    expect(await store.recent('live-tenant', 20, 'live-camp')).toHaveLength(1);
  });

  live('different campaigns are not serialised against each other', async () => {
    const store = new FencedShadowDecisionStore({ redis: asFenced(), intervalMs: 1_000 });

    expect((await store.recordFenced(decision({ campaignId: 'camp-x' }), 1)).accepted).toBe(true);
    expect((await store.recordFenced(decision({ campaignId: 'camp-y' }), 1)).accepted).toBe(true);
  });

  live('the interval bucket marker expires so later intervals are writable', async () => {
    const store = new FencedShadowDecisionStore({ redis: asFenced(), intervalMs: 100 });
    expect((await store.recordFenced(decision({ decidedAtMs: 1_000 }), 1)).accepted).toBe(true);

    // Same bucket, refused.
    expect((await store.recordFenced(decision({ decidedAtMs: 1_050 }), 2)).accepted).toBe(false);
    // Next bucket, accepted.
    expect((await store.recordFenced(decision({ decidedAtMs: 1_150 }), 3)).accepted).toBe(true);
  });
});

describe('dedupe against a real server', () => {
  live('the second delivery of an event id is rejected', async () => {
    const dedupe = new RedisDedupeStore({ redis: asMinimal() });
    expect(await dedupe.markSeen('live-tenant', 'evt-1', 60_000)).toBe(true);
    expect(await dedupe.markSeen('live-tenant', 'evt-1', 60_000)).toBe(false);
  });

  live('concurrent deliveries of the same id admit exactly one', async () => {
    const dedupe = new RedisDedupeStore({ redis: asMinimal() });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => dedupe.markSeen('live-tenant', 'evt-race', 60_000))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  live('the same event id in another tenant is a different key', async () => {
    const dedupe = new RedisDedupeStore({ redis: asMinimal() });
    expect(await dedupe.markSeen('tenant-one', 'evt-shared', 60_000)).toBe(true);
    expect(await dedupe.markSeen('tenant-two', 'evt-shared', 60_000)).toBe(true);
  });

  live('a dedupe marker really expires', async () => {
    const dedupe = new RedisDedupeStore({ redis: asMinimal() });
    expect(await dedupe.markSeen('live-tenant', 'evt-ttl', 150)).toBe(true);
    await sleep(300);
    expect(await dedupe.markSeen('live-tenant', 'evt-ttl', 150)).toBe(true);
  });
});

describe('tenant isolation on a real keyspace', () => {
  live('one tenant cannot read another tenant decisions', async () => {
    const store = new RedisShadowDecisionStore({ redis: asMinimal() });
    await store.record(decision({ tenantId: 'tenant-one', campaignId: 'shared-name' }));
    await store.record(decision({ tenantId: 'tenant-two', campaignId: 'shared-name' }));

    expect(await store.recent('tenant-one', 10, 'shared-name')).toHaveLength(1);
    expect((await store.recent('tenant-one', 10, 'shared-name'))[0].tenantId).toBe('tenant-one');
  });

  live('every key written is inside its own tenant namespace', async () => {
    const store = new RedisShadowDecisionStore({ redis: asMinimal() });
    await store.record(decision({ tenantId: 'tenant-one' }));

    const keys = await redis.keys('*');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toMatch(/^tenant:tenant-one:dialer:v2:/);
    }
  });
});
