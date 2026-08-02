/**
 * Live Redis suite. Runs against a real server, never a fake.
 *
 * Everything here is chosen because a hand-written fake would agree with the
 * code under test rather than check it: Lua's `false`-not-`nil` for a missing
 * key, integer reply coercion, atomic compare-and-act, real wall-clock TTL
 * expiry, and `EVAL` argument stringification.
 *
 * The ownership cases matter most here. A fake cannot show a key genuinely
 * disappearing when its TTL elapses, and "the lock expired and nobody replaced
 * it" is the exact case a token comparison could not see.
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
  campaignShadowLock,
  globalLock,
  type LockDescriptor,
  type LockRedis,
} from './coordination.js';
import {
  ACCEPT_FENCED_DECISION,
  DecisionRejection,
  FencedShadowDecisionStore,
  type FencedRedis,
} from './fenced-decisions.js';
import { RedisDedupeStore, type MinimalRedis } from './redis.js';

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

const CAMPAIGN: LockDescriptor = campaignShadowLock('live-tenant', 'live-camp');

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

/** Authority a holder presents to the decision store. */
function authorityOf(handle: { fencingToken: number; lockValue: string }) {
  return { fencingToken: handle.fencingToken, lockValue: handle.lockValue };
}

const store = () => new FencedShadowDecisionStore({ redis: asFenced(), intervalMs: 1_000 });

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

  live('ACCEPT_FENCED_DECISION returns 0 for a lock key that does not exist', async () => {
    // The `not held` branch: an expired lock holds Lua `false`, which must not
    // compare equal to the presented value.
    const reply = await redis.eval(
      ACCEPT_FENCED_DECISION,
      5,
      'lock',
      'fence',
      'bucket',
      'list',
      'index',
      'A:1',
      '1',
      '{}',
      '10',
      '60000',
      '5000',
      'camp-1',
      '1800000000000',
      '60000'
    );
    expect(reply).toBe(0);
    expect(typeof reply).toBe('number');
  });

  live('EVAL coerces the -1 and -2 replies to integers, not strings', async () => {
    await redis.set('lock', 'A:1');
    await redis.set('fence', '1');

    const args = [
      'lock',
      'fence',
      'bucket',
      'list',
      'index',
      'A:1',
      '1',
      '{}',
      '10',
      '60000',
      '5000',
      'camp-1',
      '1800000000000',
      '60000',
    ];

    const first = await redis.eval(ACCEPT_FENCED_DECISION, 5, ...args);
    expect(first).toBe(1);

    const dup = await redis.eval(ACCEPT_FENCED_DECISION, 5, ...args);
    expect(dup).toBe(-1);

    // Fence moved on: the -2 branch.
    await redis.set('fence', '9');
    await redis.del('bucket');
    const stale = await redis.eval(ACCEPT_FENCED_DECISION, 5, ...args);
    expect(stale).toBe(-2);
  });
});

describe('real TTL expiry, on the server rather than in a fake', () => {
  live('a lock genuinely becomes free after its TTL', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const b = new RedisDistributedLock({ redis: asLock(), ownerId: 'B' });

    expect(await a.acquire(CAMPAIGN, 200)).not.toBeNull();
    expect(await b.acquire(CAMPAIGN, 200)).toBeNull();

    await sleep(320);
    expect(await b.acquire(CAMPAIGN, 200)).not.toBeNull();
  });

  live('renewing keeps a lock the holder would otherwise lose', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const b = new RedisDistributedLock({ redis: asLock(), ownerId: 'B' });

    expect(await a.acquire(CAMPAIGN, 300)).not.toBeNull();
    await sleep(200);
    expect(await a.renew(CAMPAIGN, 300)).toBe(true);
    await sleep(200);

    // Past the original TTL, still held.
    expect(await b.acquire(CAMPAIGN, 300)).toBeNull();
  });

  live('renew reports false once the lock has actually expired', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    expect(await a.acquire(CAMPAIGN, 150)).not.toBeNull();
    await sleep(300);
    expect(await a.renew(CAMPAIGN, 150)).toBe(false);
  });
});

