/**
 * Lock tests against a fake that executes each script's semantics atomically.
 *
 * The fake is honest about the one property that matters: a script runs to
 * completion without interleaving, because that is what Redis guarantees and
 * what the correctness argument rests on. Timing, expiry, and genuine
 * concurrency are proven in `redis.live.test.ts` against a real server.
 */

import { describe, expect, it, vi } from 'vitest';

import { InvalidKeySegmentError } from '../config/redis-keys.js';

import {
  ACQUIRE_WITH_FENCE,
  campaignShadowLock,
  globalLock,
  NoOpLock,
  RedisDistributedLock,
  RELEASE_IF_OWNER,
  RENEW_IF_OWNER,
  type LockRedis,
} from './coordination.js';

/** A Redis whose EVAL implements the three scripts this module uses. */
function fakeRedis(store = new Map<string, string>(), expiries = new Map<string, number>()) {
  const redis: LockRedis & { store: Map<string, string>; expiries: Map<string, number> } = {
    store,
    expiries,
    get: key => Promise.resolve(store.get(key) ?? null),
    del: key => Promise.resolve(store.delete(key) ? 1 : 0),
    eval: (script, _numKeys, ...args) => {
      if (script === ACQUIRE_WITH_FENCE) {
        const [lockKey, fenceKey, ownerId, ttlMs, fenceTtlMs] = args;
        if (store.has(lockKey)) return Promise.resolve(0);
        const token = Number(store.get(fenceKey) ?? '0') + 1;
        store.set(fenceKey, String(token));
        expiries.set(fenceKey, Number(fenceTtlMs));
        store.set(lockKey, `${ownerId}:${token}`);
        expiries.set(lockKey, Number(ttlMs));
        return Promise.resolve(token);
      }
      if (script === RELEASE_IF_OWNER) {
        const [key, value] = args;
        if (store.get(key) === value) {
          store.delete(key);
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      }
      if (script === RENEW_IF_OWNER) {
        const [key, value, ttlMs] = args;
        if (store.get(key) !== value) return Promise.resolve(0);
        expiries.set(key, Number(ttlMs));
        return Promise.resolve(1);
      }
      throw new Error('unexpected script');
    },
  };
  return redis;
}

const CAMPAIGN = campaignShadowLock('tenant-a', 'camp-1');

describe('the fence advances only when the lock is granted', () => {
  it('does not burn a token on a failed acquisition', async () => {
    // This is the bug the previous INCR-then-SET-NX version had. B's failed
    // attempt moved the fence to 2, so A — the uninterrupted holder — was no
    // longer presenting the latest token and its own writes were refused. A
    // replica that never obtained the lock could starve the one that did,
    // simply by trying.
    const redis = fakeRedis();
    const a = new RedisDistributedLock({ redis, ownerId: 'A' });
    const b = new RedisDistributedLock({ redis, ownerId: 'B' });

    const held = await a.acquire(CAMPAIGN, 5_000);
    expect(held?.fencingToken).toBe(1);

    expect(await b.acquire(CAMPAIGN, 5_000)).toBeNull();

    expect(redis.store.get(CAMPAIGN.fenceKey)).toBe('1');
    expect(redis.store.get(CAMPAIGN.key)).toBe('A:1');
  });

  it('issues a strictly higher token on each successful acquisition', async () => {
    const redis = fakeRedis();
    const a = new RedisDistributedLock({ redis, ownerId: 'A' });

    const first = await a.acquire(CAMPAIGN, 5_000);
    await a.release(CAMPAIGN);
    const second = await a.acquire(CAMPAIGN, 5_000);

    expect(second!.fencingToken).toBeGreaterThan(first!.fencingToken);
  });
});

describe('the handle carries the exact stored value', () => {
  it('returns owner and token, matching what the lock key holds', async () => {
    // Reconstructing this string at the call site would let a formatting
    // difference turn a real ownership check into a string-equality accident.
    const redis = fakeRedis();
    const lock = new RedisDistributedLock({ redis, ownerId: 'replica-7' });

    const handle = await lock.acquire(CAMPAIGN, 5_000);
    expect(handle?.lockValue).toBe('replica-7:1');
    expect(redis.store.get(CAMPAIGN.key)).toBe(handle?.lockValue);
  });

  it('distinguishes two acquisitions by the same replica', async () => {
    // Two passes by one replica must be distinguishable, or a slow first pass
    // releases the second pass's lock.
    const redis = fakeRedis();
    const lock = new RedisDistributedLock({ redis, ownerId: 'A' });

    const first = await lock.acquire(CAMPAIGN, 5_000);
    await lock.release(CAMPAIGN);
    const second = await lock.acquire(CAMPAIGN, 5_000);

    expect(first?.lockValue).not.toBe(second?.lockValue);
  });
});

describe('release compares before deleting', () => {
  it('does not delete a lock another owner now holds', async () => {
    const redis = fakeRedis();
    const a = new RedisDistributedLock({ redis, ownerId: 'A' });
    await a.acquire(CAMPAIGN, 5_000);

    // A's lock expires and B takes it.
    redis.store.set(CAMPAIGN.key, 'B:2');
    await a.release(CAMPAIGN);

    expect(redis.store.get(CAMPAIGN.key)).toBe('B:2');
  });

  it('does nothing for a lock this replica never held', async () => {
    const redis = fakeRedis();
    const evalSpy = vi.spyOn(redis, 'eval');
    const lock = new RedisDistributedLock({ redis, ownerId: 'A' });

    await lock.release(CAMPAIGN);
    expect(evalSpy).not.toHaveBeenCalled();
  });
});

describe('renew stops believing in lost ownership', () => {
  it('returns false and forgets the lock once the value changed', async () => {
    const redis = fakeRedis();
    const lock = new RedisDistributedLock({ redis, ownerId: 'A' });
    await lock.acquire(CAMPAIGN, 5_000);

    redis.store.set(CAMPAIGN.key, 'B:2');
    expect(await lock.renew(CAMPAIGN, 5_000)).toBe(false);

    // Having forgotten it, a later release cannot delete B's lock either.
    await lock.release(CAMPAIGN);
    expect(redis.store.get(CAMPAIGN.key)).toBe('B:2');
  });
});

describe('acquisition fails closed', () => {
  it('returns null when Redis throws', async () => {
    // Skipping a pass costs one interval of history; running an uncoordinated
    // one corrupts it.
    const onFailure = vi.fn();
    const redis = fakeRedis();
    redis.eval = () => Promise.reject(new Error('down'));

    const lock = new RedisDistributedLock({ redis, ownerId: 'A', onFailure });
    expect(await lock.acquire(CAMPAIGN, 5_000)).toBeNull();
    expect(onFailure).toHaveBeenCalled();
  });
});

describe('lock keys are tenant-scoped and validated', () => {
  it('places a campaign lock inside its tenant namespace', () => {
    expect(CAMPAIGN.key).toBe('tenant:tenant-a:dialer:v2:campaign:camp-1:shadow:lock');
    expect(CAMPAIGN.fenceKey).toBe('tenant:tenant-a:dialer:v2:campaign:camp-1:shadow:fence');
  });

  it('keeps the global lock out of every tenant namespace', () => {
    expect(globalLock('reconcile').key).toBe('dialer:v2:global:lock:reconcile');
    expect(globalLock('reconcile').fenceKey).toBe('dialer:v2:global:lock:reconcile:fence');
  });

  it('refuses a campaign id containing a colon', () => {
    // Redis key segments are colon-delimited, so this would otherwise address
    // another campaign's lock — the runtime used to interpolate these directly.
    expect(() => campaignShadowLock('tenant-a', 'camp:evil:shadow:lock')).toThrow(
      InvalidKeySegmentError
    );
  });

  it('refuses braces, whitespace and glob characters', () => {
    for (const bad of ['camp{1}', 'camp 1', 'camp*', 'camp?', 'camp[1]', 'camp\\1', 'camp\n1']) {
      expect(() => campaignShadowLock('tenant-a', bad)).toThrow(InvalidKeySegmentError);
    }
  });

  it('refuses an oversized id', () => {
    expect(() => campaignShadowLock('tenant-a', 'c'.repeat(129))).toThrow(InvalidKeySegmentError);
  });

  it('refuses a reserved tenant id', () => {
    for (const bad of ['global', 'platform', 'admin', 'system', 'dialer', 'tenant']) {
      expect(() => campaignShadowLock(bad, 'camp-1')).toThrow(InvalidKeySegmentError);
    }
  });

  it('gives two tenants different keys for the same campaign id', async () => {
    const redis = fakeRedis();
    const lock = new RedisDistributedLock({ redis, ownerId: 'A' });

    const a = campaignShadowLock('tenant-a', 'camp-1');
    const b = campaignShadowLock('tenant-b', 'camp-1');
    expect(a.key).not.toBe(b.key);

    // Holding one leaves the other free.
    expect(await lock.acquire(a, 5_000)).not.toBeNull();
    expect(await lock.acquire(b, 5_000)).not.toBeNull();
  });
});

describe('the single-instance lock is honest about what it is', () => {
  it('reports that coordination is not distributed', async () => {
    const lock = new NoOpLock();
    expect(lock.distributed).toBe(false);
    // Still monotonic, so the fencing contract holds in a single process.
    const first = await lock.acquire(CAMPAIGN, 1_000);
    const second = await lock.acquire(CAMPAIGN, 1_000);
    expect(second!.fencingToken).toBeGreaterThan(first!.fencingToken);
  });
});
