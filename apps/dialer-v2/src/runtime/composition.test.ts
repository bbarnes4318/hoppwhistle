/**
 * Composition tests.
 *
 * These are the tests that would have caught the defect this round exists to
 * fix: the Redis stores, the database sources, and the fenced decision store
 * were all built and tested, and none of them were reachable, because nothing
 * asserted which implementations the running service actually holds.
 *
 * So these assert on the bundle `index.ts` builds — not on a class instantiated
 * directly in a test. `composeRuntime` is called exactly as the entrypoint calls
 * it, with connectors injected so no server is needed.
 */

import { describe, expect, it, vi } from 'vitest';

import { RedisAgentSessionStore } from '../agents/session-store.js';
import { isFencedWriter } from '../shadow/engine.js';
import { RedisAgentStateStore } from '../stores/agent-state-store.js';
import { RedisChannelOwnershipStore } from '../stores/channel-ownership.js';
import { FencedShadowDecisionStore } from '../stores/fenced-decisions.js';
import { RedisObservationStore } from '../stores/observation-store.js';
import type { DialerRedis, RedisConnection } from '../stores/provider.js';
import { RedisSipRegistrationStore } from '../stores/sip-store.js';

import {
  CompositionError,
  composeRuntime,
  readRuntimeMode,
  RuntimeMode,
  type ComposeOptions,
} from './composition.js';

/** A Redis client that answers every command shape the stores use. */
function fakeClient(): DialerRedis {
  return {
    set: () => Promise.resolve('OK'),
    get: () => Promise.resolve(null),
    del: () => Promise.resolve(1),
    eval: () => Promise.resolve(1),
    incr: () => Promise.resolve(1),
    lpush: () => Promise.resolve(1),
    ltrim: () => Promise.resolve(null),
    lrange: () => Promise.resolve([]),
    zrevrange: () => Promise.resolve([]),
    pexpire: () => Promise.resolve(1),
    hgetall: () => Promise.resolve({}),
    smembers: () => Promise.resolve([]),
    mget: () => Promise.resolve([]),
  } as unknown as DialerRedis;
}

function fakeRedisConnection(): RedisConnection {
  return {
    client: fakeClient(),
    isHealthy: () => true,
    disconnect: () => Promise.resolve(),
  };
}

function fakePostgres() {
  return {
    db: {
      user: { findMany: () => Promise.resolve([]) },
      campaignAgent: { findMany: () => Promise.resolve([]) },
    },
    isHealthy: () => true,
    disconnect: () => Promise.resolve(),
  };
}

const OPTIONS: ComposeOptions = {
  ownerId: 'replica-1',
  shadowIntervalMs: 1_000,
  connectRedisImpl: () => Promise.resolve(fakeRedisConnection()),
  connectPostgresImpl: () => Promise.resolve(fakePostgres()),
};

const PRODUCTION_ENV = {
  DIALER_V2_RUNTIME_MODE: 'production',
  REDIS_URL: 'redis://redis:6379',
  DATABASE_URL: 'postgres://db/app',
  DIALER_V2_SIP_DOMAIN: 'sip.example.test',
} as NodeJS.ProcessEnv;

describe('the mode defaults to the most restrictive option', () => {
  it('treats an unset mode as test, not production', () => {
    // Defaulting to production would let a typo in a deployment variable
    // silently arm the real backends; defaulting to development would let a
    // real deployment silently accept memory.
    expect(readRuntimeMode({} as NodeJS.ProcessEnv)).toBe(RuntimeMode.TEST);
    expect(readRuntimeMode({ DIALER_V2_RUNTIME_MODE: 'prod' } as NodeJS.ProcessEnv)).toBe(
      RuntimeMode.TEST
    );
  });

  it('accepts each documented mode', () => {
    for (const mode of Object.values(RuntimeMode)) {
      expect(readRuntimeMode({ DIALER_V2_RUNTIME_MODE: mode } as NodeJS.ProcessEnv)).toBe(mode);
    }
  });
});

