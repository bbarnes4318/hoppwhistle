/**
 * Fenced decision writes.
 *
 * The fake below executes ACCEPT_FENCED_DECISION's semantics as one step,
 * because atomicity is the property the argument rests on. The eight ownership
 * cases are asserted here and again in `redis.live.test.ts` against a real
 * server with real expiry — a fake cannot show that an expired key genuinely
 * disappears, and that is the case the whole rule turns on.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  campaignDecisionBucketKey,
  campaignShadowFenceKey,
  campaignShadowLockKey,
  shadowDecisionIndexKey,
  shadowDecisionKey,
} from '../config/redis-keys.js';
import { CONTROLLER_VERSION, type ShadowDecisionRecord } from '../shadow/engine.js';

import {
  ACCEPT_FENCED_DECISION,
  DecisionRejection,
  FencedShadowDecisionStore,
  type FencedRedis,
} from './fenced-decisions.js';

const TENANT = 'tenant-a';
const CAMPAIGN = 'camp-1';
const INTERVAL = 1_000;

function decision(over: Partial<ShadowDecisionRecord> = {}): ShadowDecisionRecord {
  return {
    tenantId: TENANT,
    campaignId: CAMPAIGN,
    decidedAtMs: 1_700_000_000_000,
    controllerVersion: CONTROLLER_VERSION,
    inputs: {} as ShadowDecisionRecord['inputs'],
    decision: null,
    recommendedOriginateCount: 0,
    bindingConstraint: 'NONE',
    degradationMode: 'PREDICTIVE',
    safetyReasons: [],
    blockedBy: [],
    originated: false,
    explanation: '',
    ...over,
  };
}

/** Executes the accept script's semantics in one step, as Redis does. */
function fakeRedis() {
  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const zsets = new Map<string, Map<string, number>>();

  const redis: FencedRedis & {
    strings: Map<string, string>;
    lists: Map<string, string[]>;
    zsets: Map<string, Map<string, number>>;
  } = {
    strings,
    lists,
    zsets,
    lrange: (key, start, stop) =>
      Promise.resolve((lists.get(key) ?? []).slice(start, stop === -1 ? undefined : stop + 1)),
    zrevrange: key => {
      const z = zsets.get(key);
      if (!z) return Promise.resolve([]);
      return Promise.resolve(
        [...z.entries()].sort((a, b) => b[1] - a[1]).map(([member]) => member)
      );
    },
    eval: (script, _numKeys, ...args) => {
      if (script !== ACCEPT_FENCED_DECISION) throw new Error('unexpected script');
      const [lockKey, fenceKey, bucketKey, listKey, indexKey] = args;
      const [expectedLockValue, token, payload, maxLen, , , campaignId, decidedAtMs] =
        args.slice(5);

      const held = strings.get(lockKey);
      if (held === undefined || held !== expectedLockValue) return Promise.resolve(0);

      const fence = strings.get(fenceKey);
      if (fence === undefined || fence !== token) return Promise.resolve(-2);

      if (strings.has(bucketKey)) return Promise.resolve(-1);

      strings.set(bucketKey, token);
      const list = lists.get(listKey) ?? [];
      list.unshift(payload);
      lists.set(listKey, list.slice(0, Number(maxLen)));

      const z = zsets.get(indexKey) ?? new Map<string, number>();
      z.set(campaignId, Number(decidedAtMs));
      zsets.set(indexKey, z);
      return Promise.resolve(1);
    },
  };
  return redis;
}

/** Put a lock in place, as ACQUIRE_WITH_FENCE would. */
function grant(redis: ReturnType<typeof fakeRedis>, owner: string, token: number): string {
  const value = `${owner}:${token}`;
  redis.strings.set(campaignShadowLockKey(TENANT, CAMPAIGN), value);
  redis.strings.set(campaignShadowFenceKey(TENANT, CAMPAIGN), String(token));
  return value;
}

function store(redis: FencedRedis, over = {}) {
  return new FencedShadowDecisionStore({ redis, intervalMs: INTERVAL, ...over });
}

