/**
 * Pure-component tests for the Redis session store.
 *
 * These cover hashing, key derivation, reply mapping, and fail-closed
 * behaviour — everything that does not depend on Redis executing Lua. The
 * actual script semantics (replay rejection, rate limiting, expiry, eviction,
 * concurrent heartbeats) are covered in `session-store.live.test.ts` against a
 * real server, because a hand-written Lua interpreter would only prove that my
 * fake agrees with my code.
 */

import { describe, expect, it, vi } from 'vitest';

import { agentSessionKey } from '../config/redis-keys.js';

import {
  RedisAgentSessionStore,
  hashSessionToken,
  mintSessionToken,
  tokenMatchesHash,
  type SessionRedis,
} from './session-store.js';
import { SessionRejection } from './sessions.js';

function stubRedis(overrides: Partial<SessionRedis> = {}): SessionRedis {
  return {
    eval: () => Promise.resolve('OK'),
    hgetall: () => Promise.resolve({}),
    del: () => Promise.resolve(0),
    smembers: () => Promise.resolve([]),
    ...overrides,
  };
}

describe('token hashing', () => {
  it('is deterministic and 64 hex characters', () => {
    const h = hashSessionToken('abc');
    expect(h).toBe(hashSessionToken('abc'));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different tokens', () => {
    expect(hashSessionToken('abc')).not.toBe(hashSessionToken('abd'));
  });

  it('mints tokens with 256 bits of entropy and no collisions', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => mintSessionToken()));
    expect(tokens.size).toBe(500);
    for (const t of tokens) {
      expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    }
  });

  it('confirms a token against its digest in constant time', () => {
    const token = mintSessionToken();
    expect(tokenMatchesHash(token, hashSessionToken(token))).toBe(true);
    expect(tokenMatchesHash(token, hashSessionToken(`${token}x`))).toBe(false);
    expect(tokenMatchesHash(token, 'not-a-digest')).toBe(false);
    expect(tokenMatchesHash(token, '')).toBe(false);
  });
});

describe('the plaintext token never reaches Redis', () => {
  it('keys by the digest, not the token', async () => {
    const seen: unknown[][] = [];
    const store = new RedisAgentSessionStore({
      redis: stubRedis({
        eval: (...args) => {
          seen.push(args);
          return Promise.resolve([]);
        },
      }),
      mintToken: () => 'PLAINTEXT-SECRET-TOKEN',
      now: () => 1_000,
    });

    const issued = await store.issue('tenant-a', 'agent-1', 'user-1');
    expect(issued?.token).toBe('PLAINTEXT-SECRET-TOKEN');

    // Nothing sent to Redis — key or value — contains the token.
    const flat = JSON.stringify(seen);
    expect(flat).not.toContain('PLAINTEXT-SECRET-TOKEN');
    expect(flat).toContain(hashSessionToken('PLAINTEXT-SECRET-TOKEN'));
  });

  it('validates by hashing the presented token', async () => {
    const seen: unknown[][] = [];
    const store = new RedisAgentSessionStore({
      redis: stubRedis({
        eval: (...args) => {
          seen.push(args);
          return Promise.resolve('OK');
        },
      }),
    });

    await store.validate('PRESENTED-SECRET', 'tenant-a', 'agent-1', 1);
    const flat = JSON.stringify(seen);
    expect(flat).not.toContain('PRESENTED-SECRET');
    expect(flat).toContain(hashSessionToken('PRESENTED-SECRET'));
  });

  it('never returns the token on the session record', async () => {
    const hash = hashSessionToken('tok');
    const store = new RedisAgentSessionStore({
      redis: stubRedis({
        eval: () => Promise.resolve('OK'),
        hgetall: () =>
          Promise.resolve({
            tenantId: 'tenant-a',
            agentId: 'agent-1',
            userId: 'user-1',
            issuedAtMs: '1000',
            expiresAtMs: '9000',
            lastSeenAtMs: '1000',
            lastSequence: '1',
            windowCount: '1',
            windowStartedAtMs: '1000',
            revokedReason: '',
          }),
      }),
    });

    const result = await store.validate('tok', 'tenant-a', 'agent-1', 1);
    expect(result.ok).toBe(true);
    expect(result.session?.sessionTokenHash).toBe(hash);
    expect(JSON.stringify(result.session)).not.toContain('tok"');
  });

  it('derives a key that contains the digest and not the secret', () => {
    const key = agentSessionKey('tenant-a', hashSessionToken('secret'));
    expect(key).toContain(hashSessionToken('secret'));
    expect(key).not.toContain('secret');
    expect(key.startsWith('tenant:tenant-a:dialer:v2:')).toBe(true);
  });
});

