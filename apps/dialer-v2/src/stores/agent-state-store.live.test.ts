/**
 * Live Redis suite for durable agent state, SIP registrations, and campaign
 * observations.
 *
 * The claims being tested are all about sharing and survival — a second replica
 * sees what the first wrote, a restart reconstructs, two concurrent writers do
 * not lose each other's counts. None of those can be demonstrated with a fake,
 * because a fake is a single object that every "replica" shares by
 * construction. Two store instances here talk to one real server.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { connectLiveRedis, flushTestDb, sleep, type LiveRedis } from '../testing/live-services.js';

import {
  AgentWriteOutcome,
  RedisAgentStateStore,
  type AgentStateRedis,
  type RevisionedAgentRecord,
} from './agent-state-store.js';
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
      console.warn(`[live-agent-state] skipped "${name}": ${skipReason}`);
      return;
    }
    await fn();
  });
}

/** One store instance stands for one replica. */
const replica = (ttlMs?: number) =>
  new RedisAgentStateStore({ redis: redis as unknown as AgentStateRedis, ttlMs });

const observations = (windowMs?: number) =>
  new RedisObservationStore({ redis: redis as unknown as ObservationRedis, windowMs });

interface TestAgent extends RevisionedAgentRecord {
  state: string;
  extension: string | null;
}

function agent(overrides: Partial<TestAgent> = {}): TestAgent {
  return {
    tenantId: 'tenant-a',
    agentId: 'agent-1',
    revision: 0,
    state: 'AVAILABLE',
    extension: '1001',
    ...overrides,
  };
}

describe('agent state survives a restart', () => {
  live('a fresh store reconstructs what the previous one wrote', async () => {
    const before = replica();
    await before.save(agent({ agentId: 'agent-1' }), 0);
    await before.save(agent({ agentId: 'agent-2', state: 'ON_CALL' }), 0);

    // Nothing carried over in memory. This is what a replica does on startup
    // instead of beginning with an empty map and reporting zero capacity.
    const after = replica();
    const restored = await after.loadAll<TestAgent>('tenant-a');

    expect(restored).toHaveLength(2);
    expect(restored.map(r => r.agentId).sort()).toEqual(['agent-1', 'agent-2']);
    expect(restored.find(r => r.agentId === 'agent-2')?.state).toBe('ON_CALL');
  });

  live('a write on one replica is immediately visible on another', async () => {
    const a = replica();
    const b = replica();

    await a.save(agent({ state: 'ON_CALL' }), 0);
    expect((await b.load<TestAgent>('tenant-a', 'agent-1'))?.state).toBe('ON_CALL');
  });

  live('reconstruction never crosses tenants', async () => {
    const store = replica();
    await store.save(agent({ tenantId: 'tenant-a' }), 0);
    await store.save(agent({ tenantId: 'tenant-b' }), 0);

    const a = await store.loadAll<TestAgent>('tenant-a');
    expect(a).toHaveLength(1);
    expect(a[0].tenantId).toBe('tenant-a');
  });

  live('a record expires rather than lingering as phantom capacity', async () => {
    const store = replica(200);
    await store.save(agent(), 0);
    expect(await store.load<TestAgent>('tenant-a', 'agent-1')).not.toBeNull();

    await sleep(350);
    expect(await store.load<TestAgent>('tenant-a', 'agent-1')).toBeNull();
  });
});