describe('the fence advances only on a granted lock', () => {
  live('a failed acquisition leaves the counter alone', async () => {
    // The previous INCR-then-SET-NX version advanced the counter on a FAILED
    // attempt, so B could starve A — the uninterrupted holder — simply by
    // trying, because A's token was no longer the latest issued.
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const b = new RedisDistributedLock({ redis: asLock(), ownerId: 'B' });

    const held = await a.acquire(CAMPAIGN, 5_000);
    for (let i = 0; i < 5; i++) expect(await b.acquire(CAMPAIGN, 5_000)).toBeNull();

    expect(await redis.get(CAMPAIGN.fenceKey)).toBe(String(held!.fencingToken));

    // A can still write, despite five intervening attempts by B.
    expect((await store().recordFenced(decision(), authorityOf(held!))).accepted).toBe(true);
  });

  live('exactly one of twelve concurrent acquirers wins', async () => {
    const locks = Array.from(
      { length: 12 },
      (_, i) => new RedisDistributedLock({ redis: asLock(), ownerId: `owner-${i}` })
    );
    const handles = await Promise.all(locks.map(l => l.acquire(CAMPAIGN, 5_000)));
    expect(handles.filter(Boolean)).toHaveLength(1);
  });

  live('tokens are strictly increasing across successive grants', async () => {
    const lock = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const tokens: number[] = [];
    for (let i = 0; i < 5; i++) {
      const handle = await lock.acquire(CAMPAIGN, 5_000);
      tokens.push(handle!.fencingToken);
      await lock.release(CAMPAIGN);
    }
    expect(tokens).toEqual([...tokens].sort((x, y) => x - y));
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  live('a global lock never enters a tenant namespace', async () => {
    const lock = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const reconcile = globalLock('reconcile');
    await lock.acquire(reconcile, 5_000);

    const keys = await redis.keys('*');
    expect(keys).toContain(reconcile.key);
    expect(keys.filter(k => k.startsWith('tenant:'))).toHaveLength(0);
  });
});

describe('a decision write proves current lock ownership', () => {
  live('accepts the current holder', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const handle = await a.acquire(CAMPAIGN, 5_000);
    expect((await store().recordFenced(decision(), authorityOf(handle!))).accepted).toBe(true);
  });

  live('rejects a write after the lock expired, with no replacement holder', async () => {
    // The case a token comparison cannot see: NOTHING was written under a newer
    // token, because there is no newer token. Only the server's own expiry
    // makes this real, which is why it is here and not in a fake.
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const handle = await a.acquire(CAMPAIGN, 150);
    await sleep(300);

    const result = await store().recordFenced(decision(), authorityOf(handle!));
    expect(result.accepted).toBe(false);
    expect(result.rejection).toBe(DecisionRejection.LOCK_NOT_HELD);
  });

  live('rejects A when B acquired a higher token and never wrote', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const b = new RedisDistributedLock({ redis: asLock(), ownerId: 'B' });

    const handleA = await a.acquire(CAMPAIGN, 150);
    await sleep(300);
    const handleB = await b.acquire(CAMPAIGN, 5_000);
    expect(handleB!.fencingToken).toBeGreaterThan(handleA!.fencingToken);

    // B crashes here — it never writes.
    const late = await store().recordFenced(decision(), authorityOf(handleA!));
    expect(late.rejection).toBe(DecisionRejection.LOCK_NOT_HELD);
  });

  live('the paused replica loses to the one that took over and wrote', async () => {
    // The full race, with real elapsed time and real server-side expiry.
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const b = new RedisDistributedLock({ redis: asLock(), ownerId: 'B' });
    const s = store();

    const handleA = await a.acquire(CAMPAIGN, 200);
    await sleep(350);
    const handleB = await b.acquire(CAMPAIGN, 5_000);

    expect(
      (await s.recordFenced(decision({ recommendedOriginateCount: 99 }), authorityOf(handleB!)))
        .accepted
    ).toBe(true);
    expect(
      (await s.recordFenced(decision({ recommendedOriginateCount: 1 }), authorityOf(handleA!)))
        .accepted
    ).toBe(false);

    const survivors = await s.recent('live-tenant', 10, 'live-camp');
    expect(survivors).toHaveLength(1);
    expect(survivors[0].recommendedOriginateCount).toBe(99);
  });

  live('rejects the wrong owner presenting the right token', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const handle = await a.acquire(CAMPAIGN, 5_000);

    const result = await store().recordFenced(decision(), {
      fencingToken: handle!.fencingToken,
      lockValue: `B:${handle!.fencingToken}`,
    });
    expect(result.rejection).toBe(DecisionRejection.LOCK_NOT_HELD);
  });

  live('rejects the right owner presenting a stale token', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const handle = await a.acquire(CAMPAIGN, 5_000);

    const result = await store().recordFenced(decision(), {
      fencingToken: handle!.fencingToken - 1,
      lockValue: `A:${handle!.fencingToken - 1}`,
    });
    expect(result.rejection).toBe(DecisionRejection.LOCK_NOT_HELD);
  });

  live('rejects a token the fence counter has moved past', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const handle = await a.acquire(CAMPAIGN, 5_000);
    // Lock value agrees, but the counter has been bumped.
    await redis.set(CAMPAIGN.fenceKey, String(handle!.fencingToken + 5));

    const result = await store().recordFenced(decision(), authorityOf(handle!));
    expect(result.rejection).toBe(DecisionRejection.STALE_FENCING_TOKEN);
  });

  live('rejects a second decision in the same interval bucket', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const handle = await a.acquire(CAMPAIGN, 5_000);
    const s = store();

    expect(
      (await s.recordFenced(decision({ decidedAtMs: 1_000 }), authorityOf(handle!))).accepted
    ).toBe(true);
    const dup = await s.recordFenced(decision({ decidedAtMs: 1_050 }), authorityOf(handle!));
    expect(dup.rejection).toBe(DecisionRejection.DUPLICATE_INTERVAL);

    // A later interval is a different slot.
    expect(
      (await s.recordFenced(decision({ decidedAtMs: 2_050 }), authorityOf(handle!))).accepted
    ).toBe(true);
  });

  live('leaves another campaign entirely independent', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const other = campaignShadowLock('live-tenant', 'other-camp');

    const one = await a.acquire(CAMPAIGN, 5_000);
    const two = await a.acquire(other, 5_000);
    const s = store();

    expect((await s.recordFenced(decision(), authorityOf(one!))).accepted).toBe(true);
    expect(
      (await s.recordFenced(decision({ campaignId: 'other-camp' }), authorityOf(two!))).accepted
    ).toBe(true);
  });

  live('twelve concurrent writers under one authority produce one decision', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const handle = await a.acquire(CAMPAIGN, 5_000);
    const s = store();

    const results = await Promise.all(
      Array.from({ length: 12 }, () => s.recordFenced(decision(), authorityOf(handle!)))
    );
    expect(results.filter(r => r.accepted)).toHaveLength(1);
  });
});

