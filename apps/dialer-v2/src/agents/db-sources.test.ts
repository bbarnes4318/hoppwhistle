import { describe, expect, it, vi } from 'vitest';

import {
  AssignmentUnavailableReason,
  DatabaseAssignmentSource,
  DatabaseExtensionSource,
  extensionFromMetadata,
  type DialerV2Db,
} from './db-sources.js';
import { ExtensionRejection, ExtensionResolver } from './extension-resolver.js';

const DOMAIN = 'hopwhistle.com';

/** Rows shaped exactly like the real `users` table selection. */
function db(rows: Array<Record<string, unknown>>): DialerV2Db & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    user: {
      findMany: (args: { where: Record<string, unknown> }) => {
        calls.push(args.where);
        const w = args.where;
        return Promise.resolve(
          rows.filter(r => {
            if (typeof w.id === 'string' && r.id !== w.id) return false;
            if (typeof w.tenantId === 'string' && r.tenantId !== w.tenantId) return false;
            if (typeof w.status === 'string' && r.status !== w.status) return false;
            if (w.NOT && (w.NOT as { tenantId?: null }).tenantId === null && !r.tenantId) {
              return false;
            }
            return true;
          })
        );
      },
    },
  };
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    tenantId: 'tenant-a',
    status: 'ACTIVE',
    metadata: { extension: '1001' },
    ...overrides,
  };
}

describe('extension lives in User.metadata', () => {
  it('reads the shape agent-phone actually writes', () => {
    // There is no extension column; agent-phone stores it in metadata JSON and
    // writes it as a string in some paths and a number in others.
    expect(extensionFromMetadata({ extension: '1001' })).toBe('1001');
    expect(extensionFromMetadata({ extension: 1001 })).toBe('1001');
    expect(extensionFromMetadata({ extension: ' 1001 ' })).toBe('1001');
  });

  it('returns null for anything unusable', () => {
    for (const input of [null, undefined, {}, { extension: '' }, { extension: {} }, 'x', 42]) {
      expect(extensionFromMetadata(input)).toBeNull();
    }
  });
});

describe('DatabaseExtensionSource.byAgent', () => {
  it('resolves an active user to a binding', async () => {
    const source = new DatabaseExtensionSource({ db: db([userRow()]), sipDomain: DOMAIN });
    const [binding] = await source.byAgent('tenant-a', 'user-1');

    expect(binding).toMatchObject({
      tenantId: 'tenant-a',
      userId: 'user-1',
      agentId: 'user-1',
      extension: '1001',
      sipDomain: DOMAIN,
      enabled: true,
    });
  });

  it('scopes the query by tenant rather than filtering afterwards', async () => {
    const client = db([userRow()]);
    const source = new DatabaseExtensionSource({ db: client, sipDomain: DOMAIN });
    await source.byAgent('tenant-a', 'user-1');

    // A cross-tenant row must never be fetched in the first place.
    expect(client.calls[0]).toMatchObject({ id: 'user-1', tenantId: 'tenant-a' });
  });

  it('returns nothing for another tenant user', async () => {
    const source = new DatabaseExtensionSource({
      db: db([userRow({ tenantId: 'tenant-b' })]),
      sipDomain: DOMAIN,
    });
    expect(await source.byAgent('tenant-a', 'user-1')).toEqual([]);
  });

  it('marks a suspended user as disabled rather than omitting them', async () => {
    // The distinction matters: the resolver reports DISABLED, which is
    // actionable, instead of NO_EXTENSION, which looks like misconfiguration.
    const source = new DatabaseExtensionSource({
      db: db([userRow({ status: 'SUSPENDED' })]),
      sipDomain: DOMAIN,
    });
    const [binding] = await source.byAgent('tenant-a', 'user-1');
    expect(binding.enabled).toBe(false);
  });

  it('returns nothing for a user with no extension in metadata', async () => {
    const source = new DatabaseExtensionSource({
      db: db([userRow({ metadata: {} })]),
      sipDomain: DOMAIN,
    });
    expect(await source.byAgent('tenant-a', 'user-1')).toEqual([]);
  });

  it('returns nothing for a user with a null tenant', async () => {
    const source = new DatabaseExtensionSource({
      db: db([userRow({ tenantId: null })]),
      sipDomain: DOMAIN,
    });
    expect(await source.byAgent('tenant-a', 'user-1')).toEqual([]);
  });
});

