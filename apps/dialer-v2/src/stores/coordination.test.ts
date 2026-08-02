import { describe, expect, it, vi } from 'vitest';

import {
  NoOpLock,
  RELEASE_IF_OWNER,
  RENEW_IF_OWNER,
  RedisDistributedLock,
  type LockRedis,
} from './coordination.js';

/**
 * A fake Redis that models the semantics the lock depends on: NX, PX expiry,
 * INCR, and — critically — `eval` executing the compare and the mutation as one
 * indivisible step.
 */
function fakeRedis(clock = { value: 0 }) {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const counters = new Map<string, number>();

  const live = (key: string): { value: string; expiresAt: number } | undefined => {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= clock.value) {
      store.delete(key);
      return undefined;
    }
    return entry;
  };

  const redis: LockRedis & { store: typeof store; expire: (k: string) => void } = {
    store,
    /** Force a key to expire, to simulate a lapsed TTL. */
    expire: (key: string) => store.delete(key),

    set: (key, value, _mode, ttlMs, _condition) => {
      if (live(key)) return Promise.resolve(null);
      store.set(key, { value, expiresAt: clock.value + ttlMs });
      return Promise.resolve('OK');
    },
    get: key => Promise.resolve(live(key)?.value ?? null),
    del: key => Promise.resolve(store.delete(key) ? 1 : 0),
    incr: key => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return Promise.resolve(next);
    },
    eval: (script, _numKeys, ...args) => {
      const [key, expected, ttl] = args;
      const entry = live(key);
      if (script === RELEASE_IF_OWNER) {
        if (entry?.value === expected) {
          store.delete(key);
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      }
      if (script === RENEW_IF_OWNER) {
        if (entry?.value === expected) {
          entry.expiresAt = clock.value + Number(ttl);
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      }
      return Promise.resolve(0);
    },
  };
  return redis;
}

describe('mutual exclusion', () => {
  it('lets exactly one replica acquire', async () => {
    const redis = fakeRedis();
    const a = new RedisDistributedLock({ redis, ownerId: 'replica-a' });
    const b = new RedisDistributedLock({ redis, ownerId: 'replica-b' });

    const [ha, hb] = await Promise.all([a.acquire('shadow', 5_000), b.acquire('shadow', 5_000)]);
    expect([ha, hb].filter(Boolean)).toHaveLength(1);
  });

  it('lets the next replica in after a release', async () => {
    const redis = fakeRedis();
    const a = new RedisDistributedLock({ redis, ownerId: 'replica-a' });
    const b = new RedisDistributedLock({ redis, ownerId: 'replica-b' });

    expect(await a.acquire('shadow', 5_000)).not.toBeNull();
    await a.release('shadow');
    expect(await b.acquire('shadow', 5_000)).not.toBeNull();
  });
});

describe('release is atomic and ownership-checked', () => {
  it('does not delete a lock another replica now owns', async () => {
    // The exact race the Lua script exists to close:
    //   A acquires -> A's TTL lapses -> B acquires -> A releases
    // With GET-then-DEL, A's delete would destroy B's valid lock.
    const clock = { value: 0 };
    const redis = fakeRedis(clock);
    const a = new RedisDistributedLock({ redis, ownerId: 'replica-a' });
    const b = new RedisDistributedLock({ redis, ownerId: 'replica-b' });

    expect(await a.acquire('shadow', 1_000)).not.toBeNull();
    clock.value = 2_000; // A's lock has expired
    const bHandle = await b.acquire('shadow', 5_000);
    expect(bHandle).not.toBeNull();

    await a.release('shadow');

    // B must still hold it.
    const current = await redis.get('dialer:v2:global:lock:shadow');
    expect(current).toContain('replica-b');
  });

  it('uses a single eval rather than GET then DEL', async () => {
    const redis = fakeRedis();
    const evalSpy = vi.spyOn(redis, 'eval');
    const getSpy = vi.spyOn(redis, 'get');
    const delSpy = vi.spyOn(redis, 'del');

    const lock = new RedisDistributedLock({ redis, ownerId: 'a' });
    await lock.acquire('shadow', 5_000);
    await lock.release('shadow');

    expect(evalSpy).toHaveBeenCalledWith(
      RELEASE_IF_OWNER,
      1,
      expect.any(String),
      expect.any(String)
    );
    expect(getSpy).not.toHaveBeenCalled();
    expect(delSpy).not.toHaveBeenCalled();
  });

  it('does not release a lock it never held', async () => {
    const redis = fakeRedis();
    const a = new RedisDistributedLock({ redis, ownerId: 'replica-a' });
    const b = new RedisDistributedLock({ redis, ownerId: 'replica-b' });

    await a.acquire('shadow', 5_000);
    await b.release('shadow'); // B never acquired it

    expect(await redis.get('dialer:v2:global:lock:shadow')).toContain('replica-a');
  });

  it('distinguishes two acquisitions by the SAME replica', async () => {
    // Without the fencing token in the stored value, a slow first pass could
    // release the second pass's lock.
    const clock = { value: 0 };
    const redis = fakeRedis(clock);
    const lock = new RedisDistributedLock({ redis, ownerId: 'replica-a' });

    const first = await lock.acquire('shadow', 1_000);
    clock.value = 2_000;
    const second = await lock.acquire('shadow', 5_000);

    expect(first?.fencingToken).toBeLessThan(second!.fencingToken);
    expect(await redis.get('dialer:v2:global:lock:shadow')).toContain(String(second!.fencingToken));
  });
});