describe('an unfiltered tenant query is answerable from a real keyspace', () => {
  live('merges every campaign without scanning the keyspace', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const s = store();

    for (const [campaignId, atMs] of [
      ['camp-1', 1_800_000_001_000],
      ['camp-2', 1_800_000_002_000],
    ] as const) {
      const handle = await a.acquire(campaignShadowLock('live-tenant', campaignId), 5_000);
      await s.recordFenced(decision({ campaignId, decidedAtMs: atMs }), authorityOf(handle!));
    }

    const all = await s.recent('live-tenant', 10);
    expect(all.map(d => d.campaignId).sort()).toEqual(['camp-1', 'camp-2']);
    expect(all[0].campaignId).toBe('camp-2');
  });

  live('never returns decisions belonging to another tenant', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const s = store();

    const handle = await a.acquire(campaignShadowLock('tenant-one', 'camp-1'), 5_000);
    await s.recordFenced(
      decision({ tenantId: 'tenant-one', campaignId: 'camp-1' }),
      authorityOf(handle!)
    );

    expect(await s.recent('tenant-two', 10)).toEqual([]);
  });
});

describe('dedupe against a real server', () => {
  live('SET NX PX admits exactly one of many concurrent markers', async () => {
    const dedupe = new RedisDedupeStore({ redis: asMinimal() });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => dedupe.markSeen('live-tenant', 'event-1', 5_000))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  live('a marker genuinely expires', async () => {
    const dedupe = new RedisDedupeStore({ redis: asMinimal() });
    expect(await dedupe.markSeen('live-tenant', 'event-ttl', 150)).toBe(true);
    await sleep(300);
    expect(await dedupe.markSeen('live-tenant', 'event-ttl', 150)).toBe(true);
  });
});

describe('tenant isolation on a real keyspace', () => {
  live('every key a tenant writes lives under that tenant', async () => {
    const a = new RedisDistributedLock({ redis: asLock(), ownerId: 'A' });
    const s = store();

    const handle = await a.acquire(campaignShadowLock('tenant-one', 'camp-1'), 5_000);
    await s.recordFenced(
      decision({ tenantId: 'tenant-one', campaignId: 'camp-1' }),
      authorityOf(handle!)
    );

    const foreign = (await redis.keys('*')).filter(
      k => !k.startsWith('tenant:tenant-one:') && !k.startsWith('dialer:v2:global:')
    );
    expect(foreign).toEqual([]);
  });
});
