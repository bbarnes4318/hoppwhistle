import { describe, expect, it, vi } from 'vitest';

import type { ShadowDecisionRecord } from '../shadow/engine.js';

import {
  ACCEPT_FENCED_DECISION,
  DecisionRejection,
  FencedShadowDecisionStore,
  decisionBucketKey,
  type FencedRedis,
} from './fenced-decisions.js';

const T0 = 1_800_000_000_000;
const INTERVAL = 1_000;

/**
 * Fake Redis that executes ACCEPT_FENCED_DECISION with the same semantics the
 * real script has — in particular, the compare and the write are one step.
 */
function fakeRedis(clock = { value: T0 }) {
  const strings = new Map<string, { value: string; expiresAt: number }>();
  const lists = new Map<string, string[]>();

  const live = (k: string) => {
    const e = strings.get(k);
    if (!e) return undefined;
    if (e.expiresAt > 0 && e.expiresAt <= clock.value) {
      strings.delete(k);
      return undefined;
    }
    return e;
  };

  const redis: FencedRedis & { lists: typeof lists; strings: typeof strings } = {
    lists,
    strings,
    eval: (script, _numKeys, ...args) => {
      if (script !== ACCEPT_FENCED_DECISION) return Promise.resolve(0);
      const [fenceKey, bucketKey, listKey, token, payload, maxLen, historyTtl, bucketTtl] = args;

      const last = live(fenceKey)?.value;
      if (last !== undefined && Number(last) > Number(token)) return Promise.resolve(0);
      if (live(bucketKey)) return Promise.resolve(-1);

      strings.set(fenceKey, { value: token, expiresAt: 0 });
      strings.set(bucketKey, { value: token, expiresAt: clock.value + Number(bucketTtl) });

      const list = lists.get(listKey) ?? [];
      list.unshift(payload);
      lists.set(listKey, list.slice(0, Number(maxLen)));
      void historyTtl;
      return Promise.resolve(1);
    },
    lrange: (key, start, stop) => Promise.resolve((lists.get(key) ?? []).slice(start, stop + 1)),
  };
  return redis;
}

