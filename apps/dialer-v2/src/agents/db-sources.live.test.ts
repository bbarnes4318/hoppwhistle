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

/**
 * A campaign needs a publisher, so both are created.
 *
 * Raw SQL rather than the generated client: the point is to write the rows the
 * production tables hold, and `campaign_agents` has no generated model until
 * `prisma generate` has run against the new schema.
 */
async function makeCampaign(tenantId: string): Promise<string> {
  const publisherId = `${MARK}-pub-${seq++}`;
  const campaignId = `${MARK}-camp-${seq++}`;

  await prisma.$executeRawUnsafe(
    // `code` is NOT NULL with no default, so it has to be supplied. Derived
    // from the id so it is unique per row without needing a counter.
    `INSERT INTO publishers (id, "tenantId", name, code, status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())`,
    publisherId,
    tenantId,
    `${MARK} publisher`,
    publisherId
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO campaigns (id, "tenantId", "publisherId", name, status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())`,
    campaignId,
    tenantId,
    publisherId,
    `${MARK} campaign`
  );
  return campaignId;
}

async function assign(
  tenantId: string,
  campaignId: string,
  userId: string,
  status = 'ACTIVE'
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO campaign_agents (id, "tenantId", "campaignId", "userId", status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5::"CampaignAgentStatus", NOW(), NOW())`,
    `${MARK}-assign-${seq++}`,
    tenantId,
    campaignId,
    userId,
    status
  );
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
  live('confirms the assignment table exists with the shape the source reads', async () => {
    // This used to assert the OPPOSITE — that no agent-to-campaign relation
    // existed anywhere — because the schema modelled none and the source failed
    // closed. Migration 20260802000000 adds one, so the assertion inverts: if
    // the table ever disappears, assignment resolution silently returns nothing
    // and every campaign forecast counts zero agents again.
    const columns = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'campaign_agents'`
    );
    const names = columns.map(c => c.column_name);

    expect(names).toContain('tenantId');
    expect(names).toContain('campaignId');
    expect(names).toContain('userId');
    expect(names).toContain('status');

    // Still no extension column on users — the extension lives in metadata.
    const userColumns = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`
    );
    expect(userColumns.map(c => c.column_name)).not.toContain('extension');
  });

  live('enforces one assignment per agent per campaign', async () => {
    // A duplicate would double-count that agent in the campaign's available
    // capacity, which is the number the controller multiplies by lines-per-agent.
    const indexes = await prisma.$queryRawUnsafe<Array<{ indexdef: string }>>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'campaign_agents'`
    );
    const unique = indexes.map(i => i.indexdef).filter(d => d.includes('UNIQUE'));
    expect(unique.some(d => /tenantId[\s\S]*campaignId[\s\S]*userId/.test(d))).toBe(true);
  });

  live('resolves a real user to a real campaign', async () => {
    const tenantId = await makeTenant('assign');
    const userId = await makeUser({ tenantId, metadata: { extension: '1011' } });
    const campaignId = await makeCampaign(tenantId);
    await assign(tenantId, campaignId, userId);

    const reasons: AssignmentUnavailableReason[] = [];
    const source = new DatabaseAssignmentSource({
      db: asDb(),
      onUnavailable: r => reasons.push(r),
    });

    const assignment = await source.resolve(tenantId, userId);
    expect(assignment).toMatchObject({ tenantId, agentId: userId, campaignIds: [campaignId] });
    // Nothing is unavailable, so nothing is reported.
    expect(reasons).toEqual([]);
  });

  live('a disabled assignment grants nothing', async () => {
    const tenantId = await makeTenant('assign-off');
    const userId = await makeUser({ tenantId, metadata: { extension: '1012' } });
    const campaignId = await makeCampaign(tenantId);
    await assign(tenantId, campaignId, userId, 'INACTIVE');

    const source = new DatabaseAssignmentSource({ db: asDb() });
    expect(await source.resolve(tenantId, userId)).toMatchObject({ campaignIds: [] });
  });

  live('revoking the assignment removes the capacity', async () => {
    const tenantId = await makeTenant('assign-rev');
    const userId = await makeUser({ tenantId, metadata: { extension: '1013' } });
    const campaignId = await makeCampaign(tenantId);
    await assign(tenantId, campaignId, userId);

    const source = new DatabaseAssignmentSource({ db: asDb() });
    expect((await source.resolve(tenantId, userId))?.campaignIds).toEqual([campaignId]);

    await prisma.$executeRawUnsafe(
      `DELETE FROM campaign_agents WHERE "tenantId" = $1 AND "userId" = $2`,
      tenantId,
      userId
    );
    expect((await source.resolve(tenantId, userId))?.campaignIds).toEqual([]);
  });

  live('one agent can hold several campaigns', async () => {
    const tenantId = await makeTenant('assign-multi');
    const userId = await makeUser({ tenantId, metadata: { extension: '1014' } });
    const first = await makeCampaign(tenantId);
    const second = await makeCampaign(tenantId);
    await assign(tenantId, first, userId);
    await assign(tenantId, second, userId);

    const source = new DatabaseAssignmentSource({ db: asDb() });
    const result = await source.resolve(tenantId, userId);
    expect(result?.campaignIds.sort()).toEqual([first, second].sort());
  });

  live('a suspended user grants nothing even with a live assignment', async () => {
    // An assignment row outliving a suspended user must not keep granting
    // capacity.
    const tenantId = await makeTenant('assign-susp');
    const userId = await makeUser({
      tenantId,
      status: 'SUSPENDED',
      metadata: { extension: '1015' },
    });
    const campaignId = await makeCampaign(tenantId);
    await assign(tenantId, campaignId, userId);

    const source = new DatabaseAssignmentSource({ db: asDb() });
    expect(await source.resolve(tenantId, userId)).toBeNull();
  });

  live('a cross-tenant assignment cannot resolve', async () => {
    // The unique constraint does not prevent a row pairing a tenant with
    // another tenant's campaign, so the query checks the campaign's own tenant.
    const tenantA = await makeTenant('x-a');
    const tenantB = await makeTenant('x-b');
    const userInA = await makeUser({ tenantId: tenantA, metadata: { extension: '1016' } });
    const campaignInB = await makeCampaign(tenantB);

    await prisma.$executeRawUnsafe(
      `INSERT INTO campaign_agents (id, "tenantId", "campaignId", "userId", status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())`,
      `${tenantA}-cross`,
      tenantA,
      campaignInB,
      userInA
    );

    const source = new DatabaseAssignmentSource({ db: asDb() });
    expect((await source.resolve(tenantA, userInA))?.campaignIds).toEqual([]);
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