describe('rejection replies map to typed rejections', () => {
  const cases: Array<[string, SessionRejection]> = [
    ['UNKNOWN_SESSION', SessionRejection.UNKNOWN_SESSION],
    ['REVOKED', SessionRejection.REVOKED],
    ['EXPIRED', SessionRejection.EXPIRED],
    ['WRONG_TENANT', SessionRejection.WRONG_TENANT],
    ['WRONG_AGENT', SessionRejection.WRONG_AGENT],
    ['RATE_LIMITED', SessionRejection.RATE_LIMITED],
    ['REPLAYED_SEQUENCE', SessionRejection.REPLAYED_SEQUENCE],
    ['SEQUENCE_TOO_FAR_AHEAD', SessionRejection.SEQUENCE_TOO_FAR_AHEAD],
  ];

  for (const [reply, expected] of cases) {
    it(`maps ${reply}`, async () => {
      const store = new RedisAgentSessionStore({
        redis: stubRedis({ eval: () => Promise.resolve(reply) }),
      });
      const result = await store.validate('tok', 'tenant-a', 'agent-1', 5);
      expect(result.ok).toBe(false);
      expect(result.rejection).toBe(expected);
    });
  }

  it('treats an unrecognised reply as unauthenticated', async () => {
    // A bug in the credential path reads as "not authenticated", never as
    // "authenticated".
    const store = new RedisAgentSessionStore({
      redis: stubRedis({ eval: () => Promise.resolve('SOMETHING_NEW') }),
    });
    const result = await store.validate('tok', 'tenant-a', 'agent-1', 5);
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe(SessionRejection.UNKNOWN_SESSION);
  });
});

describe('input validation happens before Redis is touched', () => {
  it('refuses an empty token', async () => {
    const evalSpy = vi.fn(() => Promise.resolve('OK'));
    const store = new RedisAgentSessionStore({ redis: stubRedis({ eval: evalSpy }) });

    expect((await store.validate('', 'tenant-a', 'agent-1', 1)).rejection).toBe(
      SessionRejection.UNKNOWN_SESSION
    );
    expect(evalSpy).not.toHaveBeenCalled();
  });

  it('refuses a reserved tenant id', async () => {
    const evalSpy = vi.fn(() => Promise.resolve('OK'));
    const store = new RedisAgentSessionStore({ redis: stubRedis({ eval: evalSpy }) });

    expect((await store.validate('tok', 'global', 'agent-1', 1)).rejection).toBe(
      SessionRejection.WRONG_TENANT
    );
    expect(await store.issue('global', 'agent-1', 'user-1')).toBeNull();
    expect(evalSpy).not.toHaveBeenCalled();
  });

  it('refuses an empty agent id', async () => {
    const store = new RedisAgentSessionStore({ redis: stubRedis() });
    expect(await store.issue('tenant-a', '', 'user-1')).toBeNull();
  });
});

describe('fail closed', () => {
  const broken = () =>
    stubRedis({
      eval: () => Promise.reject(new Error('redis down')),
      hgetall: () => Promise.reject(new Error('redis down')),
      del: () => Promise.reject(new Error('redis down')),
    });

  it('issues no session when Redis is unavailable', async () => {
    const onFailure = vi.fn();
    const store = new RedisAgentSessionStore({ redis: broken(), onFailure });
    expect(await store.issue('tenant-a', 'agent-1', 'user-1')).toBeNull();
    expect(onFailure).toHaveBeenCalled();
  });

  it('rejects a heartbeat when Redis is unavailable', async () => {
    const store = new RedisAgentSessionStore({ redis: broken() });
    const result = await store.validate('tok', 'tenant-a', 'agent-1', 1);
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe(SessionRejection.UNKNOWN_SESSION);
  });

  it('does not claim a session is newest when it cannot tell', async () => {
    // Over-counting an agent is what produces over-dialling and abandoned
    // calls, so "unknown" must mean "not counted".
    const store = new RedisAgentSessionStore({ redis: broken() });
    expect(await store.isNewestForAgent('tenant-a', 'agent-1', 'hash')).toBe(false);
  });

  it('reports revocation failure rather than claiming success', async () => {
    const store = new RedisAgentSessionStore({ redis: broken() });
    expect(await store.revoke('tenant-a', 'hash', 'logout')).toBe(false);
  });
});

describe('eviction deletes the session, not just the index entry', () => {
  it('removes the record for every evicted hash', async () => {
    const deleted: string[] = [];
    const store = new RedisAgentSessionStore({
      redis: stubRedis({
        eval: () => Promise.resolve(['old-hash-1', 'old-hash-2']),
        del: (...keys) => {
          deleted.push(...keys);
          return Promise.resolve(keys.length);
        },
      }),
      mintToken: () => 'new-token',
    });

    const issued = await store.issue('tenant-a', 'agent-1', 'user-1');
    expect(issued?.evictedHashes).toEqual(['old-hash-1', 'old-hash-2']);
    // A session dropped from the index but left resolvable would keep passing
    // validation, so the record itself has to go.
    expect(deleted).toEqual([
      agentSessionKey('tenant-a', 'old-hash-1'),
      agentSessionKey('tenant-a', 'old-hash-2'),
    ]);
  });
});
