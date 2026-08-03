/**
 * Assignment capability health.
 *
 * The behaviour under test is a replacement for one line:
 *
 *     if (result && result.campaignIds.length > 0) assignmentsWork = true;
 *
 * which was wrong in both directions at once — an unassigned agent read as
 * broken, and a broken source read as working forever after one success.
 */

import { describe, expect, it } from 'vitest';

import type { DialerV2Db } from '../agents/db-sources.js';

import {
  AssignmentCapability,
  AssignmentHealth,
  AssignmentLookupOutcome,
} from './assignment-health.js';

const healthy = (over: { configured?: boolean; reachable?: boolean } = {}) =>
  new AssignmentHealth({
    configured: over.configured ?? true,
    databaseReachable: () => over.reachable ?? true,
  });

const dbWhere = (campaignAgent: () => Promise<Array<Record<string, unknown>>>): DialerV2Db =>
  ({
    user: { findMany: () => Promise.resolve([]) },
    campaignAgent: { findMany: campaignAgent },
  }) as unknown as DialerV2Db;

describe('capability before anything has been observed', () => {
  it('is not-yet-probed rather than resolvable', () => {
    // Claiming resolvable before proving the table exists would report a missing
    // migration as a healthy service until the first agent logged in.
    expect(healthy().capability()).toBe(AssignmentCapability.NOT_YET_PROBED);
    expect(healthy().resolvable()).toBe(false);
  });

  it('leaves the schema state genuinely unknown, not false', () => {
    // Three states, not two. "We have not looked" is different from "we looked
    // and it is not there", and only the second is a deployment fault.
    expect(healthy().snapshot().assignmentSchemaPresent).toBeNull();
  });
});

describe('a healthy database-backed source', () => {
  it('becomes resolvable once the schema probe passes', async () => {
    const health = healthy();
    await health.probeSchema(dbWhere(() => Promise.resolve([])));
    expect(health.capability()).toBe(AssignmentCapability.RESOLVABLE);
  });

  it('stays resolvable for an agent with no assignments', async () => {
    // The case the old latch got backwards. A lookup that ran and correctly
    // returned nothing is a success; on a fresh tenant it is the ONLY result.
    const health = healthy();
    await health.probeSchema(dbWhere(() => Promise.resolve([])));
    health.recordLookup(AssignmentLookupOutcome.SUCCESS);

    expect(health.resolvable()).toBe(true);
    expect(health.snapshot().lastAssignmentLookupSucceeded).toBe(true);
  });

  it('stays resolvable for an agent who does have assignments', async () => {
    const health = healthy();
    await health.probeSchema(dbWhere(() => Promise.resolve([{ campaignId: 'c1' }])));
    health.recordLookup(AssignmentLookupOutcome.SUCCESS);
    expect(health.resolvable()).toBe(true);
  });

  it('records when the lookup happened', () => {
    const health = healthy();
    health.recordLookup(AssignmentLookupOutcome.SUCCESS);
    expect(health.snapshot().lastAssignmentLookupAtMs).not.toBeNull();
    expect(health.snapshot().lastAssignmentLookupFailureAtMs).toBeNull();
  });
});

describe('the static fixture source is never evidence', () => {
  it('reports source-not-database rather than unhealthy', () => {
    // Development is a legitimate configuration. It is simply not one whose
    // shadow history can be promoted on, and the distinction belongs in health
    // rather than in a boolean that reads as an outage.
    const health = healthy({ configured: false });
    expect(health.capability()).toBe(AssignmentCapability.SOURCE_NOT_DATABASE);
    expect(health.resolvable()).toBe(false);
    expect(health.snapshot().assignmentSourceConfigured).toBe(false);
  });

  it('stays unresolvable even after a successful-looking lookup', () => {
    const health = healthy({ configured: false });
    health.recordLookup(AssignmentLookupOutcome.SUCCESS);
    expect(health.capability()).toBe(AssignmentCapability.SOURCE_NOT_DATABASE);
  });
});

