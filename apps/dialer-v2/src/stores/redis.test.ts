import { describe, expect, it, vi } from 'vitest';

import type { ShadowDecisionRecord } from '../shadow/engine.js';

import { RedisDedupeStore, RedisShadowDecisionStore, type MinimalRedis } from './redis.js';

/** A fake Redis implementing the exact NX/PX semantics the store relies on. */
function fakeRedis(): MinimalRedis & { store: Map<string, string>; lists: Map<string, string[]> } {
  const store = new Map<string, string>();
  const lists = new Map<string, string[]>();
  return {
    store,
    lists,
    set: (key, value, _mode, _ttl, _condition) => {
      if (store.has(key)) return Promise.resolve(null);
      store.set(key, value);
      return Promise.resolve('OK');
    },
    lpush: (key, value) => {
      const list = lists.get(key) ?? [];
      list.unshift(value);
      lists.set(key, list);
      return Promise.resolve(list.length);
    },
    ltrim: (key, start, stop) => {
      const list = lists.get(key) ?? [];
      lists.set(key, list.slice(start, stop + 1));
      return Promise.resolve('OK');
    },
    lrange: (key, start, stop) => Promise.resolve((lists.get(key) ?? []).slice(start, stop + 1)),
    pexpire: () => Promise.resolve(1),
  };
}

function brokenRedis(): MinimalRedis {
  const fail = () => Promise.reject(new Error('ECONNREFUSED'));
  return {
    set: fail as MinimalRedis['set'],
    lpush: fail as MinimalRedis['lpush'],
    ltrim: fail as MinimalRedis['ltrim'],
    lrange: fail as MinimalRedis['lrange'],
    pexpire: fail as MinimalRedis['pexpire'],
  };
}

