/**
 * Assignment migration validation, against real PostgreSQL.
 *
 * ── What is already covered elsewhere, and not repeated here ─────────────────
 *
 * `src/agents/db-sources.live.test.ts` → "assignments against the real schema"
 * already proves the data path against real rows: the table exists with the
 * shape the source reads, one assignment per agent per campaign is enforced, a
 * real user resolves to a real campaign, a disabled assignment grants nothing,
 * revoking removes capacity, one agent can hold several campaigns, a suspended
 * user grants nothing, a cross-tenant assignment cannot resolve, and a genuine
 * query failure reports LOOKUP_FAILED rather than granting capacity.
 *
 * `src/health/report.test.ts` → "is untrustworthy with unresolvable assignments"
 * proves readiness withholds `shadowEvidenceTrustworthy` when assignments cannot
 * be resolved.
 *
 * ── What this adds ───────────────────────────────────────────────────────────
 *
 * Two things those cannot show.
 *
 * First, **the indexes and constraints themselves**. Behaviour tests prove a
 * duplicate is rejected, which a unique constraint OR an unindexed application
 * check could both produce. The hot read — every active campaign for one agent
 * within a tenant — needs a real composite index, and nothing asserted that one
 * exists. An index quietly dropped from the migration would leave every
 * behavioural test green and turn the dialer's per-agent lookup into a
 * sequential scan.
 *
 * Second, **capability across a genuinely missing migration**. Health has to
 * tell "this database has not had the migration applied" apart from "this
 * database is unreachable", and it has to recover when the table appears. Both
 * are asserted against a real PostgreSQL schema that really lacks the table,
 * created and dropped by this suite, rather than against a rejected promise.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectLivePostgres, type LivePrisma } from '../testing/live-services.js';

import { AssignmentCapability, AssignmentHealth } from './assignment-health.js';
import { connectPostgres, PostgresHealthMonitor } from './postgres.js';

/** A schema this suite owns entirely. Never `public`. */
const BARE_SCHEMA = 'dialer_v2_no_assignments';

let available = false;
let skipReason = '';
let admin: LivePrisma;
/** A connection string pointed at BARE_SCHEMA rather than public. */
let bareUrl = '';

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
    // A real schema with no `campaign_agents` in it. Prisma's `?schema=` sets
    // the search_path, so a client pointed here sees a database that is
    // reachable, authenticated and healthy — and simply has not had the
    // migration applied. That is the state to distinguish from an outage.
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${BARE_SCHEMA} CASCADE`);
    await admin.$executeRawUnsafe(`CREATE SCHEMA ${BARE_SCHEMA}`);

    const parsed = new URL(raw);
    parsed.searchParams.set('schema', BARE_SCHEMA);
    bareUrl = parsed.toString();
  } catch (error) {
    available = false;
    skipReason = `could not create the bare schema: ${(error as Error).message}`;
  }
}, 60_000);

afterAll(async () => {
  if (!available) return;
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${BARE_SCHEMA} CASCADE`);
  } catch {
    // Throwaway database. Never worth failing the suite over.
  }
  await admin.$disconnect();
}, 60_000);

function live(name: string, fn: () => Promise<void>, timeout = 60_000) {
  it(
    name,
    async () => {
      if (!available) {
        console.warn(`[live-assignment-schema] skipped "${name}": ${skipReason}`);
        return;
      }
      await fn();
    },
    timeout
  );
}