describe('concurrent writers cannot silently overwrite each other', () => {
  live('a stale revision is refused and the current record returned', async () => {
    // A browser heartbeat lands on replica A while a FreeSWITCH event for the
    // same agent lands on replica B. Last-write-wins would let A revert an
    // agent that B just moved to ON_CALL, and the agent gets dialled again
    // while already talking.
    const a = replica();
    const b = replica();

    const created = await a.save(agent({ state: 'AVAILABLE' }), 0);
    expect(created.outcome).toBe(AgentWriteOutcome.SAVED);
    expect(created.revision).toBe(1);

    const bWrite = await b.save(agent({ state: 'ON_CALL' }), 1);
    expect(bWrite.outcome).toBe(AgentWriteOutcome.SAVED);
    expect(bWrite.revision).toBe(2);

    // A still believes it is at revision 1.
    const aWrite = await a.save(agent({ state: 'AVAILABLE' }), 1);
    expect(aWrite.outcome).toBe(AgentWriteOutcome.STALE_REVISION);
    expect(aWrite.current?.state).toBe('ON_CALL');
    expect(aWrite.current?.revision).toBe(2);

    // The newer state stands.
    expect((await a.load<TestAgent>('tenant-a', 'agent-1'))?.state).toBe('ON_CALL');
  });

  live('exactly one of many concurrent creations wins', async () => {
    const stores = Array.from({ length: 8 }, () => replica());
    const results = await Promise.all(stores.map(s => s.save(agent(), 0)));

    expect(results.filter(r => r.outcome === AgentWriteOutcome.SAVED)).toHaveLength(1);
    expect(results.filter(r => r.outcome === AgentWriteOutcome.STALE_REVISION)).toHaveLength(7);
  });

  live('the caller can re-apply against the record it was handed back', async () => {
    const store = replica();
    await store.save(agent({ state: 'AVAILABLE' }), 0);
    await store.save(agent({ state: 'ON_CALL' }), 1);

    const stale = await store.save(agent({ state: 'WRAP_UP' }), 1);
    expect(stale.outcome).toBe(AgentWriteOutcome.STALE_REVISION);

    // Re-apply on top of what is actually current, no re-read needed.
    const retry = await store.save(
      { ...stale.current!, state: 'WRAP_UP' },
      stale.current!.revision
    );
    expect(retry.outcome).toBe(AgentWriteOutcome.SAVED);
    expect((await store.load<TestAgent>('tenant-a', 'agent-1'))?.state).toBe('WRAP_UP');
  });

  live('refuses to resurrect a record that has expired', async () => {
    // Recreating under an old revision would restore state that may since have
    // been superseded and deliberately dropped.
    const store = replica(200);
    await store.save(agent(), 0);
    await sleep(350);

    const result = await store.save(agent(), 1);
    expect(result.outcome).toBe(AgentWriteOutcome.GONE);
  });

  live('counts stale writes for the health surface', async () => {
    const store = replica();
    await store.save(agent(), 0);
    await store.save(agent(), 0);
    await store.save(agent(), 0);
    expect(store.metrics().staleWrites).toBe(2);
  });
});

describe('SIP registrations are shared and reconstructable', () => {
  live('a registration observed by one replica is visible to another', async () => {
    // Only the replica whose ESL connection saw the sofia::register knew about
    // it before; every other replica believed the agent had no endpoint.
    const a = replica();
    const b = replica();

    expect(
      await a.saveSipRegistration('tenant-a', 'agent-1', {
        extension: '1001',
        registered: true,
        observedAtMs: 1_800_000_000_000,
      })
    ).toBe(true);

    const seen = await b.loadSipRegistration<{ extension: string; registered: boolean }>(
      'tenant-a',
      'agent-1'
    );
    expect(seen).toMatchObject({ extension: '1001', registered: true });
  });

  live('reconstructs every registration for a tenant after a restart', async () => {
    const before = replica();
    await before.save(agent({ agentId: 'agent-1' }), 0);
    await before.save(agent({ agentId: 'agent-2' }), 0);
    await before.saveSipRegistration('tenant-a', 'agent-1', { extension: '1001' });
    await before.saveSipRegistration('tenant-a', 'agent-2', { extension: '1002' });

    const after = replica();
    const all = await after.loadAllSipRegistrations<{ extension: string }>('tenant-a');
    expect(all.map(r => r.extension).sort()).toEqual(['1001', '1002']);
  });

  live('an agent with no registration is simply absent, not null-padded', async () => {
    const store = replica();
    await store.save(agent({ agentId: 'agent-1' }), 0);
    await store.save(agent({ agentId: 'agent-2' }), 0);
    await store.saveSipRegistration('tenant-a', 'agent-1', { extension: '1001' });

    const all = await store.loadAllSipRegistrations<{ extension: string }>('tenant-a');
    expect(all).toHaveLength(1);
  });

  live('stamps the tenant and agent onto the stored registration', async () => {
    const store = replica();
    await store.saveSipRegistration('tenant-a', 'agent-1', { extension: '1001' });
    const seen = await store.loadSipRegistration<Record<string, unknown>>('tenant-a', 'agent-1');
    expect(seen).toMatchObject({ tenantId: 'tenant-a', agentId: 'agent-1' });
  });

  live('registrations do not leak across tenants', async () => {
    const store = replica();
    await store.save(agent({ tenantId: 'tenant-a' }), 0);
    await store.saveSipRegistration('tenant-a', 'agent-1', { extension: '1001' });

    expect(await store.loadSipRegistration('tenant-b', 'agent-1')).toBeNull();
    expect(await store.loadAllSipRegistrations('tenant-b')).toEqual([]);
  });
});

