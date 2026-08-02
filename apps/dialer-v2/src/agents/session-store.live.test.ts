/**
 * Live Redis suite for agent sessions.
 *
 * The whole point of moving sessions into Redis is that two API replicas share
 * one view of them. That claim cannot be tested with a fake: a fake is one
 * object, so "both replicas see it" is true by construction. Here two store
 * instances — standing in for two replicas — talk to one real server.
 *
 * The Lua in VALIDATE_AND_ADVANCE is likewise only meaningfully exercised by
 * Redis itself: `hgetall` returning a flat array, `cjson.decode`, `unpack`,
 * `pexpireat`, and the atomicity that makes the replay check trustworthy.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { connectLiveRedis, flushTestDb, sleep, type LiveRedis } from '../testing/live-services.js';

import { RedisAgentSessionStore, hashSessionToken, type SessionRedis } from './session-store.js';
import { SessionRejection } from './sessions.js';

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
      console.warn(`[live-sessions] skipped "${name}": ${skipReason}`);
      return;
    }
    await fn();
  });
}

const clock = { value: 1_800_000_000_000 };

/** One store instance stands for one API replica. */
function replica(overrides: Record<string, unknown> = {}) {
  return new RedisAgentSessionStore({
    redis: redis as unknown as SessionRedis,
    now: () => clock.value,
    maxBeatsPerWindow: 5,
    rateWindowMs: 10_000,
    maxSequenceJump: 100,
    maxSessionsPerAgent: 3,
    ...overrides,
  });
}

describe('a session issued on one replica is usable on another', () => {
  live('validates against a second instance sharing the same Redis', async () => {
    // This is the defect the in-memory Map had: behind a load balancer the
    // agent was logged out at random depending on which replica answered.
    const a = replica();
    const b = replica();

    const issued = await a.issue('tenant-a', 'agent-1', 'user-1');
    expect(issued).not.toBeNull();

    const result = await b.validate(issued!.token, 'tenant-a', 'agent-1', 1);
    expect(result.ok).toBe(true);
    expect(result.session?.agentId).toBe('agent-1');
  });

  live('the sequence advances across replicas, not per replica', async () => {
    const a = replica();
    const b = replica();
    const issued = await a.issue('tenant-a', 'agent-1', 'user-1');

    expect((await a.validate(issued!.token, 'tenant-a', 'agent-1', 1)).ok).toBe(true);
    // B must see A's advance. Otherwise sequence 1 is replayable forever by
    // alternating replicas.
    expect((await b.validate(issued!.token, 'tenant-a', 'agent-1', 1)).rejection).toBe(
      SessionRejection.REPLAYED_SEQUENCE
    );
    expect((await b.validate(issued!.token, 'tenant-a', 'agent-1', 2)).ok).toBe(true);
  });
});

describe('the stored form is a digest, not a credential', () => {
  live('no key or value anywhere contains the token', async () => {
    const store = replica();
    const issued = await store.issue('tenant-a', 'agent-1', 'user-1');
    await store.validate(issued!.token, 'tenant-a', 'agent-1', 1);

    const keys = await redis.keys('*');
    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      expect(key).not.toContain(issued!.token);
      const type = String(await redis.eval('return redis.call("type", KEYS[1])["ok"]', 1, key));
      if (type === 'hash') {
        expect(JSON.stringify(await redis.hgetall(key))).not.toContain(issued!.token);
      }
    }

    // The digest IS present — that is what lookup uses.
    expect(keys.some(k => k.includes(hashSessionToken(issued!.token)))).toBe(true);
  });

  live('a stolen digest cannot be replayed as a token', async () => {
    // Someone reading an RDB dump gets digests. Presenting a digest hashes it
    // again, which resolves to nothing.
    const store = replica();
    const issued = await store.issue('tenant-a', 'agent-1', 'user-1');
    const digest = hashSessionToken(issued!.token);

    const result = await store.validate(digest, 'tenant-a', 'agent-1', 1);
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe(SessionRejection.UNKNOWN_SESSION);
  });
});

