/**
 * PostgreSQL health against a real server.
 *
 * The unit tests drive the monitor through injected probes. That proves the
 * state machine and nothing about PostgreSQL. What they cannot show is the
 * behaviour that actually mattered — a connection that was working and then
 * stops — because a hand-written fake rejects instantly with tidy text, where a
 * real driver against a real server produces the real error at the real layer.
 * Classification and recovery both have to hold against that.
 *
 * ── How the outage is produced ───────────────────────────────────────────────
 *
 * A dedicated login role, toggled with `ALTER ROLE ... NOLOGIN` and its backends
 * terminated. That combination is deterministic in a way the obvious approaches
 * are not:
 *
 *  - Stopping the container would break the other live suites, which share it.
 *  - Terminating backends alone is racy: the pool transparently opens a new
 *    connection, so the next probe can succeed and the outage is never observed.
 *  - A connection limit does not apply to the superuser the other suites use.
 *
 * `NOLOGIN` refuses NEW connections for this role only, so once the existing
 * ones are terminated every probe fails until the role is restored. Nothing else
 * in the database is touched, and `LOGIN` puts it back.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectLivePostgres, type LivePrisma } from '../testing/live-services.js';

import { AssignmentCapability, AssignmentHealth } from './assignment-health.js';
import {
  classifyPostgresError,
  connectPostgres,
  PostgresFailure,
  PostgresHealthMonitor,
} from './postgres.js';

/** Owned entirely by this suite. Never a role any other code path uses. */
const ROLE = 'dialer_v2_health_probe';
const ROLE_PASSWORD = 'probe-only-throwaway';

let available = false;
let skipReason = '';
let admin: LivePrisma;
/** A connection string for ROLE, derived from the throwaway test database URL. */
let probeUrl = '';

beforeAll(async () => {
  const handle = await connectLivePostgres();
  available = handle.available;
  skipReason = handle.reason ?? '';
  if (!available) return;

  admin = handle.client;

  const raw = process.env.DIALER_V2_TEST_DATABASE_URL ?? '';
  if (!raw) {
    available = false;
    skipReason = 'DIALER_V2_TEST_DATABASE_URL is not set';
    return;
  }

  try {
    const parsed = new URL(raw);
    parsed.username = ROLE;
    parsed.password = ROLE_PASSWORD;
    probeUrl = parsed.toString();

    const database = parsed.pathname.replace(/^\//, '');

    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${ROLE}`);
    await admin.$executeRawUnsafe(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PASSWORD}'`);
    await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${database}" TO ${ROLE}`);
    await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    // Enough to read the assignment table, and nothing more.
    await admin.$executeRawUnsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
  } catch (error) {
    available = false;
    skipReason = `could not create the probe role: ${(error as Error).message}`;
  }
}, 60_000);

