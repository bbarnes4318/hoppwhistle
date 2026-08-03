/**
 * PostgreSQL failure classification and live health.
 *
 * Two defects are covered here. The first is that `connectPostgres` collapsed
 * every fault into `null`, so an image built without `prisma generate` reported
 * "connection failed" and sent whoever read it to look at the network. The
 * second is that health was a latch set at startup, so a database that went away
 * an hour later never moved it.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  classifyPostgresError,
  connectPostgres,
  describePostgresFailure,
  indicatesUnusableConnection,
  PostgresFailure,
  PostgresHealthMonitor,
  PostgresProbeTimeout,
  withTimeout,
} from './postgres.js';

describe('failures are classified into the fault someone has to fix', () => {
  it('recognises a client that was never generated', () => {
    // Prisma's own wording when the package is installed but `prisma generate`
    // never ran. This is the failure that shipped in this repository.
    expect(
      classifyPostgresError(
        new Error('@prisma/client did not initialize yet. Please run "prisma generate"')
      )
    ).toBe(PostgresFailure.CLIENT_NOT_GENERATED);
  });

  it('recognises the generated output directory by name', () => {
    expect(classifyPostgresError(new Error("Cannot find module '.prisma/client/default'"))).toBe(
      PostgresFailure.CLIENT_NOT_GENERATED
    );
  });

  it('separates a missing package from a missing generated client', () => {
    // Different fixes: install the dependency, versus run generate during image
    // construction. Collapsing them sends people to the wrong file.
    const notInstalled = Object.assign(new Error("Cannot find package '@prisma/client'"), {
      code: 'ERR_MODULE_NOT_FOUND',
    });
    expect(classifyPostgresError(notInstalled)).toBe(PostgresFailure.CLIENT_NOT_INSTALLED);
  });

  it.each([
    ["Can't reach database server at `db:5432`", PostgresFailure.UNREACHABLE],
    ['connect ECONNREFUSED 10.0.0.5:5432', PostgresFailure.UNREACHABLE],
    ['Authentication failed against database server', PostgresFailure.AUTHENTICATION_REJECTED],
    ['relation "campaign_agents" does not exist', PostgresFailure.SCHEMA_INCOMPLETE],
    ['Query timed out after 5000ms', PostgresFailure.TIMEOUT],
  ])('classifies %o', (message, expected) => {
    expect(classifyPostgresError(new Error(message))).toBe(expected);
  });

  it('falls back to unknown rather than guessing', () => {
    expect(classifyPostgresError(new Error('something else entirely'))).toBe(
      PostgresFailure.UNKNOWN
    );
  });

  it('classifies a generated-client fault ahead of the connectivity wording it also contains', () => {
    // The message mentions the datasource, so a connectivity-first ordering would
    // read this as a network fault — exactly the misdiagnosis to prevent.
    expect(
      classifyPostgresError(
        new Error(
          '@prisma/client did not initialize yet. Please run "prisma generate" (datasource db at postgres://db:5432)'
        )
      )
    ).toBe(PostgresFailure.CLIENT_NOT_GENERATED);
  });
});

describe('the description carries no credentials', () => {
  it('gives a fixed actionable sentence per category', () => {
    expect(describePostgresFailure(PostgresFailure.CLIENT_NOT_GENERATED)).toMatch(
      /prisma generate/
    );
    expect(describePostgresFailure(PostgresFailure.CLIENT_NOT_INSTALLED)).toMatch(
      /production dependency/
    );
  });

  it('never derives text from the error it classified', () => {
    const leak = new Error('failed at postgres://app:hunter2@db:5432/app');
    const category = classifyPostgresError(leak);
    expect(describePostgresFailure(category)).not.toMatch(/hunter2|postgres:\/\//);
  });
});

describe('the probe is bounded', () => {
  it('rejects when the work outlives its timeout', async () => {
    // A database that accepts the TCP connection and then never answers leaves
    // an unbounded probe pending forever, and health keeps reporting whatever it
    // last decided. The unhealthy state that matters most is the one that never
    // returns.
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow(PostgresProbeTimeout);
  });

  it('passes a value through when it finishes in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1_000)).resolves.toBe('ok');
  });

  it('clears its timer so a fast probe cannot hold the process open', async () => {
    const clear = vi.fn();
    await withTimeout(
      Promise.resolve(1),
      1_000,
      setTimeout,
      clear as unknown as typeof clearTimeout
    );
    expect(clear).toHaveBeenCalledOnce();
  });
});

describe('connectPostgres reports why rather than returning null', () => {
  it('names a client that resolved without a constructor', async () => {
    const result = await connectPostgres('postgres://db/app', {
      importPrisma: () => Promise.resolve({}),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.category).toBe(PostgresFailure.CLIENT_NOT_GENERATED);
  });

  it('names an uninstalled package', async () => {
    const result = await connectPostgres('postgres://db/app', {
      importPrisma: () =>
        Promise.reject(
          Object.assign(new Error("Cannot find package '@prisma/client'"), {
            code: 'ERR_MODULE_NOT_FOUND',
          })
        ),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.category).toBe(PostgresFailure.CLIENT_NOT_INSTALLED);
  });

  it('names an unreachable server, and disconnects the half-built client', async () => {
    const disconnect = vi.fn(() => Promise.resolve());
    const result = await connectPostgres('postgres://db/app', {
      importPrisma: () =>
        Promise.resolve({
          PrismaClient: class {
            $queryRawUnsafe() {
              return Promise.reject(new Error("Can't reach database server"));
            }
            $disconnect = disconnect;
          },
        }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.category).toBe(PostgresFailure.UNREACHABLE);
    // Otherwise a refusing startup leaks a connection pool on every retry.
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('returns a usable connection when the probe answers', async () => {
    const result = await connectPostgres('postgres://db/app', {
      importPrisma: () =>
        Promise.resolve({
          PrismaClient: class {
            $queryRawUnsafe() {
              return Promise.resolve([{ '?column?': 1 }]);
            }
            $disconnect() {
              return Promise.resolve();
            }
          },
        }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) await expect(result.connection.probe()).resolves.toBeUndefined();
  });
});

describe('health moves in both directions', () => {
  const monitorWith = (probe: () => Promise<void>) => {
    let clock = 1_000;
    const monitor = new PostgresHealthMonitor({
      probe,
      intervalMs: 10_000,
      now: () => (clock += 5),
    });
    return monitor;
  };

  it('is unhealthy until something proves otherwise', () => {
    expect(monitorWith(() => Promise.resolve()).healthy()).toBe(false);
  });

  it('records the startup probe without re-running it', () => {
    const probe = vi.fn(() => Promise.resolve());
    const monitor = monitorWith(probe);
    monitor.markInitiallyConnected();
    expect(monitor.healthy()).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });

  it('falls on a failed probe and recovers on a good one', async () => {
    // The defect: health was set true at startup and could only be set false by
    // a deliberate disconnect, so a failover an hour later never moved it.
    let failing = false;
    const monitor = monitorWith(() =>
      failing ? Promise.reject(new Error('ECONNREFUSED')) : Promise.resolve()
    );
    monitor.markInitiallyConnected();

    failing = true;
    await monitor.probeNow();
    expect(monitor.healthy()).toBe(false);
    expect(monitor.snapshot().consecutiveFailures).toBe(1);

    await monitor.probeNow();
    expect(monitor.snapshot().consecutiveFailures).toBe(2);

    failing = false;
    await monitor.probeNow();
    expect(monitor.healthy()).toBe(true);
    expect(monitor.snapshot().consecutiveFailures).toBe(0);
    expect(monitor.snapshot().lastFailureCategory).toBeNull();
  });

  it('falls immediately on a real query failure, without waiting for a tick', () => {
    const monitor = monitorWith(() => Promise.resolve());
    monitor.markInitiallyConnected();
    monitor.recordQueryFailure(new Error("Can't reach database server"));
    expect(monitor.healthy()).toBe(false);
    expect(monitor.snapshot().lastFailureCategory).toBe(PostgresFailure.UNREACHABLE);
  });

  it('does not treat a missing relation as the connection being down', () => {
    // The server connected, authenticated, parsed the statement and answered.
    // That is a healthy database missing a migration, and reporting it as an
    // outage would page whoever owns the database for something only a deploy
    // can fix — the same conflation the assignment capability rewrite removes.
    const monitor = monitorWith(() => Promise.resolve());
    monitor.markInitiallyConnected();
    monitor.recordQueryFailure(new Error('relation "campaign_agents" does not exist'));

    expect(monitor.healthy()).toBe(true);
    expect(monitor.snapshot().consecutiveFailures).toBe(0);
    // Still reported, so the gap is visible rather than swallowed.
    expect(monitor.snapshot().lastFailureCategory).toBe(PostgresFailure.SCHEMA_INCOMPLETE);
  });

  it.each([
    PostgresFailure.UNREACHABLE,
    PostgresFailure.TIMEOUT,
    PostgresFailure.AUTHENTICATION_REJECTED,
    PostgresFailure.CLIENT_NOT_GENERATED,
    PostgresFailure.CLIENT_NOT_INSTALLED,
    PostgresFailure.UNKNOWN,
  ])('treats %s as the connection being unusable', category => {
    expect(indicatesUnusableConnection(category)).toBe(true);
  });

  it('treats a successful lookup as proof of reachability', () => {
    const monitor = monitorWith(() => Promise.resolve());
    monitor.recordQueryFailure(new Error('ECONNREFUSED'));
    expect(monitor.healthy()).toBe(false);

    monitor.recordExtensionLookup(true);
    expect(monitor.healthy()).toBe(true);
    expect(monitor.snapshot().lastExtensionLookupSucceededAtMs).not.toBeNull();
  });

  it('reports transitions once, not on every probe', async () => {
    const onTransition = vi.fn();
    let failing = false;
    const monitor = new PostgresHealthMonitor({
      probe: () => (failing ? Promise.reject(new Error('x')) : Promise.resolve()),
      intervalMs: 10_000,
      onTransition,
    });

    await monitor.probeNow();
    await monitor.probeNow();
    expect(onTransition).toHaveBeenCalledTimes(1);

    failing = true;
    await monitor.probeNow();
    await monitor.probeNow();
    expect(onTransition).toHaveBeenCalledTimes(2);
  });

  it('records extension and assignment lookups separately', () => {
    const monitor = monitorWith(() => Promise.resolve());
    monitor.recordExtensionLookup(false);
    monitor.recordAssignmentLookup(false);
    const snapshot = monitor.snapshot();
    expect(snapshot.lastExtensionLookupFailedAtMs).not.toBeNull();
    expect(snapshot.lastAssignmentLookupFailedAtMs).not.toBeNull();
    expect(snapshot.lastExtensionLookupSucceededAtMs).toBeNull();
  });

  it('bounds probe latency in the snapshot', async () => {
    const monitor = monitorWith(() => Promise.resolve());
    await monitor.probeNow();
    expect(monitor.snapshot().lastProbeLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('stops cleanly and does not keep a timer alive', () => {
    const monitor = monitorWith(() => Promise.resolve());
    monitor.start();
    monitor.stop();
    // Idempotent: shutdown paths call this more than once.
    expect(() => monitor.stop()).not.toThrow();
  });
});
