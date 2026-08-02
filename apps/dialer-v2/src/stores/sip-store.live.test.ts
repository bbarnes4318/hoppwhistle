/**
 * Live suite for SIP registration ordering and channel ownership.
 *
 * Ordering is adjudicated inside a Lua script, so the claim that two replicas
 * applying the same Sofia event cannot both win is a claim about server-side
 * atomicity — which a fake cannot demonstrate, because a fake is one object that
 * every "replica" shares by construction. Two store instances here talk to one
 * real server.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { connectLiveRedis, flushTestDb, sleep, type LiveRedis } from '../testing/live-services.js';

import { RedisChannelOwnershipStore, type ChannelRedis } from './channel-ownership.js';
import {
  RedisSipRegistrationStore,
  SipLifecycle,
  SipWriteOutcome,
  type SipRegistrationEvent,
  type SipStoreRedis,
} from './sip-store.js';

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
      console.warn(`[live-sip] skipped "${name}": ${skipReason}`);
      return;
    }
    await fn();
  });
}

const TENANT = 'live-tenant';
const AGENT = 'live-agent';

/** One store instance stands for one replica. */
const replica = (opts: { ttlMs?: number; staleAfterMs?: number; now?: () => number } = {}) =>
  new RedisSipRegistrationStore({ redis: redis as unknown as SipStoreRedis, ...opts });

const channels = () => new RedisChannelOwnershipStore({ redis: redis as unknown as ChannelRedis });

function event(
  subclass: string,
  eventAtMs: number,
  eventSequence: number,
  over: Partial<SipRegistrationEvent> = {}
): SipRegistrationEvent {
  return {
    tenantId: TENANT,
    agentId: AGENT,
    extension: '1042',
    subclass,
    eventAtMs,
    eventSequence,
    receivedAtMs: Date.now(),
    expiresAtMs: null,
    contact: '<sip:1042@10.0.0.9:5060>',
    networkIp: '10.0.0.9',
    ...over,
  };
}

describe('FreeSWITCH event order survives async lookup reordering', () => {
  live('the unregister stands when the register lookup finishes last', async () => {
    // The exact reordering the unawaited ESL callback produced.
    const store = replica();

    expect((await store.apply(event('sofia::unregister', 2_000, 11))).outcome).toBe(
      SipWriteOutcome.APPLIED
    );
    const late = await store.apply(event('sofia::register', 1_000, 10));

    expect(late.outcome).toBe(SipWriteOutcome.STALE_EVENT);
    // The refusal hands back what IS current, so the caller can reconcile.
    expect(late.current?.lifecycle).toBe(SipLifecycle.UNREGISTERED);
    expect((await store.get(TENANT, AGENT))?.lifecycle).toBe(SipLifecycle.UNREGISTERED);
  });

  live('a newer register after an unregister is applied', async () => {
    const store = replica();
    await store.apply(event('sofia::unregister', 1_000, 10));
    expect((await store.apply(event('sofia::register', 2_000, 11))).outcome).toBe(
      SipWriteOutcome.APPLIED
    );
    expect((await store.get(TENANT, AGENT))?.lifecycle).toBe(SipLifecycle.REGISTERED);
  });

  live('the same event twice is refused the second time', async () => {
    const store = replica();
    const e = event('sofia::register', 1_000, 10);
    expect((await store.apply(e)).outcome).toBe(SipWriteOutcome.APPLIED);
    expect((await store.apply(e)).outcome).toBe(SipWriteOutcome.STALE_EVENT);
    expect((await store.get(TENANT, AGENT))?.revision).toBe(0);
  });

  live('an equal timestamp is broken by the event sequence', async () => {
    // FreeSWITCH can emit a register and its unregister inside one millisecond.
    const store = replica();
    await store.apply(event('sofia::register', 5_000, 40));
    await store.apply(event('sofia::unregister', 5_000, 41));
    expect((await store.get(TENANT, AGENT))?.lifecycle).toBe(SipLifecycle.UNREGISTERED);
  });

  live('a missing sequence never displaces an event that has one', async () => {
    const store = replica();
    await store.apply(event('sofia::register', 5_000, 40));
    // Sequence 0 orders below every real sequence.
    expect((await store.apply(event('sofia::unregister', 5_000, 0))).outcome).toBe(
      SipWriteOutcome.STALE_EVENT
    );
    expect((await store.get(TENANT, AGENT))?.lifecycle).toBe(SipLifecycle.REGISTERED);
  });

  live('an ESL reconnect replay does not rewind the state', async () => {
    const store = replica();
    await store.apply(event('sofia::register', 1_000, 10));
    await store.apply(event('sofia::unregister', 2_000, 20));
    await store.apply(event('sofia::register', 1_000, 10));
    expect((await store.get(TENANT, AGENT))?.lifecycle).toBe(SipLifecycle.UNREGISTERED);
  });

  live('two replicas applying the same event admit exactly one', async () => {
    // Both replicas see every Sofia event and neither can serialise the other.
    // The comparison and the write have to be one server-side operation.
    const a = replica();
    const b = replica();
    const e = event('sofia::register', 7_000, 70);

    const results = await Promise.all([a.apply(e), b.apply(e)]);
    expect(results.filter(r => r.outcome === SipWriteOutcome.APPLIED)).toHaveLength(1);
  });

  live('twenty concurrent applications of one event admit exactly one', async () => {
    const store = replica();
    const e = event('sofia::register', 8_000, 80);
    const results = await Promise.all(Array.from({ length: 20 }, () => store.apply(e)));
    expect(results.filter(r => r.outcome === SipWriteOutcome.APPLIED)).toHaveLength(1);
  });

  live('the revision advances once per accepted event', async () => {
    const store = replica();
    await store.apply(event('sofia::register', 1_000, 10));
    await store.apply(event('sofia::unregister', 2_000, 20));
    await store.apply(event('sofia::register', 3_000, 30));
    expect((await store.get(TENANT, AGENT))?.revision).toBe(2);
  });
});

