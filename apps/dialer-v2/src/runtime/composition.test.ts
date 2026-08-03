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
  AssignmentCapability,
  CompositionError,
  composeRuntime,
  PostgresFailure,
  readRuntimeMode,
  RuntimeMode,
  type ComposeOptions,
  type PostgresConnectResult,
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

type Rows = Array<Record<string, unknown>>;
type FindMany = (args: { where: Record<string, unknown> }) => Promise<Rows>;

function fakePostgres(
  overrides: {
    user?: FindMany;
    campaignAgent?: FindMany;
    probe?: () => Promise<void>;
  } = {}
): PostgresConnectResult {
  return {
    ok: true,
    connection: {
      db: {
        user: { findMany: overrides.user ?? (() => Promise.resolve([])) },
        campaignAgent: { findMany: overrides.campaignAgent ?? (() => Promise.resolve([])) },
      },
      probe: overrides.probe ?? (() => Promise.resolve()),
      disconnect: () => Promise.resolve(),
    },
  };
}

/**
 * Rows that honour the `where.tenantId` predicate.
 *
 * A fake that returns its fixture regardless of the predicate cannot be used to
 * test tenant scoping — it would report the isolation working while the query
 * that enforces it was being ignored. PostgreSQL applies the predicate; so does
 * this.
 */