describe('a missing migration is named as such', () => {
  it('detects the absent table from the probe', async () => {
    const health = healthy();
    const ok = await health.probeSchema(
      dbWhere(() => Promise.reject(new Error('relation "campaign_agents" does not exist')))
    );

    expect(ok).toBe(false);
    expect(health.snapshot().assignmentSchemaPresent).toBe(false);
    expect(health.capability()).toBe(AssignmentCapability.SCHEMA_MISSING);
  });

  it('does not record a schema fact when the probe failed for an unrelated reason', async () => {
    // A connection dropping mid-probe says nothing about whether the table
    // exists. Recording false would blame the migration for an outage.
    const health = healthy();
    await health.probeSchema(dbWhere(() => Promise.reject(new Error("Can't reach database"))));
    expect(health.snapshot().assignmentSchemaPresent).toBeNull();
  });

  it('reports schema-missing from a lookup too', () => {
    const health = healthy();
    health.recordLookup(AssignmentLookupOutcome.SCHEMA_MISSING);
    expect(health.capability()).toBe(AssignmentCapability.SCHEMA_MISSING);
  });
});

describe('capability falls when the database does', () => {
  it('stops being resolvable after a previously successful lookup', async () => {
    // The latch's defining defect: once true, permanently true.
    let reachable = true;
    const health = new AssignmentHealth({
      configured: true,
      databaseReachable: () => reachable,
    });
    await health.probeSchema(dbWhere(() => Promise.resolve([])));
    health.recordLookup(AssignmentLookupOutcome.SUCCESS);
    expect(health.resolvable()).toBe(true);

    reachable = false;
    expect(health.resolvable()).toBe(false);
    expect(health.capability()).toBe(AssignmentCapability.DATABASE_UNREACHABLE);
  });

  it('ranks an unreachable database above a previously observed schema', async () => {
    // Nothing can be resolved through a database that is down, however good the
    // schema was last time anyone looked.
    const health = new AssignmentHealth({ configured: true, databaseReachable: () => false });
    await health.probeSchema(dbWhere(() => Promise.resolve([])));
    expect(health.capability()).toBe(AssignmentCapability.DATABASE_UNREACHABLE);
  });

  it('reports lookup-failing when the database is up but queries error', async () => {
    const health = healthy();
    await health.probeSchema(dbWhere(() => Promise.resolve([])));
    health.recordLookup(AssignmentLookupOutcome.FAILED);
    expect(health.capability()).toBe(AssignmentCapability.LOOKUP_FAILING);
  });

  it('leaves the schema state alone when a lookup merely failed', async () => {
    const health = healthy();
    await health.probeSchema(dbWhere(() => Promise.resolve([])));
    health.recordLookup(AssignmentLookupOutcome.FAILED);
    expect(health.snapshot().assignmentSchemaPresent).toBe(true);
  });
});

describe('capability recovers', () => {
  it('returns to resolvable once the database answers and a lookup succeeds', async () => {
    let reachable = true;
    const health = new AssignmentHealth({
      configured: true,
      databaseReachable: () => reachable,
    });
    await health.probeSchema(dbWhere(() => Promise.resolve([])));

    reachable = false;
    health.recordLookup(AssignmentLookupOutcome.FAILED);
    expect(health.resolvable()).toBe(false);

    reachable = true;
    expect(health.capability()).toBe(AssignmentCapability.LOOKUP_FAILING);

    health.recordLookup(AssignmentLookupOutcome.SUCCESS);
    expect(health.resolvable()).toBe(true);
  });

  it('re-probing after a migration is applied restores capability', async () => {
    const health = healthy();
    let migrated = false;
    const db = dbWhere(() =>
      migrated
        ? Promise.resolve([])
        : Promise.reject(new Error('relation "campaign_agents" does not exist'))
    );

    await health.probeSchema(db);
    expect(health.capability()).toBe(AssignmentCapability.SCHEMA_MISSING);

    migrated = true;
    await health.probeSchema(db);
    expect(health.capability()).toBe(AssignmentCapability.RESOLVABLE);
  });
});

describe('the schema probe reads no tenant rows', () => {
  it('scopes the probe to a tenant predicate that cannot match', async () => {
    let seen: Record<string, unknown> | undefined;
    const health = healthy();
    await health.probeSchema({
      user: { findMany: () => Promise.resolve([]) },
      campaignAgent: {
        findMany: (args: { where: Record<string, unknown>; take?: number }) => {
          seen = args.where;
          expect(args.take).toBe(0);
          return Promise.resolve([]);
        },
      },
    } as unknown as DialerV2Db);

    // Proving the relation exists must not become a way to read assignments.
    expect(seen).toEqual({ tenantId: '', userId: '' });
  });
});