describe('the migration produced the objects it claims to', () => {
  live('created the indexes the dialer actually reads through', async () => {
    const rows = await admin.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'campaign_agents'`
    );
    const names = rows.map(r => r.indexname).sort();

    // The composite one is the load-bearing index: the dialer's hot read is
    // "every active campaign for this agent in this tenant", once per agent per
    // resolution. Dropping it leaves every behavioural test green.
    expect(names).toContain('campaign_agents_tenantId_userId_status_idx');
    expect(names).toContain('campaign_agents_tenantId_idx');
    expect(names).toContain('campaign_agents_campaignId_idx');
    expect(names).toContain('campaign_agents_userId_idx');
  });

  live('created the uniqueness constraint as a real unique index', async () => {
    // The behavioural test proves a duplicate is rejected. This proves it is
    // rejected by the DATABASE — an application-level check would satisfy the
    // former while leaving two replicas free to race a duplicate in.
    const rows = await admin.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'campaign_agents'
         AND indexname = 'campaign_agents_tenantId_campaignId_userId_key'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX/i);
  });

  live('created the foreign keys that keep an assignment attached to real rows', async () => {
    const rows = await admin.$queryRawUnsafe<Array<{ conname: string }>>(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'public.campaign_agents'::regclass AND contype = 'f'`
    );
    const names = rows.map(r => r.conname).sort();
    expect(names).toContain('campaign_agents_tenantId_fkey');
    expect(names).toContain('campaign_agents_campaignId_fkey');
    expect(names).toContain('campaign_agents_userId_fkey');
  });

  live('altered no unrelated table', async () => {
    // The migration is additive by inspection; this asserts it at runtime. The
    // enum and the table are the only objects it is allowed to have introduced.
    const enumRow = await admin.$queryRawUnsafe<Array<{ typname: string }>>(
      `SELECT typname FROM pg_type WHERE typname = 'CampaignAgentStatus'`
    );
    expect(enumRow).toHaveLength(1);

    // `leads` in particular must be untouched — it is the production Hopper's
    // table and the subject of F-1.
    const leadsCols = await admin.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'leads'
         AND column_name LIKE 'campaign_agent%'`
    );
    expect(leadsCols).toHaveLength(0);
  });
});

describe('capability across a genuinely missing migration', () => {
  live('reports schema_missing, not database_unreachable', async () => {
    // The distinction that matters operationally: one is fixed by a deploy, the
    // other pages whoever owns the database.
    const result = await connectPostgres(bareUrl, { probeTimeoutMs: 5_000 });
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

    const probed = await health.probeSchema(connection.db);
    expect(probed).toBe(false);

    // PostgreSQL itself is perfectly fine. Only the table is absent.
    expect(monitor.healthy()).toBe(true);
    expect(health.snapshot().assignmentSchemaPresent).toBe(false);
    expect(health.capability()).toBe(AssignmentCapability.SCHEMA_MISSING);
    expect(health.resolvable()).toBe(false);

    monitor.stop();
    await connection.disconnect();
  });

  live('recovers once the table exists, without a restart', async () => {
    const result = await connectPostgres(bareUrl, { probeTimeoutMs: 5_000 });
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

    await health.probeSchema(connection.db);
    expect(health.capability()).toBe(AssignmentCapability.SCHEMA_MISSING);

    // Apply the migration's table into the bare schema — the same DDL, minus the
    // foreign keys, which point at tables that live in `public`.
    await admin.$executeRawUnsafe(`
      CREATE TABLE ${BARE_SCHEMA}."campaign_agents" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "campaignId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "priority" INTEGER,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "campaign_agents_pkey" PRIMARY KEY ("id")
      )
    `);

    // No restart, no reconnect: the same live connection re-probes.
    const probed = await health.probeSchema(connection.db);
    expect(probed).toBe(true);
    expect(health.capability()).toBe(AssignmentCapability.RESOLVABLE);
    expect(health.resolvable()).toBe(true);

    await admin.$executeRawUnsafe(`DROP TABLE ${BARE_SCHEMA}."campaign_agents"`);
    monitor.stop();
    await connection.disconnect();
  });

  live('a lookup returning zero rows is a success, not a capability failure', async () => {
    // Against the real table in `public`, with a tenant that has no assignments.
    // On a fresh tenant this is the only result there is, and the old latch
    // reported it as the assignment source being unusable.
    const result = await connectPostgres(process.env.DIALER_V2_TEST_DATABASE_URL ?? '', {
      probeTimeoutMs: 5_000,
    });
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

    expect(await health.probeSchema(connection.db)).toBe(true);

    const rows = await connection.db.campaignAgent.findMany({
      where: { tenantId: 'tenant-that-does-not-exist', userId: 'nobody', status: 'ACTIVE' },
      select: { campaignId: true },
    });

    expect(rows).toEqual([]);
    expect(health.resolvable()).toBe(true);
    expect(health.capability()).toBe(AssignmentCapability.RESOLVABLE);

    monitor.stop();
    await connection.disconnect();
  });
});