function tenantScoped(rows: Rows): FindMany {
  return ({ where }) =>
    Promise.resolve(
      rows.filter(row => where.tenantId === undefined || row.tenantId === where.tenantId)
    );
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

describe('the mode is exact or the service refuses', () => {
  /** An environment with no test-runner markers, whatever runs these tests. */
  const deployment = (over: Record<string, string> = {}): NodeJS.ProcessEnv =>
    ({ ...over }) as NodeJS.ProcessEnv;

  it.each(['prod', 'prodution', 'stage', 'PRODUCTIONAL', 'PRODUCTION', 'Staging', 'unknown', 'x'])(
    'refuses %o rather than silently choosing test',
    value => {
      // This is the whole point. Falling back to TEST sounds cautious, but TEST
      // is the mode that PERMITS memory and static sources — so one transposed
      // letter used to disable every guard staging and production enforce, and
      // the service started clean and reported healthy on fixture data.
      expect(() => readRuntimeMode(deployment({ DIALER_V2_RUNTIME_MODE: value }))).toThrow(
        CompositionError
      );
    }
  );

  it('refuses an unset mode outside a test runner', () => {
    expect(() => readRuntimeMode(deployment())).toThrow(CompositionError);
    expect(() => readRuntimeMode(deployment())).toThrow(/must be set/);
  });

  it('refuses an empty mode outside a test runner', () => {
    expect(() => readRuntimeMode(deployment({ DIALER_V2_RUNTIME_MODE: '   ' }))).toThrow(
      CompositionError
    );
  });

  it('accepts an unset mode only when a real test runner injected itself', () => {
    // Vitest announces itself specifically. This is what lets the pure suites
    // run without every one of them setting the variable by hand.
    expect(readRuntimeMode(deployment({ VITEST: 'true' }))).toBe(RuntimeMode.TEST);
    expect(readRuntimeMode(deployment({ VITEST_WORKER_ID: '1' }))).toBe(RuntimeMode.TEST);
  });

  it('does not accept NODE_ENV as proof of a test runner', () => {
    // NODE_ENV=test is set by CI images, task runners and shell profiles that
    // have nothing to do with a test process. Honouring it would hand the
    // memory-permitting mode to any environment labelled that way.
    expect(() => readRuntimeMode(deployment({ NODE_ENV: 'test' }))).toThrow(CompositionError);
  });

  it('normalizes surrounding whitespace but nothing else', () => {
    // A trailing newline out of a secrets file is a transport artefact, not a
    // different value. Case is a different value.
    expect(readRuntimeMode(deployment({ DIALER_V2_RUNTIME_MODE: '  staging\n' }))).toBe(
      RuntimeMode.STAGING
    );
  });

  it('names the offending value so the typo is visible', () => {
    expect(() => readRuntimeMode(deployment({ DIALER_V2_RUNTIME_MODE: 'prodution' }))).toThrow(
      /prodution/
    );
  });

  it('accepts each documented mode', () => {
    for (const mode of Object.values(RuntimeMode)) {
      expect(readRuntimeMode(deployment({ DIALER_V2_RUNTIME_MODE: mode }))).toBe(mode);
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
      {
        connectPostgresImpl: () =>
          Promise.resolve({ ok: false as const, category: PostgresFailure.UNREACHABLE }),
      },
      /refused the connection/,
    ],
    [
      'the generated Prisma client is missing',
      PRODUCTION_ENV,
      {
        connectPostgresImpl: () =>
          Promise.resolve({ ok: false as const, category: PostgresFailure.CLIENT_NOT_GENERATED }),
      },
      // The specific message this round exists to produce. An image built
      // without `prisma generate` used to report "connection failed", sending
      // whoever read it to look at the network.
      /prisma generate/,
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

describe('assignment capability answers "can we resolve now", not "did we ever"', () => {
  const assignedAgent = () =>
    fakePostgres({
      user: tenantScoped([{ id: 'agent-1', tenantId: 'tenant-a', status: 'ACTIVE' }]),
      campaignAgent: tenantScoped([{ campaignId: 'camp-1', tenantId: 'tenant-a' }]),
    });

  it('is resolvable once the schema probe passes, before any agent logs in', async () => {
    // The old latch required an assigned agent to have been seen. On a fresh
    // tenant, or before anyone is rostered, a healthy service reported its
    // assignment source unusable.
    const composition = await composeRuntime(PRODUCTION_ENV, OPTIONS);
    expect(composition.assignmentsResolvable()).toBe(true);
    expect(composition.assignmentHealth().capability).toBe(AssignmentCapability.RESOLVABLE);
  });

  it('stays resolvable for an agent who simply has no campaigns', async () => {
    const composition = await composeRuntime(PRODUCTION_ENV, OPTIONS);
    await composition.assignments.resolve('tenant-a', 'agent-nobody');

    // A lookup that ran and correctly returned nothing is a success. Reporting
    // it as a capability failure conflates "no work assigned" with "cannot tell".
    expect(composition.assignmentsResolvable()).toBe(true);
    expect(composition.assignmentHealth().lastAssignmentLookupSucceeded).toBe(true);
  });

  it('is resolvable with an assigned agent too', async () => {
    const composition = await composeRuntime(PRODUCTION_ENV, {
      ...OPTIONS,
      connectPostgresImpl: () => Promise.resolve(assignedAgent()),
    });
    const result = await composition.assignments.resolve('tenant-a', 'agent-1');
    expect(result?.campaignIds).toEqual(['camp-1']);
    expect(composition.assignmentsResolvable()).toBe(true);
  });

  it('reports the static source as not database-backed rather than as working', async () => {
    const composition = await composeRuntime(
      { DIALER_V2_RUNTIME_MODE: 'development' } as NodeJS.ProcessEnv,
      OPTIONS
    );
    expect(composition.assignmentsResolvable()).toBe(false);
    expect(composition.assignmentHealth().capability).toBe(
      AssignmentCapability.SOURCE_NOT_DATABASE
    );
    expect(composition.assignmentHealth().assignmentSourceConfigured).toBe(false);
  });

  it('reports a missing table as a schema gap, not a generic failure', async () => {
    const composition = await composeRuntime(PRODUCTION_ENV, {
      ...OPTIONS,
      connectPostgresImpl: () =>
        Promise.resolve(
          fakePostgres({
            campaignAgent: () =>
              Promise.reject(new Error('relation "campaign_agents" does not exist')),
          })
        ),
    });

    expect(composition.assignmentHealth().assignmentSchemaPresent).toBe(false);
    expect(composition.assignmentHealth().capability).toBe(AssignmentCapability.SCHEMA_MISSING);
    expect(composition.assignmentsResolvable()).toBe(false);
  });

  it('stops being resolvable when the database fails after a success', async () => {
    // The defect the latch had: once true, permanently true. Drop the database
    // and capability went on claiming assignments could be resolved.
    let failing = false;
    const composition = await composeRuntime(PRODUCTION_ENV, {
      ...OPTIONS,
      connectPostgresImpl: () =>
        Promise.resolve(
          fakePostgres({
            user: args =>
              failing
                ? Promise.reject(new Error("Can't reach database server"))
                : tenantScoped([{ id: 'agent-1', tenantId: 'tenant-a', status: 'ACTIVE' }])(args),
            campaignAgent: tenantScoped([{ campaignId: 'camp-1', tenantId: 'tenant-a' }]),
          })
        ),
    });

    await composition.assignments.resolve('tenant-a', 'agent-1');
    expect(composition.assignmentsResolvable()).toBe(true);

    failing = true;
    await composition.assignments.resolve('tenant-a', 'agent-1');

    expect(composition.postgresHealthy()).toBe(false);
    expect(composition.assignmentsResolvable()).toBe(false);
    expect(composition.assignmentHealth().capability).toBe(
      AssignmentCapability.DATABASE_UNREACHABLE
    );
  });

  it('recovers once the database answers again', async () => {
    let failing = true;
    const composition = await composeRuntime(PRODUCTION_ENV, {
      ...OPTIONS,
      connectPostgresImpl: () =>
        Promise.resolve(
          fakePostgres({
            probe: () =>
              failing ? Promise.reject(new Error('ECONNREFUSED')) : Promise.resolve(undefined),
          })
        ),
    });

    await composition.probePostgresNow();
    expect(composition.postgresHealthy()).toBe(false);
    expect(composition.assignmentsResolvable()).toBe(false);

    failing = false;
    await composition.probePostgresNow();
    expect(composition.postgresHealthy()).toBe(true);
    expect(composition.assignmentsResolvable()).toBe(true);
  });

  it('treats a cross-tenant lookup as a refusal, not a source failure', async () => {
    // The tenant predicate is in the query, so a cross-tenant request returns no
    // user. That is the source working correctly. Counting it as a failure would
    // let one bad request mark the whole capability unhealthy.
    const composition = await composeRuntime(PRODUCTION_ENV, {
      ...OPTIONS,
      connectPostgresImpl: () => Promise.resolve(assignedAgent()),
    });

    const result = await composition.assignments.resolve('tenant-b', 'agent-1');
    expect(result?.campaignIds ?? []).toEqual([]);
    expect(composition.assignmentsResolvable()).toBe(true);
  });
});

describe('postgres health is a claim about now', () => {
  it('goes unhealthy on a failed probe and healthy again on a good one', async () => {
    let failing = false;
    const composition = await composeRuntime(PRODUCTION_ENV, {
      ...OPTIONS,
      connectPostgresImpl: () =>
        Promise.resolve(
          fakePostgres({
            probe: () =>
              failing
                ? Promise.reject(new Error("Can't reach database server"))
                : Promise.resolve(undefined),
          })
        ),
    });

    expect(composition.postgresHealthy()).toBe(true);

    failing = true;
    await composition.probePostgresNow();
    expect(composition.postgresHealthy()).toBe(false);
    expect(composition.postgresHealth()?.consecutiveFailures).toBe(1);
    expect(composition.postgresHealth()?.lastFailureCategory).toBe(PostgresFailure.UNREACHABLE);

    failing = false;
    await composition.probePostgresNow();
    expect(composition.postgresHealthy()).toBe(true);
    expect(composition.postgresHealth()?.consecutiveFailures).toBe(0);
  });

  it('goes unhealthy from a real query failure without waiting for a probe', async () => {
    // Real traffic finds an outage before a ten-second probe does. Discarding
    // that evidence means being knowingly wrong for up to a full interval.
    const composition = await composeRuntime(PRODUCTION_ENV, {
      ...OPTIONS,
      connectPostgresImpl: () =>
        Promise.resolve(fakePostgres({ user: () => Promise.reject(new Error('ECONNREFUSED')) })),
    });

    expect(composition.postgresHealthy()).toBe(true);
    await composition.assignments.resolve('tenant-a', 'agent-1');
    expect(composition.postgresHealthy()).toBe(false);
  });

  it('records the failure category and never a connection string', async () => {
    const composition = await composeRuntime(PRODUCTION_ENV, {
      ...OPTIONS,
      connectPostgresImpl: () =>
        Promise.resolve(
          fakePostgres({
            probe: () =>
              Promise.reject(
                new Error(
                  'Authentication failed against database server at `postgres://app:hunter2@db:5432/app`'
                )
              ),
          })
        ),
    });

    await composition.probePostgresNow();
    const snapshot = composition.postgresHealth();
    expect(snapshot?.lastFailureCategory).toBe(PostgresFailure.AUTHENTICATION_REJECTED);
    // The category is the whole diagnosis that leaves the process.
    expect(JSON.stringify(snapshot)).not.toMatch(/hunter2|postgres:\/\//);
  });
});

describe('an unusable observation window refuses to start', () => {
  // Consistent with every other backend: a value this service cannot provide is
  // a startup failure, not something quietly replaced with a default that then
  // looks deliberate to whoever reads the config next.
  const withWindow = (over: Record<string, string>) =>
    ({ ...PRODUCTION_ENV, ...over }) as NodeJS.ProcessEnv;

  it('refuses a bucket shorter than a second', async () => {
    await expect(
      composeRuntime(withWindow({ DIALER_V2_OBSERVATION_BUCKET_MS: '200' }), OPTIONS)
    ).rejects.toThrow(CompositionError);
  });

  it('refuses a bucket width that is not a number', async () => {
    await expect(
      composeRuntime(withWindow({ DIALER_V2_OBSERVATION_BUCKET_MS: 'abc' }), OPTIONS)
    ).rejects.toThrow(/observation window/);
  });

  it('refuses a zero bucket count', async () => {
    await expect(
      composeRuntime(withWindow({ DIALER_V2_OBSERVATION_BUCKET_COUNT: '0' }), OPTIONS)
    ).rejects.toThrow(CompositionError);
  });

  it('accepts a valid override', async () => {
    const composition = await composeRuntime(
      withWindow({
        DIALER_V2_OBSERVATION_BUCKET_MS: '60000',
        DIALER_V2_OBSERVATION_BUCKET_COUNT: '30',
      }),
      OPTIONS
    );
    expect(composition.backends.observationBackend).toBe('redis');
  });

  it('applies the default when neither variable is set', async () => {
    const composition = await composeRuntime(PRODUCTION_ENV, OPTIONS);
    expect(composition.backends.observationBackend).toBe('redis');
  });

  it('treats an empty string as unset rather than as nonsense', async () => {
    // Deployment tooling frequently emits an empty variable for "not
    // configured", and failing on that would break a valid deployment.
    const composition = await composeRuntime(
      withWindow({ DIALER_V2_OBSERVATION_BUCKET_MS: '' }),
      OPTIONS
    );
    expect(composition.backends.observationBackend).toBe('redis');
  });
});