describe('a write must prove it still holds the lock', () => {
  it('accepts a write from the current holder', async () => {
    const redis = fakeRedis();
    const lockValue = grant(redis, 'A', 7);

    const result = await store(redis).recordFenced(decision(), {
      fencingToken: 7,
      lockValue,
    });
    expect(result.accepted).toBe(true);
  });

  it('rejects a write when the lock expired and nobody replaced it', async () => {
    // The case a token comparison cannot see. Nothing was written under a newer
    // token — there IS no newer token — yet this replica demonstrably no longer
    // holds the lock. `>= last accepted token` accepted this.
    const redis = fakeRedis();
    const lockValue = grant(redis, 'A', 7);
    redis.strings.delete(campaignShadowLockKey(TENANT, CAMPAIGN));

    const result = await store(redis).recordFenced(decision(), {
      fencingToken: 7,
      lockValue,
    });
    expect(result.accepted).toBe(false);
    expect(result.rejection).toBe(DecisionRejection.LOCK_NOT_HELD);
  });

  it('rejects A when B acquired a higher token and then crashed before writing', async () => {
    // No decision was ever written under token 8, so a rule phrased in terms of
    // what has been WRITTEN sees nothing and lets A through.
    const redis = fakeRedis();
    const aValue = grant(redis, 'A', 7);
    grant(redis, 'B', 8);

    const result = await store(redis).recordFenced(decision(), {
      fencingToken: 7,
      lockValue: aValue,
    });
    expect(result.accepted).toBe(false);
    expect(result.rejection).toBe(DecisionRejection.LOCK_NOT_HELD);
    expect(redis.lists.get(shadowDecisionKey(TENANT, CAMPAIGN))).toBeUndefined();
  });

  it('rejects A after B acquired and wrote', async () => {
    const redis = fakeRedis();
    const aValue = grant(redis, 'A', 7);
    const bValue = grant(redis, 'B', 8);

    const s = store(redis);
    expect(
      (
        await s.recordFenced(decision({ recommendedOriginateCount: 99 }), {
          fencingToken: 8,
          lockValue: bValue,
        })
      ).accepted
    ).toBe(true);

    const late = await s.recordFenced(decision({ recommendedOriginateCount: 1 }), {
      fencingToken: 7,
      lockValue: aValue,
    });
    expect(late.accepted).toBe(false);

    // Only B's decision survives.
    const survivors = await s.recent(TENANT, 10, CAMPAIGN);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].recommendedOriginateCount).toBe(99);
  });

  it('rejects the wrong owner presenting the correct token', async () => {
    const redis = fakeRedis();
    grant(redis, 'A', 7);

    const result = await store(redis).recordFenced(decision(), {
      fencingToken: 7,
      lockValue: 'B:7',
    });
    expect(result.rejection).toBe(DecisionRejection.LOCK_NOT_HELD);
  });

  it('rejects the correct owner presenting a stale token', async () => {
    const redis = fakeRedis();
    grant(redis, 'A', 7);

    const result = await store(redis).recordFenced(decision(), {
      fencingToken: 6,
      lockValue: 'A:6',
    });
    expect(result.rejection).toBe(DecisionRejection.LOCK_NOT_HELD);
  });

  it('rejects a token that is no longer the latest the fence issued', async () => {
    // Lock value and presented value agree, but the counter has moved on.
    const redis = fakeRedis();
    const lockValue = grant(redis, 'A', 7);
    redis.strings.set(campaignShadowFenceKey(TENANT, CAMPAIGN), '9');

    const result = await store(redis).recordFenced(decision(), {
      fencingToken: 7,
      lockValue,
    });
    expect(result.rejection).toBe(DecisionRejection.STALE_FENCING_TOKEN);
  });

  it('rejects a second decision in the same interval bucket', async () => {
    const redis = fakeRedis();
    const lockValue = grant(redis, 'A', 7);
    const s = store(redis);

    expect((await s.recordFenced(decision(), { fencingToken: 7, lockValue })).accepted).toBe(true);
    const second = await s.recordFenced(decision({ decidedAtMs: 1_700_000_000_400 }), {
      fencingToken: 7,
      lockValue,
    });
    expect(second.rejection).toBe(DecisionRejection.DUPLICATE_INTERVAL);
  });

  it('treats a different controller version as a different slot', async () => {
    // A deliberate controller upgrade inside one interval is not a duplicate.
    const redis = fakeRedis();
    const lockValue = grant(redis, 'A', 7);
    const s = store(redis);

    await s.recordFenced(decision(), { fencingToken: 7, lockValue });
    const upgraded = await s.recordFenced(decision({ controllerVersion: '9.9.9' }), {
      fencingToken: 7,
      lockValue,
    });
    expect(upgraded.accepted).toBe(true);
  });

  it('leaves a different campaign entirely unaffected', async () => {
    const redis = fakeRedis();
    grant(redis, 'A', 7);
    // A lock for the other campaign, held by a different replica.
    redis.strings.set(campaignShadowLockKey(TENANT, 'camp-2'), 'B:1');
    redis.strings.set(campaignShadowFenceKey(TENANT, 'camp-2'), '1');

    const result = await store(redis).recordFenced(decision({ campaignId: 'camp-2' }), {
      fencingToken: 1,
      lockValue: 'B:1',
    });
    expect(result.accepted).toBe(true);
  });
});