function decision(overrides: Partial<ShadowDecisionRecord> = {}): ShadowDecisionRecord {
  return {
    tenantId: 'tenant-a',
    campaignId: 'camp-1',
    decidedAtMs: T0,
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

function store(redis: FencedRedis, onRejection = vi.fn()) {
  return {
    onRejection,
    store: new FencedShadowDecisionStore({ redis, intervalMs: INTERVAL, onRejection }),
  };
}

describe('the pause-resume race', () => {
  it('rejects a stale write from a replica that resumed after losing its lock', async () => {
    // 1. A renews and genuinely holds the lock.
    // 2. A pauses inside evaluate().
    // 3. A's lock expires.
    // 4. B acquires with a higher token and writes.
    // 5. A resumes and tries to write. This must be refused.
    const redis = fakeRedis();
    const { store: s } = store(redis);

    const replicaAToken = 7;
    const replicaBToken = 8;

    const b = await s.recordFenced(
      decision({ recommendedOriginateCount: 99, decidedAtMs: T0 + 1 }),
      replicaBToken
    );
    expect(b.accepted).toBe(true);

    const a = await s.recordFenced(
      decision({ recommendedOriginateCount: 3, decidedAtMs: T0 + 2_000 }),
      replicaAToken
    );

    expect(a.accepted).toBe(false);
    expect(a.rejection).toBe(DecisionRejection.STALE_FENCING_TOKEN);

    // Only B's decision survives.
    const recent = await s.recent('tenant-a', 10, 'camp-1');
    expect(recent).toHaveLength(1);
    expect(recent[0].recommendedOriginateCount).toBe(99);
  });

  it('counts stale-token rejections', async () => {
    const { store: s } = store(fakeRedis());
    await s.recordFenced(decision({ decidedAtMs: T0 }), 5);
    await s.recordFenced(decision({ decidedAtMs: T0 + 2_000 }), 2);
    await s.recordFenced(decision({ decidedAtMs: T0 + 4_000 }), 1);

    expect(s.metrics().staleTokenRejections).toBe(2);
  });

  it('accepts an equal token, because a renewing holder keeps its own', async () => {
    const { store: s } = store(fakeRedis());
    expect((await s.recordFenced(decision({ decidedAtMs: T0 }), 5)).accepted).toBe(true);
    expect((await s.recordFenced(decision({ decidedAtMs: T0 + 2_000 }), 5)).accepted).toBe(true);
  });
});

describe('one decision per campaign per interval', () => {
  it('refuses a second decision in the same bucket', async () => {
    const { store: s } = store(fakeRedis());
    expect((await s.recordFenced(decision({ decidedAtMs: T0 + 10 }), 1)).accepted).toBe(true);

    const dup = await s.recordFenced(decision({ decidedAtMs: T0 + 900 }), 2);
    expect(dup.accepted).toBe(false);
    expect(dup.rejection).toBe(DecisionRejection.DUPLICATE_INTERVAL);
    expect(s.metrics().duplicateIntervalRejections).toBe(1);
  });

  it('accepts the next interval', async () => {
    const { store: s } = store(fakeRedis());
    await s.recordFenced(decision({ decidedAtMs: T0 }), 1);
    expect((await s.recordFenced(decision({ decidedAtMs: T0 + INTERVAL }), 2)).accepted).toBe(true);
  });

  it('keys the bucket on tenant, campaign, controller version, and interval', () => {
    const a = decisionBucketKey('tenant-a', 'camp-1', '1.1.0', T0, INTERVAL);

    expect(decisionBucketKey('tenant-b', 'camp-1', '1.1.0', T0, INTERVAL)).not.toBe(a);
    expect(decisionBucketKey('tenant-a', 'camp-2', '1.1.0', T0, INTERVAL)).not.toBe(a);
    // A deliberate controller upgrade is not a duplicate.
    expect(decisionBucketKey('tenant-a', 'camp-1', '2.0.0', T0, INTERVAL)).not.toBe(a);
    expect(decisionBucketKey('tenant-a', 'camp-1', '1.1.0', T0 + INTERVAL, INTERVAL)).not.toBe(a);
    // Same bucket within the interval.
    expect(decisionBucketKey('tenant-a', 'camp-1', '1.1.0', T0 + 999, INTERVAL)).toBe(a);
  });

  it('lets different campaigns write in the same interval', async () => {
    const { store: s } = store(fakeRedis());
    expect((await s.recordFenced(decision({ campaignId: 'camp-1' }), 1)).accepted).toBe(true);
    expect((await s.recordFenced(decision({ campaignId: 'camp-2' }), 1)).accepted).toBe(true);
  });

  it('lets different tenants write in the same interval', async () => {
    const { store: s } = store(fakeRedis());
    expect((await s.recordFenced(decision({ tenantId: 'tenant-a' }), 1)).accepted).toBe(true);
    expect((await s.recordFenced(decision({ tenantId: 'tenant-b' }), 1)).accepted).toBe(true);
  });
});

describe('two replicas racing the same interval', () => {
  it('accepts exactly one', async () => {
    const redis = fakeRedis();
    const { store: s } = store(redis);

    const results = await Promise.all([
      s.recordFenced(decision({ recommendedOriginateCount: 1 }), 10),
      s.recordFenced(decision({ recommendedOriginateCount: 2 }), 11),
    ]);

    expect(results.filter(r => r.accepted)).toHaveLength(1);
    expect(await s.recent('tenant-a', 10, 'camp-1')).toHaveLength(1);
  });
});

describe('unfenced writes', () => {
  it('refuses the plain record() path entirely', async () => {
    // Accepting an unfenced write would quietly reintroduce the race.
    const { store: s } = store(fakeRedis());
    await expect(s.record(decision())).rejects.toThrow(/requires recordFenced/);
  });
});

describe('failure handling', () => {
  it('fails closed when Redis is unreachable', async () => {
    const broken: FencedRedis = {
      eval: () => Promise.reject(new Error('down')),
      lrange: () => Promise.reject(new Error('down')),
    };
    const onFailure = vi.fn();
    const s = new FencedShadowDecisionStore({ redis: broken, intervalMs: INTERVAL, onFailure });

    const result = await s.recordFenced(decision(), 1);
    expect(result.accepted).toBe(false);
    expect(result.rejection).toBe(DecisionRejection.STORE_UNAVAILABLE);
    expect(onFailure).toHaveBeenCalled();
  });

  it('rejects an unusable tenant id without touching Redis', async () => {
    const redis = fakeRedis();
    const evalSpy = vi.spyOn(redis, 'eval');
    const s = new FencedShadowDecisionStore({ redis, intervalMs: INTERVAL });

    const result = await s.recordFenced(decision({ tenantId: 'global' }), 1);
    expect(result.rejection).toBe(DecisionRejection.INVALID_TENANT);
    expect(evalSpy).not.toHaveBeenCalled();
  });

  it('never returns a record claiming a call was originated', async () => {
    const redis = fakeRedis();
    const s = new FencedShadowDecisionStore({ redis, intervalMs: INTERVAL });
    await s.recordFenced(decision(), 1);

    redis.lists
      .get('tenant:tenant-a:dialer:v2:campaign:camp-1:shadow')
      ?.push(JSON.stringify({ ...decision(), originated: true }));

    const recent = await s.recent('tenant-a', 10, 'camp-1');
    expect(recent.every(d => d.originated === false)).toBe(true);
  });
});