describe('DatabaseExtensionSource.bySipIdentity', () => {
  it('resolves a registration to its verified tenant', async () => {
    const source = new DatabaseExtensionSource({ db: db([userRow()]), sipDomain: DOMAIN });
    const [binding] = await source.bySipIdentity('1001', DOMAIN);
    expect(binding.tenantId).toBe('tenant-a');
  });

  it('refuses a domain this deployment does not serve', async () => {
    const source = new DatabaseExtensionSource({ db: db([userRow()]), sipDomain: DOMAIN });
    expect(await source.bySipIdentity('1001', 'attacker.example.com')).toEqual([]);
  });

  it('returns BOTH rows on a cross-tenant collision so the resolver can reject it', async () => {
    // A tenant-scoped query here would hide the collision and silently pick one.
    const source = new DatabaseExtensionSource({
      db: db([userRow(), userRow({ id: 'user-9', tenantId: 'tenant-b' })]),
      sipDomain: DOMAIN,
    });
    const bindings = await source.bySipIdentity('1001', DOMAIN);
    expect(bindings).toHaveLength(2);

    const resolver = new ExtensionResolver({ source });
    const result = await resolver.forSipIdentity('1001', DOMAIN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe(ExtensionRejection.CROSS_TENANT);
  });

  it('rejects two active users sharing one extension in the same tenant', async () => {
    const source = new DatabaseExtensionSource({
      db: db([userRow(), userRow({ id: 'user-2' })]),
      sipDomain: DOMAIN,
    });
    const resolver = new ExtensionResolver({ source });
    const result = await resolver.forSipIdentity('1001', DOMAIN);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe(ExtensionRejection.AMBIGUOUS);
  });

  it('does not match a different extension', async () => {
    const source = new DatabaseExtensionSource({ db: db([userRow()]), sipDomain: DOMAIN });
    expect(await source.bySipIdentity('9999', DOMAIN)).toEqual([]);
  });
});

describe('database failure fails closed', () => {
  it('reports LOOKUP_FAILED rather than granting capacity', async () => {
    const broken: DialerV2Db = {
      user: { findMany: () => Promise.reject(new Error('connection refused')) },
    };
    const resolver = new ExtensionResolver({
      source: new DatabaseExtensionSource({ db: broken, sipDomain: DOMAIN }),
    });

    const result = await resolver.forAgent('tenant-a', 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe(ExtensionRejection.LOOKUP_FAILED);
  });
});

describe('DatabaseAssignmentSource', () => {
  it('resolves no campaigns, because the schema models no agent-campaign link', async () => {
    // Not an oversight. There is no join table, no relation on User, no
    // relation on Campaign, and no Queue/Team/Skill model. Returning a wildcard
    // would put every agent in every campaign and inflate predictive capacity.
    const onUnavailable = vi.fn();
    const source = new DatabaseAssignmentSource({ db: db([userRow()]), onUnavailable });

    const assignment = await source.resolve('tenant-a', 'user-1');
    expect(assignment).toMatchObject({ campaignIds: [], queueIds: [] });
    expect(onUnavailable).toHaveBeenCalledWith(AssignmentUnavailableReason.NO_SCHEMA_SUPPORT);
  });

  it('returns null for an unknown user', async () => {
    const source = new DatabaseAssignmentSource({ db: db([]) });
    expect(await source.resolve('tenant-a', 'nobody')).toBeNull();
  });

  it('returns null for a disabled user', async () => {
    const source = new DatabaseAssignmentSource({
      db: db([userRow({ status: 'SUSPENDED' })]),
    });
    expect(await source.resolve('tenant-a', 'user-1')).toBeNull();
  });

  it('returns null across tenants', async () => {
    const source = new DatabaseAssignmentSource({ db: db([userRow({ tenantId: 'tenant-b' })]) });
    expect(await source.resolve('tenant-a', 'user-1')).toBeNull();
  });

  it('never reports NO_SCHEMA_SUPPORT for a user it could not resolve', async () => {
    const onUnavailable = vi.fn();
    const source = new DatabaseAssignmentSource({ db: db([]), onUnavailable });
    await source.resolve('tenant-a', 'nobody');
    expect(onUnavailable).not.toHaveBeenCalled();
  });
});