describe('renewal for long passes', () => {
  it('extends the lock while the holder is still working', async () => {
    const clock = { value: 0 };
    const redis = fakeRedis(clock);
    const lock = new RedisDistributedLock({ redis, ownerId: 'a' });

    await lock.acquire('shadow', 1_000);
    clock.value = 900;
    expect(await lock.renew('shadow', 1_000)).toBe(true);

    clock.value = 1_500; // would have expired without the renewal
    expect(await redis.get('dialer:v2:global:lock:shadow')).not.toBeNull();
  });

  it('reports false once ownership has been lost', async () => {
    const clock = { value: 0 };
    const redis = fakeRedis(clock);
    const a = new RedisDistributedLock({ redis, ownerId: 'replica-a' });
    const b = new RedisDistributedLock({ redis, ownerId: 'replica-b' });

    await a.acquire('shadow', 1_000);
    clock.value = 2_000;
    await b.acquire('shadow', 5_000);

    expect(await a.renew('shadow', 1_000)).toBe(false);
  });

  it('stops attempting release after ownership is lost', async () => {
    const clock = { value: 0 };
    const redis = fakeRedis(clock);
    const a = new RedisDistributedLock({ redis, ownerId: 'replica-a' });

    await a.acquire('shadow', 1_000);
    clock.value = 2_000;
    await a.renew('shadow', 1_000); // false, drops the held entry

    const evalSpy = vi.spyOn(redis, 'eval');
    await a.release('shadow');
    expect(evalSpy).not.toHaveBeenCalled();
  });

  it('recovers after a replica dies without releasing', async () => {
    const clock = { value: 0 };
    const redis = fakeRedis(clock);
    const dead = new RedisDistributedLock({ redis, ownerId: 'dead' });
    const alive = new RedisDistributedLock({ redis, ownerId: 'alive' });

    await dead.acquire('shadow', 1_000);
    // No release — the process is gone. The TTL is the recovery mechanism.
    clock.value = 1_500;
    expect(await alive.acquire('shadow', 5_000)).not.toBeNull();
  });
});

describe('failure handling', () => {
  it('fails closed when Redis is unreachable', async () => {
    const broken: LockRedis = {
      set: () => Promise.reject(new Error('down')),
      get: () => Promise.reject(new Error('down')),
      del: () => Promise.reject(new Error('down')),
      eval: () => Promise.reject(new Error('down')),
      incr: () => Promise.reject(new Error('down')),
    };
    const onFailure = vi.fn();
    const lock = new RedisDistributedLock({ redis: broken, ownerId: 'a', onFailure });

    expect(await lock.acquire('shadow', 5_000)).toBeNull();
    expect(onFailure).toHaveBeenCalledWith('lock.acquire', expect.any(Error));
  });
});

describe('single-instance fallback', () => {
  it('always grants and reports that it is not distributed', async () => {
    const lock = new NoOpLock();
    expect(lock.distributed).toBe(false);
    expect(await lock.acquire('shadow', 1_000)).not.toBeNull();
    expect(await lock.renew('shadow', 1_000)).toBe(true);
  });

  it('issues increasing fencing tokens', async () => {
    const lock = new NoOpLock();
    const a = await lock.acquire('shadow', 1_000);
    const b = await lock.acquire('shadow', 1_000);
    expect(b!.fencingToken).toBeGreaterThan(a!.fencingToken);
  });
});