describe('an unfenced write is refused outright', () => {
  it('rejects record() rather than falling back', async () => {
    // Accepting an untokened write here would quietly reintroduce the race the
    // class exists to close.
    const onRejection = vi.fn();
    const s = store(fakeRedis(), { onRejection });

    await expect(s.record(decision())).rejects.toThrow(/recordFenced/);
    expect(onRejection).toHaveBeenCalledWith(DecisionRejection.UNFENCED_WRITE, expect.anything());
    expect(s.metrics().unfencedRejections).toBe(1);
  });
});

describe('failures fail closed', () => {
  it('reports the store unavailable rather than writing unfenced', async () => {
    const redis = fakeRedis();
    redis.eval = () => Promise.reject(new Error('down'));

    const result = await store(redis).recordFenced(decision(), {
      fencingToken: 1,
      lockValue: 'A:1',
    });
    expect(result.rejection).toBe(DecisionRejection.STORE_UNAVAILABLE);
  });

  it('refuses a tenant that cannot form a key', async () => {
    const result = await store(fakeRedis()).recordFenced(decision({ tenantId: 'global' }), {
      fencingToken: 1,
      lockValue: 'A:1',
    });
    expect(result.rejection).toBe(DecisionRejection.INVALID_TENANT);
  });

  it('refuses a campaign id that cannot form a key', async () => {
    const result = await store(fakeRedis()).recordFenced(decision({ campaignId: 'camp:evil' }), {
      fencingToken: 1,
      lockValue: 'A:1',
    });
    expect(result.rejection).toBe(DecisionRejection.INVALID_TENANT);
  });
});

describe('an unfiltered query is answerable', () => {
  it('merges every campaign the tenant has recorded', async () => {
    // The previous store returned [] here, which reads identically to "this
    // tenant has never recorded a decision".
    const redis = fakeRedis();
    const s = store(redis);

    for (const [campaignId, atMs] of [
      ['camp-1', 1_700_000_001_000],
      ['camp-2', 1_700_000_002_000],
    ] as const) {
      const value = `A:1`;
      redis.strings.set(campaignShadowLockKey(TENANT, campaignId), value);
      redis.strings.set(campaignShadowFenceKey(TENANT, campaignId), '1');
      await s.recordFenced(decision({ campaignId, decidedAtMs: atMs }), {
        fencingToken: 1,
        lockValue: value,
      });
    }

    const all = await s.recent(TENANT, 10);
    expect(all.map(d => d.campaignId).sort()).toEqual(['camp-1', 'camp-2']);
    // Newest first across campaigns, not merely within one.
    expect(all[0].campaignId).toBe('camp-2');
  });

  it('reports truncation rather than silently capping', async () => {
    const redis = fakeRedis();
    const onTruncated = vi.fn();
    const s = store(redis, { maxCampaignsPerTenantQuery: 1, onTruncated });

    const z = new Map<string, number>([
      ['camp-1', 1],
      ['camp-2', 2],
    ]);
    redis.zsets.set(shadowDecisionIndexKey(TENANT), z);

    await s.recent(TENANT, 10);
    expect(onTruncated).toHaveBeenCalledWith(TENANT, 1, 2);
  });

  it('never surfaces a record claiming a call was placed', async () => {
    const redis = fakeRedis();
    redis.lists.set(shadowDecisionKey(TENANT, CAMPAIGN), [
      JSON.stringify({ ...decision(), originated: true }),
      JSON.stringify(decision()),
    ]);

    expect(await store(redis).recent(TENANT, 10, CAMPAIGN)).toHaveLength(1);
  });

  it('skips a corrupt entry instead of failing the whole read', async () => {
    const redis = fakeRedis();
    redis.lists.set(shadowDecisionKey(TENANT, CAMPAIGN), ['{not json', JSON.stringify(decision())]);
    expect(await store(redis).recent(TENANT, 10, CAMPAIGN)).toHaveLength(1);
  });
});

describe('the bucket key identifies one decision slot', () => {
  it('gives the same key for two moments inside one interval', () => {
    const a = campaignDecisionBucketKey(TENANT, CAMPAIGN, '1.0.0', 1_000, INTERVAL);
    const b = campaignDecisionBucketKey(TENANT, CAMPAIGN, '1.0.0', 1_999, INTERVAL);
    expect(a).toBe(b);
  });

  it('gives different keys across an interval boundary', () => {
    const a = campaignDecisionBucketKey(TENANT, CAMPAIGN, '1.0.0', 1_999, INTERVAL);
    const b = campaignDecisionBucketKey(TENANT, CAMPAIGN, '1.0.0', 2_000, INTERVAL);
    expect(a).not.toBe(b);
  });
});