afterAll(async () => {
  if (!available) return;
  try {
    await restoreRole();
    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${ROLE}`);
  } catch {
    // Cleanup of a throwaway database. Never worth failing the suite over.
  }
  await admin.$disconnect();
}, 60_000);

function live(name: string, fn: () => Promise<void>, timeout = 60_000) {
  it(
    name,
    async () => {
      if (!available) {
        console.warn(`[live-postgres-health] skipped "${name}": ${skipReason}`);
        return;
      }
      await fn();
    },
    timeout
  );
}

/** Refuse new logins for ROLE and cut the connections it already holds. */
async function takeDatabaseAway(): Promise<void> {
  await admin.$executeRawUnsafe(`ALTER ROLE ${ROLE} NOLOGIN`);
  await admin.$executeRawUnsafe(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND usename = '${ROLE}'
      AND pid <> pg_backend_pid()
  `);
}

async function restoreRole(): Promise<void> {
  await admin.$executeRawUnsafe(`ALTER ROLE ${ROLE} LOGIN`);
}

describe('a real database, taken away and given back', () => {
  live('health starts true, falls during the outage, and recovers', async () => {
    const result = await connectPostgres(probeUrl, { probeTimeoutMs: 5_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const connection = result.connection;
    // Driven manually. A background interval would race the assertions.
    const monitor = new PostgresHealthMonitor({
      probe: () => connection.probe(),
      intervalMs: 600_000,
    });
    monitor.markInitiallyConnected();

    // ── 1. Healthy against a real server ─────────────────────────────────
    expect(await monitor.probeNow()).toBe(true);
    expect(monitor.healthy()).toBe(true);
    expect(monitor.snapshot().lastProbeSucceededAtMs).not.toBeNull();
    expect(monitor.snapshot().lastProbeLatencyMs).toBeGreaterThanOrEqual(0);

    // ── 2. The database goes away ────────────────────────────────────────
    await takeDatabaseAway();

    // Bounded, but the outage is deterministic: with NOLOGIN in force the pool
    // cannot reopen, so every probe from here fails until the role is restored.
    let unhealthy = false;
    for (let attempt = 0; attempt < 10 && !unhealthy; attempt += 1) {
      unhealthy = !(await monitor.probeNow());
      if (!unhealthy) await takeDatabaseAway();
    }

    expect(unhealthy).toBe(true);
    expect(monitor.healthy()).toBe(false);
    expect(monitor.snapshot().consecutiveFailures).toBeGreaterThan(0);
    expect(monitor.snapshot().lastFailureCategory).not.toBeNull();
    // The category is the whole diagnosis that leaves the process. Prisma's own
    // errors embed the datasource URL, and the URL carries the password.
    const serialized = JSON.stringify(monitor.snapshot());
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//);
    expect(serialized).not.toContain(ROLE_PASSWORD);

    // ── 3. It comes back ─────────────────────────────────────────────────
    await restoreRole();

    let recovered = false;
    for (let attempt = 0; attempt < 20 && !recovered; attempt += 1) {
      recovered = await monitor.probeNow();
      if (!recovered) await new Promise(r => setTimeout(r, 250));
    }

    expect(recovered).toBe(true);
    expect(monitor.healthy()).toBe(true);
    expect(monitor.snapshot().consecutiveFailures).toBe(0);
    expect(monitor.snapshot().lastFailureCategory).toBeNull();

    monitor.stop();
    await connection.disconnect();
  });

  live('assignment capability follows the database down and back up', async () => {
    await restoreRole();

    const result = await connectPostgres(probeUrl, { probeTimeoutMs: 5_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const connection = result.connection;
    const monitor = new PostgresHealthMonitor({
      probe: () => connection.probe(),
      intervalMs: 600_000,
    });
    monitor.markInitiallyConnected();

    const health = new AssignmentHealth({
      configured: true,
      databaseReachable: () => monitor.healthy(),
    });

    // Against the real `campaign_agents` table the migration created here.
    expect(await health.probeSchema(connection.db)).toBe(true);
    expect(health.capability()).toBe(AssignmentCapability.RESOLVABLE);

    await takeDatabaseAway();
    for (let attempt = 0; attempt < 10 && monitor.healthy(); attempt += 1) {
      await monitor.probeNow();
      if (monitor.healthy()) await takeDatabaseAway();
    }

    // The precise defect the old latch had: capability must not still claim
    // resolvable because the schema was fine last time anyone looked.
    expect(monitor.healthy()).toBe(false);
    expect(health.capability()).toBe(AssignmentCapability.DATABASE_UNREACHABLE);
    expect(health.resolvable()).toBe(false);

    await restoreRole();
    let recovered = false;
    for (let attempt = 0; attempt < 20 && !recovered; attempt += 1) {
      recovered = await monitor.probeNow();
      if (!recovered) await new Promise(r => setTimeout(r, 250));
    }

    expect(recovered).toBe(true);
    expect(health.resolvable()).toBe(true);
    expect(health.capability()).toBe(AssignmentCapability.RESOLVABLE);

    monitor.stop();
    await connection.disconnect();
  });

  live('a failed lookup marks health unhealthy without waiting for a probe', async () => {
    await restoreRole();

    const result = await connectPostgres(probeUrl, { probeTimeoutMs: 5_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const connection = result.connection;
    const monitor = new PostgresHealthMonitor({
      probe: () => connection.probe(),
      intervalMs: 600_000,
    });
    monitor.markInitiallyConnected();
    expect(monitor.healthy()).toBe(true);

    await takeDatabaseAway();

    // Real traffic, not a probe. This is the evidence path that matters: a
    // ten-second probe would leave health wrong for up to a full interval.
    let sawFailure = false;
    for (let attempt = 0; attempt < 10 && !sawFailure; attempt += 1) {
      try {
        await connection.db.campaignAgent.findMany({
          where: { tenantId: '', userId: '' },
          select: { campaignId: true },
          take: 0,
        });
        await takeDatabaseAway();
      } catch (error) {
        monitor.recordQueryFailure(error);
        sawFailure = true;
      }
    }

    expect(sawFailure).toBe(true);
    expect(monitor.healthy()).toBe(false);

    await restoreRole();
    monitor.stop();
    await connection.disconnect();
  });

  live('refuses to connect at all while the role cannot log in', async () => {
    await takeDatabaseAway();

    const result = await connectPostgres(probeUrl, { probeTimeoutMs: 5_000 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // A rejected login and an unreachable host are both legitimate readings of
      // what the driver reports here; neither may be silently treated as ready.
      expect([
        PostgresFailure.AUTHENTICATION_REJECTED,
        PostgresFailure.UNREACHABLE,
        PostgresFailure.UNKNOWN,
      ]).toContain(result.category);
    }

    await restoreRole();
  });

  live('classifies a genuinely missing relation from a real server', async () => {
    // Let PostgreSQL produce the error rather than asserting against
    // hand-written text. This is what keeps the classifier honest when a driver
    // or server version changes its wording.
    try {
      await admin.$queryRawUnsafe('SELECT 1 FROM a_table_that_does_not_exist');
      expect.unreachable('expected the missing relation to throw');
    } catch (error) {
      expect(classifyPostgresError(error)).toBe(PostgresFailure.SCHEMA_INCOMPLETE);
    }
  });
});