describe('observation counters are shared, not per-replica', () => {
  live('two replicas both count toward one sample', async () => {
    // Each replica observing half the calls meant each estimated from half the
    // sample, and neither ever reached minSampleSize — so the controller stayed
    // degraded while believing it lacked data it actually had.
    const a = observations();
    const b = observations();

    await a.increment('tenant-a', 'camp-1', { attempts: 30, liveAnswers: 6 });
    await b.increment('tenant-a', 'camp-1', { attempts: 40, liveAnswers: 9 });

    expect(await a.read('tenant-a', 'camp-1')).toMatchObject({
      attempts: 70,
      liveAnswers: 15,
    });
  });

  live('concurrent increments do not lose counts', async () => {
    // hincrby, not read-modify-write. The latter would drop most of these.
    const store = observations();
    await Promise.all(
      Array.from({ length: 50 }, () => store.increment('tenant-a', 'camp-1', { attempts: 1 }))
    );
    expect((await store.read('tenant-a', 'camp-1'))?.attempts).toBe(50);
  });

  live('survives a restart so the learned answer rate is not thrown away', async () => {
    const before = observations();
    await before.increment('tenant-a', 'camp-1', { attempts: 500, liveAnswers: 110 });

    const after = observations();
    expect(await after.read('tenant-a', 'camp-1')).toMatchObject({
      attempts: 500,
      liveAnswers: 110,
    });
  });

  live('returns the post-increment totals, not a value another replica moved', async () => {
    const store = observations();
    await store.increment('tenant-a', 'camp-1', { attempts: 10 });
    const after = await store.increment('tenant-a', 'camp-1', { attempts: 5 });
    expect(after?.attempts).toBe(15);
  });

  live('an untouched counter reads as zero rather than appearing observed', async () => {
    const store = observations();
    const result = await store.increment('tenant-a', 'camp-1', { attempts: 3 });
    expect(result).toMatchObject({ attempts: 3, liveAnswers: 0, abandons: 0 });
  });

  live('a campaign that was never observed reads as all zeros', async () => {
    expect(await observations().read('tenant-a', 'never-seen')).toMatchObject({
      attempts: 0,
      liveAnswers: 0,
    });
  });

  live('counters do not cross campaigns or tenants', async () => {
    const store = observations();
    await store.increment('tenant-a', 'camp-1', { attempts: 10 });
    await store.increment('tenant-a', 'camp-2', { attempts: 3 });
    await store.increment('tenant-b', 'camp-1', { attempts: 7 });

    expect((await store.read('tenant-a', 'camp-1'))?.attempts).toBe(10);
    expect((await store.read('tenant-a', 'camp-2'))?.attempts).toBe(3);
    expect((await store.read('tenant-b', 'camp-1'))?.attempts).toBe(7);
  });

  live('counters expire so "recent" is a stated duration', async () => {
    // An unbounded lifetime counter is the wrong statistic: a campaign's answer
    // rate at 9am is not evidence about 9pm.
    const store = observations(200);
    await store.increment('tenant-a', 'camp-1', { attempts: 10 });
    await sleep(350);
    expect((await store.read('tenant-a', 'camp-1'))?.attempts).toBe(0);
  });
});