describe('replay and rate limiting are enforced by the server', () => {
  live('rejects a replayed sequence', async () => {
    const store = replica();
    const issued = await store.issue('tenant-a', 'agent-1', 'user-1');

    expect((await store.validate(issued!.token, 'tenant-a', 'agent-1', 5)).ok).toBe(true);
    expect((await store.validate(issued!.token, 'tenant-a', 'agent-1', 5)).rejection).toBe(
      SessionRejection.REPLAYED_SEQUENCE
    );
    expect((await store.validate(issued!.token, 'tenant-a', 'agent-1', 4)).rejection).toBe(
      SessionRejection.REPLAYED_SEQUENCE
    );
  });

  live('rejects a sequence far beyond the window', async () => {
    const store = replica();
    const issued = await store.issue('tenant-a', 'agent-1', 'user-1');
    expect((await store.validate(issued!.token, 'tenant-a', 'agent-1', 10_000)).rejection).toBe(
      SessionRejection.SEQUENCE_TOO_FAR_AHEAD
    );
  });

  live('concurrent heartbeats with the same sequence admit exactly one', async () => {
    // The reason validation is a script. Read-then-write over the network would
    // let both of these read the same lastSequence and both accept.
    const store = replica();
    const issued = await store.issue('tenant-a', 'agent-1', 'user-1');

    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.validate(issued!.token, 'tenant-a', 'agent-1', 1))
    );
    expect(results.filter(r => r.ok)).toHaveLength(1);
  });

  live('rate limits within the window and counts on the server', async () => {
    const store = replica();
    const issued = await store.issue('tenant-a', 'agent-1', 'user-1');

    for (let i = 1; i <= 5; i++) {
      expect((await store.validate(issued!.token, 'tenant-a', 'agent-1', i)).ok).toBe(true);
    }
    expect((await store.validate(issued!.token, 'tenant-a', 'agent-1', 6)).rejection).toBe(
      SessionRejection.RATE_LIMITED
    );
  });

  live('rate limiting is checked before the sequence', async () => {
    // Otherwise a flood burns through the sequence space and locks the real
    // agent out of its own replay window.
    const store = replica();
    const issued = await store.issue('tenant-a', 'agent-1', 'user-1');
    for (let i = 1; i <= 5; i++) {
      await store.validate(issued!.token, 'tenant-a', 'agent-1', i);
    }
    // A replayed sequence while rate limited reports RATE_LIMITED, proving the
    // order, and the stored sequence is untouched.
    expect((await store.validate(issued!.token, 'tenant-a', 'agent-1', 1)).rejection).toBe(
      SessionRejection.RATE_LIMITED
    );
  });

  live('the window resets after real elapsed time', async () => {
    const store = new RedisAgentSessionStore({
      redis: redis as unknown as SessionRedis,
      maxBeatsPerWindow: 2,
      rateWindowMs: 200,
    });
    const issued = await store.issue('tenant-a', 'agent-1', 'user-1');

    expect((await store.validate(issued!.token, 'tenant-a', 'agent-1', 1)).ok).toBe(true);
    expect((await store.validate(issued!.token, 'tenant-a', 'agent-1', 2)).ok).toBe(true);
    expect((await store.validate(issued!.token, 'tenant-a', 'agent-1', 3)).rejection).toBe(
      SessionRejection.RATE_LIMITED
    );

    await sleep(320);
    expect((await store.validate(issued!.token, 'tenant-a', 'agent-1', 3)).ok).toBe(true);
  });
});

describe('a session is bound to one identity', () => {
  live('refuses the token against another agent', async () => {
    const store = replica();
    const issued = await store.issue('tenant-a', 'agent-1', 'user-1');
    expect((await store.validate(issued!.token, 'tenant-a', 'agent-2', 1)).rejection).toBe(
      SessionRejection.WRONG_AGENT
    );
  });

  live('refuses the token against another tenant', async () => {
    const store = replica();
    const issued = await store.issue('tenant-a', 'agent-1', 'user-1');
    // Cross-tenant lookup lands on a different key entirely, so this is
    // UNKNOWN_SESSION rather than WRONG_TENANT — either way, refused.
    const result = await store.validate(issued!.token, 'tenant-b', 'agent-1', 1);
    expect(result.ok).toBe(false);
  });

  live('a revoked session stops validating', async () => {
    const store = replica();
    const issued = await store.issue('tenant-a', 'agent-1', 'user-1');
    expect(await store.revoke('tenant-a', issued!.sessionTokenHash, 'logout')).toBe(true);

    expect((await store.validate(issued!.token, 'tenant-a', 'agent-1', 1)).rejection).toBe(
      SessionRejection.REVOKED
    );
    // Revoking twice is not an error, but reports that nothing changed.
    expect(await store.revoke('tenant-a', issued!.sessionTokenHash, 'again')).toBe(false);
  });

  live('a session expires on its own TTL', async () => {
    const store = new RedisAgentSessionStore({
      redis: redis as unknown as SessionRedis,
      ttlMs: 200,
    });
    const issued = await store.issue('tenant-a', 'agent-1', 'user-1');
    expect((await store.validate(issued!.token, 'tenant-a', 'agent-1', 1)).ok).toBe(true);

    await sleep(350);
    // Redis dropped the key on its own; no faked clock.
    expect((await store.validate(issued!.token, 'tenant-a', 'agent-1', 2)).rejection).toBe(
      SessionRejection.UNKNOWN_SESSION
    );
  });
});