describe('production composition holds the shared implementations', () => {
  it('builds every backend from Redis and PostgreSQL', async () => {
    const composition = await composeRuntime(PRODUCTION_ENV, OPTIONS);

    // The exact classes, not a duck-typed shape. The point of this test is that
    // the RUNNING service holds these, which is what was not true before.
    expect(composition.sessions).toBeInstanceOf(RedisAgentSessionStore);
    expect(composition.agentStore).toBeInstanceOf(RedisAgentStateStore);
    expect(composition.sip).toBeInstanceOf(RedisSipRegistrationStore);
    expect(composition.observations).toBeInstanceOf(RedisObservationStore);
    expect(composition.channels).toBeInstanceOf(RedisChannelOwnershipStore);
    expect(composition.stores.shadowStore).toBeInstanceOf(FencedShadowDecisionStore);
    expect(composition.stores.lock.distributed).toBe(true);
  });

  it('reports every backend individually', async () => {
    const composition = await composeRuntime(PRODUCTION_ENV, OPTIONS);
    expect(composition.backends).toEqual({
      dedupeBackend: 'redis',
      decisionBackend: 'redis',
      decisionsFenced: true,
      sessionBackend: 'redis',
      agentStateBackend: 'redis',
      sipBackend: 'redis',
      observationBackend: 'redis',
      channelBackend: 'redis',
      extensionSource: 'database',
      assignmentSource: 'database',
      lockBackend: 'redis',
    });
  });

  it('logs backend names and no credentials', async () => {
    const log = vi.fn();
    await composeRuntime(PRODUCTION_ENV, { ...OPTIONS, log });

    const lines = JSON.stringify(log.mock.calls);
    // A connection string in a startup log is a credential in every aggregator
    // downstream.
    expect(lines).not.toContain('redis://');
    expect(lines).not.toContain('postgres://');
    expect(lines).toContain('dialer-v2 composition');
  });
});

describe('the decision store the entrypoint holds can adjudicate authority', () => {
  it('exposes recordFenced', async () => {
    // `buildStores` returned the UNFENCED RedisShadowDecisionStore, so the
    // runtime computed a fencing token, passed it down, and had it discarded —
    // in the only configuration that runs in production.
    const composition = await composeRuntime(PRODUCTION_ENV, OPTIONS);
    expect(isFencedWriter(composition.stores.shadowStore)).toBe(true);
  });

  it('refuses an unfenced record() on the store the entrypoint holds', async () => {
    const composition = await composeRuntime(PRODUCTION_ENV, OPTIONS);
    await expect(
      composition.stores.shadowStore.record({
        tenantId: 'tenant-a',
        campaignId: 'camp-1',
      } as never)
    ).rejects.toThrow(/recordFenced/);
  });
});

