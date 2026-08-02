/**
 * Pure-component tests for durable agent state and observations.
 *
 * Validation, tenant refusal, parse tolerance, and fail-closed behaviour are
 * checked here. The sharing and concurrency claims — a second replica sees the
 * write, a stale revision loses, concurrent increments do not drop counts — are
 * in `agent-state-store.live.test.ts`, because a fake would satisfy them by
 * construction rather than by being correct.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  AgentWriteOutcome,
  RedisAgentStateStore,
  type AgentStateRedis,
} from './agent-state-store.js';
import {
  EMPTY_COUNTERS,
  RedisObservationStore,
  type ObservationRedis,
} from './observation-store.js';

function stateRedis(overrides: Partial<AgentStateRedis> = {}): AgentStateRedis {
  return {
    eval: () => Promise.resolve('OK'),
    get: () => Promise.resolve(null),
    smembers: () => Promise.resolve([]),
    mget: () => Promise.resolve([]),
    ...overrides,
  };
}

function obsRedis(overrides: Partial<ObservationRedis> = {}): ObservationRedis {
  return {
    eval: () => Promise.resolve([]),
    hgetall: () => Promise.resolve({}),
    ...overrides,
  };
}

const record = (over: Record<string, unknown> = {}) => ({
  tenantId: 'tenant-a',
  agentId: 'agent-1',
  revision: 0,
  state: 'AVAILABLE',
  ...over,
});

describe('an unusable tenant never becomes a key', () => {
  it('refuses a reserved tenant id without touching Redis', async () => {
    const evalSpy = vi.fn(() => Promise.resolve('OK'));
    const store = new RedisAgentStateStore({ redis: stateRedis({ eval: evalSpy }) });

    const result = await store.save(record({ tenantId: 'global' }), 0);
    expect(result.outcome).toBe(AgentWriteOutcome.INVALID_TENANT);
    expect(evalSpy).not.toHaveBeenCalled();
  });

  it('refuses an empty agent id', async () => {
    const store = new RedisAgentStateStore({ redis: stateRedis() });
    expect((await store.save(record({ agentId: '' }), 0)).outcome).toBe(
      AgentWriteOutcome.INVALID_TENANT
    );
  });

  it('reads nothing for an invalid tenant', async () => {
    const store = new RedisAgentStateStore({ redis: stateRedis() });
    expect(await store.load('global', 'agent-1')).toBeNull();
    expect(await store.loadAll('global')).toEqual([]);
    expect(await store.loadSipRegistration('global', 'agent-1')).toBeNull();
    expect(await store.loadAllSipRegistrations('global')).toEqual([]);
    expect(await store.saveSipRegistration('global', 'agent-1', {})).toBe(false);
  });
});

describe('the written revision is the caller revision plus one', () => {
  it('reports the revision it wrote', async () => {
    const store = new RedisAgentStateStore({ redis: stateRedis() });
    expect((await store.save(record(), 0)).revision).toBe(1);
    expect((await store.save(record(), 7)).revision).toBe(8);
  });

  it('sends -1 for a create so an existing record cannot be clobbered', async () => {
    const args: unknown[][] = [];
    const store = new RedisAgentStateStore({
      redis: stateRedis({
        eval: (...a) => {
          args.push(a);
          return Promise.resolve('OK');
        },
      }),
    });

    await store.save(record(), 0);
    // ARGV[1] is the fourth positional argument after script, numKeys, KEYS[1..2].
    expect(args[0][4]).toBe('-1');
  });

  it('carries the new revision inside the serialized payload', async () => {
    const args: unknown[][] = [];
    const store = new RedisAgentStateStore({
      redis: stateRedis({
        eval: (...a) => {
          args.push(a);
          return Promise.resolve('OK');
        },
      }),
    });

    await store.save(record({ revision: 4 }), 4);
    expect(JSON.parse(String(args[0][5]))).toMatchObject({ revision: 5 });
  });
});

describe('a stale write returns what is current', () => {
  it('parses the returned record', async () => {
    const current = { tenantId: 'tenant-a', agentId: 'agent-1', revision: 9, state: 'ON_CALL' };
    const store = new RedisAgentStateStore({
      redis: stateRedis({ eval: () => Promise.resolve(JSON.stringify(current)) }),
    });

    const result = await store.save(record(), 3);
    expect(result.outcome).toBe(AgentWriteOutcome.STALE_REVISION);
    expect(result.current).toMatchObject({ revision: 9, state: 'ON_CALL' });
  });

  it('reports GONE distinctly from a stale revision', async () => {
    const store = new RedisAgentStateStore({
      redis: stateRedis({ eval: () => Promise.resolve('GONE') }),
    });
    expect((await store.save(record(), 3)).outcome).toBe(AgentWriteOutcome.GONE);
  });

  it('still reports STALE_REVISION when the returned record is unparsable', async () => {
    const store = new RedisAgentStateStore({
      redis: stateRedis({ eval: () => Promise.resolve('{not json') }),
    });
    const result = await store.save(record(), 3);
    expect(result.outcome).toBe(AgentWriteOutcome.STALE_REVISION);
    expect(result.current).toBeUndefined();
  });
});

describe('reconstruction is defensive', () => {
  it('drops a record whose tenant does not match the request', async () => {
    // A mismatch is corruption or a key-layout bug; either way it must not leak
    // an agent into another tenant's capacity.
    const store = new RedisAgentStateStore({
      redis: stateRedis({
        smembers: () => Promise.resolve(['agent-1', 'agent-2']),
        mget: () =>
          Promise.resolve([
            JSON.stringify(record({ agentId: 'agent-1' })),
            JSON.stringify(record({ agentId: 'agent-2', tenantId: 'tenant-b' })),
          ]),
      }),
    });

    const all = await store.loadAll('tenant-a');
    expect(all).toHaveLength(1);
    expect(all[0].agentId).toBe('agent-1');
  });

  it('skips a corrupt entry instead of failing the whole load', async () => {
    const store = new RedisAgentStateStore({
      redis: stateRedis({
        smembers: () => Promise.resolve(['a', 'b', 'c']),
        mget: () => Promise.resolve([JSON.stringify(record({ agentId: 'a' })), 'garbage', null]),
      }),
    });
    expect(await store.loadAll('tenant-a')).toHaveLength(1);
  });

  it('does not issue an mget for an empty index', async () => {
    const mget = vi.fn(() => Promise.resolve([]));
    const store = new RedisAgentStateStore({ redis: stateRedis({ mget }) });
    expect(await store.loadAll('tenant-a')).toEqual([]);
    expect(mget).not.toHaveBeenCalled();
  });
});

describe('fail closed', () => {
  const broken = () =>
    stateRedis({
      eval: () => Promise.reject(new Error('down')),
      get: () => Promise.reject(new Error('down')),
      smembers: () => Promise.reject(new Error('down')),
      mget: () => Promise.reject(new Error('down')),
    });

  it('reports UNAVAILABLE rather than a false success', async () => {
    // Reporting success would leave the in-memory cache believing it is durable
    // when it is not, and the next restart would silently lose the state.
    const onFailure = vi.fn();
    const store = new RedisAgentStateStore({ redis: broken(), onFailure });
    expect((await store.save(record(), 0)).outcome).toBe(AgentWriteOutcome.UNAVAILABLE);
    expect(onFailure).toHaveBeenCalled();
  });

  it('reconstructs nothing rather than partial state', async () => {
    const store = new RedisAgentStateStore({ redis: broken() });
    expect(await store.load('tenant-a', 'agent-1')).toBeNull();
    expect(await store.loadAll('tenant-a')).toEqual([]);
    expect(await store.loadAllSipRegistrations('tenant-a')).toEqual([]);
  });

  it('reports a failed SIP write as failed', async () => {
    const store = new RedisAgentStateStore({ redis: broken() });
    expect(await store.saveSipRegistration('tenant-a', 'agent-1', {})).toBe(false);
  });
});

describe('observation counters', () => {
  it('sends only non-zero deltas', async () => {
    // A zero would still create the field and make an untouched counter look
    // observed.
    const args: unknown[][] = [];
    const store = new RedisObservationStore({
      redis: obsRedis({
        eval: (...a) => {
          args.push(a);
          return Promise.resolve(['attempts', '1']);
        },
      }),
    });

    await store.increment('tenant-a', 'camp-1', { attempts: 1, liveAnswers: 0, abandons: 2 });
    const flat = args[0].map(String);
    expect(flat).toContain('attempts');
    expect(flat).toContain('abandons');
    expect(flat).not.toContain('liveAnswers');
  });

  it('does not call Redis when every delta is zero', async () => {
    const evalSpy = vi.fn(() => Promise.resolve([]));
    const store = new RedisObservationStore({ redis: obsRedis({ eval: evalSpy }) });
    await store.increment('tenant-a', 'camp-1', { attempts: 0 });
    expect(evalSpy).not.toHaveBeenCalled();
  });

  it('truncates fractional deltas rather than sending them to hincrby', async () => {
    const args: unknown[][] = [];
    const store = new RedisObservationStore({
      redis: obsRedis({
        eval: (...a) => {
          args.push(a);
          return Promise.resolve([]);
        },
      }),
    });
    await store.increment('tenant-a', 'camp-1', { attempts: 2.7 });
    expect(args[0].map(String)).toContain('2');
  });

  it('reads a flat Lua reply into typed counters', async () => {
    const store = new RedisObservationStore({
      redis: obsRedis({ eval: () => Promise.resolve(['attempts', '12', 'liveAnswers', '3']) }),
    });
    expect(await store.increment('tenant-a', 'camp-1', { attempts: 1 })).toMatchObject({
      attempts: 12,
      liveAnswers: 3,
      abandons: 0,
    });
  });

  it('never produces NaN from an unparsable counter', async () => {
    // A NaN would propagate into the Beta-Binomial posterior and produce a
    // nonsense originate count.
    const store = new RedisObservationStore({
      redis: obsRedis({ hgetall: () => Promise.resolve({ attempts: 'not-a-number' }) }),
    });
    const result = await store.read('tenant-a', 'camp-1');
    expect(result).toMatchObject({ ...EMPTY_COUNTERS });
    expect(Number.isNaN(result?.attempts)).toBe(false);
  });

  it('returns null rather than zeros when Redis is unreachable', async () => {
    // Zeros are indistinguishable from a genuinely idle campaign, and the
    // controller reads a zero sample as "dial cautiously" rather than
    // "unknown". The caller has to be able to tell the difference.
    const store = new RedisObservationStore({
      redis: obsRedis({
        eval: () => Promise.reject(new Error('down')),
        hgetall: () => Promise.reject(new Error('down')),
      }),
    });
    expect(await store.read('tenant-a', 'camp-1')).toBeNull();
    expect(await store.increment('tenant-a', 'camp-1', { attempts: 1 })).toBeNull();
  });

  it('refuses an invalid tenant or empty campaign', async () => {
    const store = new RedisObservationStore({ redis: obsRedis() });
    expect(await store.read('global', 'camp-1')).toBeNull();
    expect(await store.increment('tenant-a', '', { attempts: 1 })).toBeNull();
  });
});
