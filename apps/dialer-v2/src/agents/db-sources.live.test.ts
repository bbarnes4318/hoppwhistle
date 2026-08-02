/**
 * Live PostgreSQL suite for the database-backed sources.
 *
 * The unit suite drives a hand-written `DialerV2Db` fake whose `findMany`
 * filters an array. That fake agrees with the production sources by
 * construction — it cannot tell you that `metadata` round-trips through JSONB
 * with numbers becoming numbers, that `tenantId: null` genuinely excludes rows
 * under `NOT: { tenantId: null }`, that the `status` predicate is compared
 * against a PostgreSQL enum rather than a string, or that a query is actually
 * tenant-scoped in SQL rather than only in the fake's filter.
 *
 * So this runs the real sources against the real `users` table, created from
 * the real `apps/api/prisma/schema.prisma`, through the real Prisma client.
 *
 * Skips when no database is reachable. CI sets
 * DIALER_V2_REQUIRE_LIVE_SERVICES=true, which turns "unreachable" into a
 * failure rather than a silent pass.
 *
 * NOTHING HERE TOUCHES PRODUCTION. The connection is an ephemeral service
 * container, and every row it creates is namespaced and deleted afterwards.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { connectLivePostgres, type LivePrisma } from '../testing/live-services.js';

import {
  AssignmentUnavailableReason,
  DatabaseAssignmentSource,
  DatabaseExtensionSource,
  type DialerV2Db,
} from './db-sources.js';
import { ExtensionRejection, ExtensionResolver } from './extension-resolver.js';

const DOMAIN = 'hopwhistle.com';
/** Every row this suite creates carries this marker, so cleanup is exact. */
const MARK = 'dialerv2-live';

let prisma: LivePrisma;
let available = false;
let skipReason = '';

beforeAll(async () => {
  const handle = await connectLivePostgres();
  available = handle.available;
  skipReason = handle.reason ?? '';
  if (available) prisma = handle.client;
});

async function cleanup() {
  // Users first: the FK to tenants is ON DELETE CASCADE, but deleting
  // explicitly keeps the intent obvious.
  await prisma.user.deleteMany({ where: { email: { contains: MARK } } });
  await prisma.tenant.deleteMany({ where: { slug: { contains: MARK } } });
}

afterEach(async () => {
  if (available) await cleanup();
});

afterAll(async () => {
  if (available) {
    await cleanup();
    await prisma.$disconnect();
  }
});

function live(name: string, fn: () => Promise<void>) {
  it(name, async () => {
    if (!available) {
      console.warn(`[live-postgres] skipped "${name}": ${skipReason}`);
      return;
    }
    await fn();
  });
}

/** The sources take this interface; in production it is a PrismaClient. */
const asDb = () => prisma as unknown as DialerV2Db;

let seq = 0;

async function makeTenant(suffix: string): Promise<string> {
  const row = await prisma.tenant.create({
    data: { name: `${MARK}-${suffix}`, slug: `${MARK}-${suffix}-${seq++}`, status: 'ACTIVE' },
  });
  return row.id as string;
}

async function makeUser(opts: {
  tenantId: string | null;
  metadata?: unknown;
  status?: string;
}): Promise<string> {
  const row = await prisma.user.create({
    data: {
      email: `${MARK}-${seq++}@example.test`,
      tenantId: opts.tenantId,
      status: opts.status ?? 'ACTIVE',
      metadata: opts.metadata ?? undefined,
    },
  });
  return row.id as string;
}

describe('the extension really lives in JSONB metadata', () => {
  live('round-trips a string extension through PostgreSQL', async () => {
    const tenantId = await makeTenant('t1');
    const userId = await makeUser({ tenantId, metadata: { extension: '1001' } });

    const source = new DatabaseExtensionSource({ db: asDb(), sipDomain: DOMAIN });
    const [binding] = await source.byAgent(tenantId, userId);

    expect(binding).toMatchObject({ tenantId, userId, agentId: userId, extension: '1001' });
  });

  live('a numeric extension survives JSONB as a number, not a quoted string', async () => {
    // agent-phone writes a number on some paths. JSONB preserves the JSON type,
    // so this arrives back as `1001` and must still normalise to '1001'.
    const tenantId = await makeTenant('t2');
    const userId = await makeUser({ tenantId, metadata: { extension: 1001 } });

    const source = new DatabaseExtensionSource({ db: asDb(), sipDomain: DOMAIN });
    const [binding] = await source.byAgent(tenantId, userId);
    expect(binding.extension).toBe('1001');
  });

  live('a user with no metadata at all yields no binding', async () => {
    const tenantId = await makeTenant('t3');
    const userId = await makeUser({ tenantId });

    const source = new DatabaseExtensionSource({ db: asDb(), sipDomain: DOMAIN });
    expect(await source.byAgent(tenantId, userId)).toEqual([]);
  });

  live('metadata present but with no extension yields no binding', async () => {
    const tenantId = await makeTenant('t4');
    const userId = await makeUser({ tenantId, metadata: { role: 'agent' } });

    const source = new DatabaseExtensionSource({ db: asDb(), sipDomain: DOMAIN });
    expect(await source.byAgent(tenantId, userId)).toEqual([]);
  });
});