describe('registration liveness', () => {
  live('an expired registration stops counting', async () => {
    const nowRef = { value: Date.now() };
    const store = replica({ now: () => nowRef.value });

    await store.apply(
      event('sofia::register', nowRef.value, 10, { expiresAtMs: nowRef.value + 500 })
    );
    expect(await store.isRegistered(TENANT, AGENT)).toBe(true);

    nowRef.value += 600;
    expect(await store.isRegistered(TENANT, AGENT)).toBe(false);
  });

  live('a registration with no refresh goes stale even without an unregister', async () => {
    // FreeSWITCH does emit sofia::expire, but a missed event must not leave an
    // agent permanently registered — that is an agent in predictive capacity
    // with no endpoint, and every call placed for them is abandoned.
    const nowRef = { value: Date.now() };
    const store = replica({ staleAfterMs: 200, now: () => nowRef.value });

    await store.apply(event('sofia::register', nowRef.value, 10));
    expect(await store.isRegistered(TENANT, AGENT)).toBe(true);

    nowRef.value += 400;
    expect(await store.isRegistered(TENANT, AGENT)).toBe(false);
  });

  live('an unknown agent is not registered', async () => {
    expect(await replica().isRegistered(TENANT, 'never-seen')).toBe(false);
  });

  live('the record genuinely expires from Redis', async () => {
    const store = replica({ ttlMs: 200 });
    await store.apply(event('sofia::register', Date.now(), 10));
    await sleep(350);
    expect(await store.get(TENANT, AGENT)).toBeNull();
  });
});

describe('reconstruction uses the dedicated SIP index', () => {
  live('finds a registration that arrived before any agent state existed', async () => {
    // A softphone registers as soon as the tab loads, often before the agent
    // signs in — so the agent-state index may not exist yet. Reusing it meant
    // the first registration for an agent was written and never found again.
    const store = replica();
    await store.apply(event('sofia::register', Date.now(), 10));

    // No agent-state key has ever been written for this tenant.
    expect(await redis.keys(`tenant:${TENANT}:dialer:v2:agents`)).toEqual([]);

    const restored = await replica().loadAll(TENANT);
    expect(restored).toHaveLength(1);
    expect(restored[0].agentId).toBe(AGENT);
  });

  live('never returns another tenant registrations', async () => {
    const store = replica();
    await store.apply(event('sofia::register', Date.now(), 10));
    await store.apply(event('sofia::register', Date.now(), 11, { tenantId: 'other-tenant' }));

    expect(await store.loadAll(TENANT)).toHaveLength(1);
    expect(await store.loadAll('other-tenant')).toHaveLength(1);
  });
});

describe('channel ownership is tenant-scoped on a real keyspace', () => {
  live('two tenants with the same agent id do not collide', async () => {
    // Agent ids are unique within a tenant, not across the platform. Two
    // tenants that number agents the same way collided on every lookup.
    const store = channels();
    await store.claim('tenant-one', 'agent-1', 'uuid-one', 'call-one');
    await store.claim('tenant-two', 'agent-1', 'uuid-two', 'call-two');

    const one = await store.loadAll('tenant-one');
    const two = await store.loadAll('tenant-two');

    expect(one).toHaveLength(1);
    expect(one[0].channelUuid).toBe('uuid-one');
    expect(two).toHaveLength(1);
    expect(two[0].channelUuid).toBe('uuid-two');
  });

  live('carries the tenant, agent, channel and call', async () => {
    const store = channels();
    await store.claim(TENANT, AGENT, 'uuid-a', 'call-a');

    expect((await store.loadAll(TENANT))[0]).toMatchObject({
      tenantId: TENANT,
      agentId: AGENT,
      channelUuid: 'uuid-a',
      callId: 'call-a',
    });
  });

  live('survives a restart, so a mid-call agent is not corrected away', async () => {
    await channels().claim(TENANT, AGENT, 'uuid-live', 'call-live');
    expect(await channels().loadAll(TENANT)).toHaveLength(1);
  });

  live('quarantines a channel with no usable tenant', async () => {
    const store = channels();
    // Attributing it to a default tenant is how a cross-tenant capacity bug
    // starts.
    expect(await store.claim('global', AGENT, 'uuid-x', null)).toBe(false);
    expect(store.metrics().quarantinedChannels).toBe(1);
  });

  live('a released channel is gone', async () => {
    const store = channels();
    await store.claim(TENANT, AGENT, 'uuid-a', 'call-a');
    await store.release(TENANT, 'uuid-a');
    expect(await store.loadAll(TENANT)).toEqual([]);
  });

  live('a stale channel record expires rather than pinning an agent forever', async () => {
    // A leaked entry makes an idle agent look permanently busy, which removes
    // them from capacity with no error anywhere.
    const store = new RedisChannelOwnershipStore({
      redis: redis as unknown as ChannelRedis,
      ttlMs: 200,
    });
    await store.claim(TENANT, AGENT, 'uuid-a', 'call-a');
    await sleep(350);
    expect(await store.loadAll(TENANT)).toEqual([]);
  });

  live('writes only inside the tenant namespace', async () => {
    await channels().claim(TENANT, AGENT, 'uuid-a', 'call-a');
    const foreign = (await redis.keys('*')).filter(k => !k.startsWith(`tenant:${TENANT}:`));
    expect(foreign).toEqual([]);
  });
});