describe('duplicate sessions are a shared fact', () => {
  live('only the newest session counts as capacity, across replicas', async () => {
    // Two tabs landing on two replicas were each "newest" under the in-memory
    // registry, which double-counted the agent and inflated dialing capacity.
    const a = replica();
    const b = replica();

    const first = await a.issue('tenant-a', 'agent-1', 'user-1');
    clock.value += 1_000;
    const second = await b.issue('tenant-a', 'agent-1', 'user-1');

    expect(await a.isNewestForAgent('tenant-a', 'agent-1', second!.sessionTokenHash)).toBe(true);
    expect(await b.isNewestForAgent('tenant-a', 'agent-1', first!.sessionTokenHash)).toBe(false);
  });

  live('evicts and deletes the oldest beyond the cap', async () => {
    const store = replica();
    const issued = [];
    for (let i = 0; i < 4; i++) {
      clock.value += 1_000;
      issued.push(await store.issue('tenant-a', 'agent-1', 'user-1'));
    }

    const evicted = issued[3]!.evictedHashes;
    expect(evicted).toEqual([issued[0]!.sessionTokenHash]);

    // Deleted, not merely unindexed — an unindexed but resolvable session would
    // keep passing validation.
    expect((await store.validate(issued[0]!.token, 'tenant-a', 'agent-1', 1)).rejection).toBe(
      SessionRejection.UNKNOWN_SESSION
    );
    expect((await store.validate(issued[3]!.token, 'tenant-a', 'agent-1', 1)).ok).toBe(true);

    const hashes = await store.hashesForAgent('tenant-a', 'agent-1');
    expect(hashes).toHaveLength(3);
    expect(hashes).not.toContain(issued[0]!.sessionTokenHash);
  });

  live('lists an agent sessions oldest first without exposing tokens', async () => {
    const store = replica();
    clock.value += 1_000;
    const first = await store.issue('tenant-a', 'agent-1', 'user-1');
    clock.value += 1_000;
    const second = await store.issue('tenant-a', 'agent-1', 'user-1');

    const hashes = await store.hashesForAgent('tenant-a', 'agent-1');
    expect(hashes).toEqual([first!.sessionTokenHash, second!.sessionTokenHash]);
    expect(hashes).not.toContain(first!.token);
  });

  live('sessions of different agents do not share an index', async () => {
    const store = replica();
    const one = await store.issue('tenant-a', 'agent-1', 'user-1');
    await store.issue('tenant-a', 'agent-2', 'user-2');

    expect(await store.hashesForAgent('tenant-a', 'agent-1')).toEqual([one!.sessionTokenHash]);
    expect(await store.hashesForAgent('tenant-a', 'agent-2')).toHaveLength(1);
  });
});

describe('sessions survive a restart', () => {
  live('a brand new store instance still honours an existing session', async () => {
    const before = replica();
    const issued = await before.issue('tenant-a', 'agent-1', 'user-1');
    await before.validate(issued!.token, 'tenant-a', 'agent-1', 1);

    // Nothing carried over in process memory. Everything comes from Redis.
    const after = replica();
    expect((await after.validate(issued!.token, 'tenant-a', 'agent-1', 2)).ok).toBe(true);
    expect((await after.validate(issued!.token, 'tenant-a', 'agent-1', 1)).rejection).toBe(
      SessionRejection.REPLAYED_SEQUENCE
    );
  });
});