describe('tenant scoping is enforced by SQL, not by a filter afterwards', () => {
  live('a user of another tenant is not returned', async () => {
    const tenantA = await makeTenant('a');
    const tenantB = await makeTenant('b');
    const userInB = await makeUser({ tenantId: tenantB, metadata: { extension: '1001' } });

    const source = new DatabaseExtensionSource({ db: asDb(), sipDomain: DOMAIN });
    expect(await source.byAgent(tenantA, userInB)).toEqual([]);
  });

  live('a suspended user resolves as disabled rather than missing', async () => {
    // The distinction is what makes the rejection actionable: DISABLED points at
    // the user record, NO_EXTENSION points at configuration.
    const tenantId = await makeTenant('susp');
    const userId = await makeUser({
      tenantId,
      status: 'SUSPENDED',
      metadata: { extension: '1002' },
    });

    const source = new DatabaseExtensionSource({ db: asDb(), sipDomain: DOMAIN });
    const [binding] = await source.byAgent(tenantId, userId);
    expect(binding.enabled).toBe(false);

    const resolver = new ExtensionResolver({ source });
    const result = await resolver.forAgent(tenantId, userId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe(ExtensionRejection.DISABLED);
  });

  live('an INACTIVE user is also disabled', async () => {
    const tenantId = await makeTenant('inact');
    const userId = await makeUser({
      tenantId,
      status: 'INACTIVE',
      metadata: { extension: '1003' },
    });

    const source = new DatabaseExtensionSource({ db: asDb(), sipDomain: DOMAIN });
    const [binding] = await source.byAgent(tenantId, userId);
    expect(binding.enabled).toBe(false);
  });
});

describe('SIP identity resolution against real rows', () => {
  live('resolves a registration to its owning tenant', async () => {
    const tenantId = await makeTenant('sip');
    await makeUser({ tenantId, metadata: { extension: '1005' } });

    const source = new DatabaseExtensionSource({ db: asDb(), sipDomain: DOMAIN });
    const resolver = new ExtensionResolver({ source });
    const result = await resolver.forSipIdentity('1005', DOMAIN);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.binding.tenantId).toBe(tenantId);
  });

  live('a NULL tenantId row is excluded by the NOT predicate in SQL', async () => {
    // SQL three-valued logic is the reason this is worth a live test: a naive
    // `tenantId != null` would match nothing at all rather than everything
    // non-null, and the fake's filter cannot show that.
    await makeUser({ tenantId: null, metadata: { extension: '1006' } });

    const source = new DatabaseExtensionSource({ db: asDb(), sipDomain: DOMAIN });
    expect(await source.bySipIdentity('1006', DOMAIN)).toEqual([]);
  });

  live('a genuine cross-tenant collision is rejected, not silently resolved', async () => {
    const tenantA = await makeTenant('coll-a');
    const tenantB = await makeTenant('coll-b');
    await makeUser({ tenantId: tenantA, metadata: { extension: '1007' } });
    await makeUser({ tenantId: tenantB, metadata: { extension: '1007' } });

    const source = new DatabaseExtensionSource({ db: asDb(), sipDomain: DOMAIN });
    const bindings = await source.bySipIdentity('1007', DOMAIN);
    expect(bindings).toHaveLength(2);

    const resolver = new ExtensionResolver({ source });
    const result = await resolver.forSipIdentity('1007', DOMAIN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe(ExtensionRejection.CROSS_TENANT);
  });

  live('two active users sharing an extension in one tenant is AMBIGUOUS', async () => {
    const tenantId = await makeTenant('amb');
    await makeUser({ tenantId, metadata: { extension: '1008' } });
    await makeUser({ tenantId, metadata: { extension: '1008' } });

    const resolver = new ExtensionResolver({
      source: new DatabaseExtensionSource({ db: asDb(), sipDomain: DOMAIN }),
    });
    const result = await resolver.forSipIdentity('1008', DOMAIN);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe(ExtensionRejection.AMBIGUOUS);
  });

  live('a suspended duplicate does not create a false collision', async () => {
    // Only ACTIVE rows are fetched, so a deactivated former holder of an
    // extension must not block the current one.
    const tenantId = await makeTenant('reissue');
    await makeUser({ tenantId, status: 'SUSPENDED', metadata: { extension: '1009' } });
    await makeUser({ tenantId, metadata: { extension: '1009' } });

    const resolver = new ExtensionResolver({
      source: new DatabaseExtensionSource({ db: asDb(), sipDomain: DOMAIN }),
    });
    expect((await resolver.forSipIdentity('1009', DOMAIN)).ok).toBe(true);
  });

  live('refuses a SIP domain this deployment does not serve', async () => {
    const tenantId = await makeTenant('dom');
    await makeUser({ tenantId, metadata: { extension: '1010' } });

    const source = new DatabaseExtensionSource({ db: asDb(), sipDomain: DOMAIN });
    expect(await source.bySipIdentity('1010', 'attacker.example.com')).toEqual([]);
  });
});

describe('assignments against the real schema', () => {
  live('confirms the schema still has no agent-to-campaign relation', async () => {
    // If this ever starts failing, the schema gained an assignment model and
    // DatabaseAssignmentSource should be implemented rather than fail closed.
    const columns = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`
    );
    const names = columns.map(c => c.column_name);

    expect(names).toContain('metadata');
    expect(names).toContain('tenantId');
    // No extension column, and no campaign linkage on the user.
    expect(names).not.toContain('extension');
    expect(names.filter(n => n.toLowerCase().includes('campaign'))).toEqual([]);

    const joinTables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND (table_name ILIKE '%agent_campaign%'
            OR table_name ILIKE '%campaign_agent%'
            OR table_name ILIKE '%campaign_user%'
            OR table_name ILIKE '%user_campaign%')`
    );
    expect(joinTables).toEqual([]);
  });

  live('resolves a real user to no campaigns and reports why', async () => {
    const tenantId = await makeTenant('assign');
    const userId = await makeUser({ tenantId, metadata: { extension: '1011' } });

    const reasons: AssignmentUnavailableReason[] = [];
    const source = new DatabaseAssignmentSource({
      db: asDb(),
      onUnavailable: r => reasons.push(r),
    });

    const assignment = await source.resolve(tenantId, userId);
    expect(assignment).toMatchObject({ tenantId, agentId: userId, campaignIds: [], queueIds: [] });
    expect(reasons).toEqual([AssignmentUnavailableReason.NO_SCHEMA_SUPPORT]);
  });

  live('returns null across tenants', async () => {
    const tenantA = await makeTenant('as-a');
    const tenantB = await makeTenant('as-b');
    const userInB = await makeUser({ tenantId: tenantB });

    const source = new DatabaseAssignmentSource({ db: asDb() });
    expect(await source.resolve(tenantA, userInB)).toBeNull();
  });

  live('returns null for a suspended user', async () => {
    const tenantId = await makeTenant('as-susp');
    const userId = await makeUser({ tenantId, status: 'SUSPENDED' });

    const source = new DatabaseAssignmentSource({ db: asDb() });
    expect(await source.resolve(tenantId, userId)).toBeNull();
  });
});

describe('a real database failure fails closed', () => {
  live('reports LOOKUP_FAILED rather than granting capacity', async () => {
    // Query a table that does not exist, so PostgreSQL — not a mock — raises.
    const broken: DialerV2Db = {
      user: {
        findMany: () => prisma.$queryRawUnsafe('SELECT * FROM table_that_does_not_exist'),
      },
      campaignAgent: {
        findMany: () => prisma.$queryRawUnsafe('SELECT * FROM table_that_does_not_exist'),
      },
    };

    const resolver = new ExtensionResolver({
      source: new DatabaseExtensionSource({ db: broken, sipDomain: DOMAIN }),
    });
    const result = await resolver.forAgent('tenant-a', 'user-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe(ExtensionRejection.LOOKUP_FAILED);
  });
});