describe('cross-instance deduplication', () => {
  it('lets exactly one caller win for a given event', async () => {
    const redis = fakeRedis();
    const store = new RedisDedupeStore({ redis });

    expect(await store.markSeen('tenant-a', 'evt-1', 1000)).toBe(true);
    expect(await store.markSeen('tenant-a', 'evt-1', 1000)).toBe(false);
  });

  it('prevents two replicas from both processing the same event', async () => {
    // The whole reason this store exists: with in-memory dedupe, both replicas
    // accept the event and every count is doubled.
    const redis = fakeRedis();
    const replicaA = new RedisDedupeStore({ redis });
    const replicaB = new RedisDedupeStore({ redis });

    const results = await Promise.all([
      replicaA.markSeen('tenant-a', 'evt-shared', 1000),
      replicaB.markSeen('tenant-a', 'evt-shared', 1000),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('scopes keys per tenant so two tenants can share an event id', async () => {
    const redis = fakeRedis();
    const store = new RedisDedupeStore({ redis });

    expect(await store.markSeen('tenant-a', 'evt-1', 1000)).toBe(true);
    expect(await store.markSeen('tenant-b', 'evt-1', 1000)).toBe(true);

    for (const key of redis.store.keys()) {
      expect(key.startsWith('tenant:')).toBe(true);
      expect(key).toContain(':dialer:v2:events:dedupe:');
    }
  });

  it('refuses to build a key from an unusable tenant id', async () => {
    const redis = fakeRedis();
    const store = new RedisDedupeStore({ redis });

    for (const bad of ['global', 'platform', 'a:b', '', 'x*']) {
      expect(await store.markSeen(bad, 'evt-1', 1000)).toBe(false);
    }
    expect(redis.store.size).toBe(0);
  });

  it('fails closed when Redis is down', async () => {
    // An event whose uniqueness cannot be established is dropped rather than
    // double-counted: corrupting abandonment maths is worse than losing a row.
    const onFailure = vi.fn();
    const store = new RedisDedupeStore({ redis: brokenRedis(), onFailure });

    expect(await store.markSeen('tenant-a', 'evt-1', 1000)).toBe(false);
    expect(store.isHealthy()).toBe(false);
    expect(onFailure).toHaveBeenCalledWith('dedupe.markSeen', expect.any(Error));
  });

  it('recovers health once Redis returns', async () => {
    const redis = fakeRedis();
    const store = new RedisDedupeStore({ redis });
    await store.markSeen('tenant-a', 'evt-1', 1000);
    expect(store.isHealthy()).toBe(true);
  });
});

function decision(overrides: Partial<ShadowDecisionRecord> = {}): ShadowDecisionRecord {
  return {
    tenantId: 'tenant-a',
    campaignId: 'camp-1',
    decidedAtMs: 1,
    controllerVersion: '1.1.0',
    inputs: {} as ShadowDecisionRecord['inputs'],
    decision: null,
    recommendedOriginateCount: 3,
    bindingConstraint: 'AGENT_CAPACITY',
    degradationMode: 'PREDICTIVE',
    safetyReasons: [],
    blockedBy: [],
    originated: false,
    explanation: 'would place 3 calls',
    ...overrides,
  };
}

describe('shadow decision persistence', () => {
  it('stores and reads back decisions for a campaign', async () => {
    const store = new RedisShadowDecisionStore({ redis: fakeRedis() });
    await store.record(decision());
    await store.record(decision({ decidedAtMs: 2 }));

    const recent = await store.recent('tenant-a', 10, 'camp-1');
    expect(recent).toHaveLength(2);
    expect(recent[0].decidedAtMs).toBe(2);
  });

  it('caps stored history per campaign', async () => {
    const redis = fakeRedis();
    const store = new RedisShadowDecisionStore({ redis }, 5);
    for (let i = 0; i < 20; i++) await store.record(decision({ decidedAtMs: i }));

    expect(await store.recent('tenant-a', 100, 'camp-1')).toHaveLength(5);
  });

  it('never returns another tenant records, even if the key were poisoned', async () => {
    const redis = fakeRedis();
    const store = new RedisShadowDecisionStore({ redis });
    await store.record(decision());
    // Simulate a corrupted or cross-written entry landing in this tenant's list.
    await redis.lpush(
      'tenant:tenant-a:dialer:v2:campaign:camp-1:shadow',
      JSON.stringify(decision({ tenantId: 'tenant-b' }))
    );

    const recent = await store.recent('tenant-a', 10, 'camp-1');
    expect(recent.every(d => d.tenantId === 'tenant-a')).toBe(true);
  });

  it('drops any record claiming a call was originated', async () => {
    const redis = fakeRedis();
    const store = new RedisShadowDecisionStore({ redis });
    await redis.lpush(
      'tenant:tenant-a:dialer:v2:campaign:camp-1:shadow',
      JSON.stringify({ ...decision(), originated: true })
    );

    expect(await store.recent('tenant-a', 10, 'camp-1')).toHaveLength(0);
  });

  it('skips a corrupt entry rather than throwing', async () => {
    const redis = fakeRedis();
    const store = new RedisShadowDecisionStore({ redis });
    await store.record(decision());
    await redis.lpush('tenant:tenant-a:dialer:v2:campaign:camp-1:shadow', 'not-json{{');

    const recent = await store.recent('tenant-a', 10, 'camp-1');
    expect(recent).toHaveLength(1);
  });

  it('returns empty without a campaign rather than scanning the keyspace', async () => {
    const store = new RedisShadowDecisionStore({ redis: fakeRedis() });
    await store.record(decision());
    expect(await store.recent('tenant-a', 10)).toEqual([]);
  });

  it('degrades to empty when Redis is down, and reports it', async () => {
    const onFailure = vi.fn();
    const store = new RedisShadowDecisionStore({ redis: brokenRedis(), onFailure });

    await store.record(decision());
    expect(store.isHealthy()).toBe(false);
    expect(await store.recent('tenant-a', 10, 'camp-1')).toEqual([]);
    expect(onFailure).toHaveBeenCalled();
  });

  it('refuses an unusable tenant id', async () => {
    const redis = fakeRedis();
    const store = new RedisShadowDecisionStore({ redis });
    await store.record(decision({ tenantId: 'global' }));
    expect(redis.lists.size).toBe(0);
  });
});