describe('staging and production refuse rather than degrade', () => {
  const cases: Array<[string, NodeJS.ProcessEnv, Partial<ComposeOptions>, RegExp]> = [
    [
      'Redis is not configured',
      { ...PRODUCTION_ENV, REDIS_URL: undefined } as NodeJS.ProcessEnv,
      {},
      /REDIS_URL/,
    ],
    [
      'Redis is unreachable',
      PRODUCTION_ENV,
      { connectRedisImpl: () => Promise.resolve(null) },
      /REDIS_URL/,
    ],
    [
      'PostgreSQL is not configured',
      { ...PRODUCTION_ENV, DATABASE_URL: undefined } as NodeJS.ProcessEnv,
      {},
      /DATABASE_URL/,
    ],
    [
      'PostgreSQL is unreachable',
      PRODUCTION_ENV,
      { connectPostgresImpl: () => Promise.resolve(null) },
      /DATABASE_URL/,
    ],
    [
      'the SIP realm is not configured',
      { ...PRODUCTION_ENV, DIALER_V2_SIP_DOMAIN: '' } as NodeJS.ProcessEnv,
      {},
      /DIALER_V2_SIP_DOMAIN/,
    ],
  ];

  for (const [label, env, options, message] of cases) {
    it(`refuses to start in production when ${label}`, async () => {
      // The dangerous failure is not "Redis is down" — that is loud. It is
      // "Redis was down at startup, so we quietly used memory, and everything
      // looks fine."
      await expect(composeRuntime(env, { ...OPTIONS, ...options })).rejects.toThrow(
        CompositionError
      );
      await expect(composeRuntime(env, { ...OPTIONS, ...options })).rejects.toThrow(message);
    });

    it(`refuses to start in staging when ${label}`, async () => {
      await expect(
        composeRuntime({ ...env, DIALER_V2_RUNTIME_MODE: 'staging' } as NodeJS.ProcessEnv, {
          ...OPTIONS,
          ...options,
        })
      ).rejects.toThrow(CompositionError);
    });
  }

  it('never substitutes a memory implementation in production', async () => {
    // The failure to prevent is a composition that SUCCEEDS while holding
    // single-instance state, because that reports healthy and produces
    // per-replica numbers that read exactly like real ones.
    await expect(
      composeRuntime(PRODUCTION_ENV, {
        ...OPTIONS,
        connectRedisImpl: () => Promise.resolve(null),
      })
    ).rejects.toThrow(CompositionError);
  });
});

describe('development composes, and says what it composed', () => {
  it('builds memory backends and labels every one of them', async () => {
    const composition = await composeRuntime(
      { DIALER_V2_RUNTIME_MODE: 'development' } as NodeJS.ProcessEnv,
      OPTIONS
    );

    expect(composition.backends.sessionBackend).toBe('memory');
    expect(composition.backends.agentStateBackend).toBe('memory');
    expect(composition.backends.extensionSource).toBe('static');
    expect(composition.backends.lockBackend).toBe('noop');
    // Reported false, so health can say plainly that decision writes are not
    // adjudicated against a lock — there is no lock in one process to check.
    expect(composition.backends.decisionsFenced).toBe(false);
  });

  it('still gives the runtime a store that can judge a fencing token', async () => {
    // Otherwise every shadow pass in development throws, because the runtime
    // always presents authority and a store that cannot evaluate it fails
    // closed rather than writing unfenced.
    const composition = await composeRuntime(
      { DIALER_V2_RUNTIME_MODE: 'development' } as NodeJS.ProcessEnv,
      OPTIONS
    );
    expect(isFencedWriter(composition.stores.shadowStore)).toBe(true);
  });

  it('reports Redis as unhealthy when there is none', async () => {
    const composition = await composeRuntime(
      { DIALER_V2_RUNTIME_MODE: 'development' } as NodeJS.ProcessEnv,
      OPTIONS
    );
    // Not "true because we are not using Redis". The controller's hard stop
    // must be able to fire.
    expect(composition.redisHealthy()).toBe(false);
    expect(composition.postgresHealthy()).toBe(false);
  });
});

describe('assignment resolvability is observed, not assumed', () => {
  it('reports false until an agent actually resolves to a campaign', async () => {
    const composition = await composeRuntime(PRODUCTION_ENV, OPTIONS);
    expect(composition.assignmentsResolvable()).toBe(false);
  });

  it('reports true once one does', async () => {
    const composition = await composeRuntime(PRODUCTION_ENV, {
      ...OPTIONS,
      connectPostgresImpl: () =>
        Promise.resolve({
          db: {
            user: {
              findMany: () =>
                Promise.resolve([{ id: 'agent-1', tenantId: 'tenant-a', status: 'ACTIVE' }]),
            },
            campaignAgent: { findMany: () => Promise.resolve([{ campaignId: 'camp-1' }]) },
          },
          isHealthy: () => true,
          disconnect: () => Promise.resolve(),
        }),
    });

    await composition.assignments.resolve('tenant-a', 'agent-1');
    expect(composition.assignmentsResolvable()).toBe(true);
  });
});
