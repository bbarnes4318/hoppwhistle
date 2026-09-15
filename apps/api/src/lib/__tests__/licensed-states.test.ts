/**
 * What an AGENT's licence does and does not let them do.
 *
 * These are module tests rather than route tests on purpose. Every enforcement
 * point added in this change -- `agent/call/originate`, `agent/lead/lookup`,
 * `call-center/customer-lookup`, the three `insurance-leads` endpoints and
 * `prospects/intake` -- reaches its decision through `resolveStateAuthority` and
 * `permits`, so the decision matrix is provable once, here, instead of eight
 * times against a seeded database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  user: { findFirst: vi.fn() },
  insuranceLead: { findFirst: vi.fn() },
  lead: { findFirst: vi.fn() },
};

vi.mock('../prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

const {
  isStateRestrictedAgent,
  loadLicensedStates,
  normalizeLicensedStates,
  normalizeStateCode,
  partitionLicensedStates,
  permits,
  resolveStateAuthority,
  resolveStateForPhone,
  UNRESTRICTED,
} = await import('../licensed-states.js');

/** A user row carrying exactly this licence list. */
function userWithLicence(states: unknown) {
  return { metadata: states === undefined ? {} : { licensedStates: states } };
}

/** A request whose only authority is its authenticated principal. */
function requestAs(user: Record<string, unknown> | undefined) {
  return { user };
}

const AGENT = { userId: 'agent-1', tenantId: 'tenant-a', roles: ['AGENT'] };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findFirst.mockResolvedValue(userWithLicence(['TN']));
  mockPrisma.insuranceLead.findFirst.mockResolvedValue(null);
  mockPrisma.lead.findFirst.mockResolvedValue(null);
});

describe('normalizeStateCode', () => {
  it('canonicalises to the uppercase two-letter code the rest of the codebase uses', () => {
    expect(normalizeStateCode('TN')).toBe('TN');
    expect(normalizeStateCode('tn')).toBe('TN');
    expect(normalizeStateCode('  Tn  ')).toBe('TN');
  });

  it('resolves a full name rather than truncating it', () => {
    // `normalizeState()` in the insurance validator is toUpperCase().slice(0,2),
    // which answers "TE" here -- not a state, and silently not Tennessee.
    expect(normalizeStateCode('Tennessee')).toBe('TN');
    expect(normalizeStateCode('new  york')).toBe('NY');
  });

  it('refuses everything that is not a jurisdiction', () => {
    for (const junk of ['', '   ', 'XX', 'Tennesee', 'T', 'TNN', 42, null, undefined, {}, ['TN']]) {
      expect(normalizeStateCode(junk)).toBeNull();
    }
  });

  it('drops the unresolvable entries of a list and de-duplicates the rest', () => {
    expect(normalizeLicensedStates(['tn', 'Florida', 'XX', 'TN', 77])).toEqual(['FL', 'TN']);
    expect(normalizeLicensedStates('TN')).toEqual([]);
    expect(normalizeLicensedStates(undefined)).toEqual([]);
  });
});

describe('reporting a stored licence back to an operator', () => {
  // What `cli/agent-licenses.ts` and scripts/licensed-states-report.sh show.
  // A blocked agent needs to see WHY, so the entries enforcement drops are kept
  // rather than thrown away -- and they come from the same function that decides
  // what is enforced, so the report cannot disagree with the code.
  it('keeps the entries it drops, so a blocked agent has a visible cause', () => {
    expect(partitionLicensedStates(['Tennesee', 'XX'])).toEqual({
      licensed: [],
      rejected: ['Tennesee', 'XX'],
    });
  });

  it('reports a partly-rotten licence as the narrower list it really is', () => {
    expect(partitionLicensedStates(['TN', 'Atlantis'])).toEqual({
      licensed: ['TN'],
      rejected: ['Atlantis'],
    });
  });

  it('rejects a non-array outright rather than reporting it as absent', () => {
    // `licensedStates: "TN"` is a wrong type, not a missing licence, and saying
    // "no licence" would send somebody hunting a row that is already there.
    expect(partitionLicensedStates('TN')).toEqual({ licensed: [], rejected: ['TN'] });
  });

  it('separates absent from empty, and grants nothing for either', () => {
    expect(partitionLicensedStates(undefined)).toEqual({ licensed: [], rejected: [] });
    expect(partitionLicensedStates([])).toEqual({ licensed: [], rejected: [] });
  });

  it('agrees with what enforcement will honour', () => {
    const stored = ['fl', 'Tennessee', 'XX', 'TN'];
    expect(partitionLicensedStates(stored).licensed).toEqual(normalizeLicensedStates(stored));
  });
});

describe('who is subject to a licence', () => {
  it('restricts an AGENT', () => {
    expect(isStateRestrictedAgent(AGENT)).toBe(true);
  });

  it('does not restrict ADMIN, OWNER, or an agent who is also one of them', () => {
    expect(isStateRestrictedAgent({ userId: 'u', roles: ['ADMIN'] })).toBe(false);
    expect(isStateRestrictedAgent({ userId: 'u', roles: ['OWNER'] })).toBe(false);
    expect(isStateRestrictedAgent({ userId: 'u', roles: ['AGENT', 'ADMIN'] })).toBe(false);
  });

  it('leaves every other role exactly as it was', () => {
    for (const role of ['ANALYST', 'PUBLISHER', 'BUYER', 'READONLY']) {
      expect(isStateRestrictedAgent({ userId: 'u', roles: [role] })).toBe(false);
    }
    // An API-key principal has no user row and no roles.
    expect(isStateRestrictedAgent({ roles: [] })).toBe(false);
    expect(isStateRestrictedAgent(undefined)).toBe(false);
  });

  it('does not restrict a platform admin', () => {
    expect(
      isStateRestrictedAgent({ userId: 'op', roles: ['ADMIN', 'OWNER'], isPlatformAdmin: true })
    ).toBe(false);
    // Even one whose own row happens to carry AGENT.
    expect(isStateRestrictedAgent({ userId: 'op', roles: ['AGENT'], isPlatformAdmin: true })).toBe(
      false
    );
  });

  it('does restrict a platform admin who explicitly previews AS an agent', () => {
    expect(
      isStateRestrictedAgent({
        userId: 'op',
        roles: ['AGENT'],
        isPlatformAdmin: true,
        previewRole: 'AGENT',
      })
    ).toBe(true);
  });
});

describe('the licence comes from the database, in the acting tenant', () => {
  it('reads User.metadata.licensedStates for the authenticated user', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(userWithLicence(['tn', 'Florida']));

    const licensed = await loadLicensedStates('agent-1', 'tenant-a');

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'agent-1', tenantId: 'tenant-a' },
      select: { metadata: true },
    });
    expect([...licensed].sort()).toEqual(['FL', 'TN']);
  });

  it('denies when the user does not exist in that tenant', async () => {
    // Cross-tenant: the id is real, the tenant is somebody else's.
    mockPrisma.user.findFirst.mockResolvedValue(null);
    expect([...(await loadLicensedStates('agent-1', 'tenant-b'))]).toEqual([]);
  });

  it('ignores an agentId, publisherId or tenantId supplied by the request', async () => {
    const request = requestAs(AGENT) as Record<string, unknown>;
    request.body = { agentId: 'someone-else', tenantId: 'tenant-b', publisherId: 'pub-9' };
    request.query = { agentId: 'someone-else', state: 'FL' };
    request.headers = { 'x-demo-tenant-id': 'tenant-b' };

    await resolveStateAuthority(request, 'tenant-a');

    // The lookup used the authenticated principal and the tenant the handler
    // had already resolved -- nothing from the body, query or headers.
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'agent-1', tenantId: 'tenant-a' },
      select: { metadata: true },
    });
  });

  it('never trusts a licensedStates claim on the principal', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(userWithLicence(['TN']));

    const authority = await resolveStateAuthority(
      requestAs({ ...AGENT, licensedStates: ['FL', 'TX', 'CA'] }),
      'tenant-a'
    );

    expect(authority.restricted).toBe(true);
    expect(permits(authority, 'FL')).toBe(false);
    expect(permits(authority, 'TN')).toBe(true);
  });
});

describe('default deny', () => {
  const restricted = (states: string[]) => ({
    restricted: true as const,
    licensed: new Set(states),
  });

  it('denies an agent with no licensedStates key at all', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(userWithLicence(undefined));
    const authority = await resolveStateAuthority(requestAs(AGENT), 'tenant-a');
    expect(permits(authority, 'TN')).toBe(false);
  });

  it('denies an agent with an empty licensed-state set', () => {
    expect(permits(restricted([]), 'TN')).toBe(false);
  });

  it('denies an agent whose licence list normalises to empty', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(userWithLicence(['XX', 'Atlantis', 7]));
    const authority = await resolveStateAuthority(requestAs(AGENT), 'tenant-a');
    expect(permits(authority, 'TN')).toBe(false);
  });

  it('denies an unknown, invalid or absent state', () => {
    for (const junk of ['XX', '', null, undefined, 42, {}]) {
      expect(permits(restricted(['TN']), junk)).toBe(false);
    }
  });

  it('denies a valid state that is simply not licensed', () => {
    expect(permits(restricted(['TN']), 'FL')).toBe(false);
  });

  it('allows a licensed state however the caller spells it', () => {
    expect(permits(restricted(['TN']), 'TN')).toBe(true);
    expect(permits(restricted(['TN']), 'tn')).toBe(true);
    expect(permits(restricted(['TN']), 'Tennessee')).toBe(true);
  });

  it('applies no state rule at all to an unrestricted principal', () => {
    expect(permits(UNRESTRICTED, 'FL')).toBe(true);
    expect(permits(UNRESTRICTED, 'XX')).toBe(true);
    expect(permits(UNRESTRICTED, null)).toBe(true);
  });
});

describe('the regression this change exists to prevent', () => {
  it('accepts the licensed state and refuses the same request with another one', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(userWithLicence(['TN']));
    const authority = await resolveStateAuthority(requestAs(AGENT), 'tenant-a');

    // PATCH /api/v1/insurance-leads/:id { state: 'TN' } -- allowed.
    expect(permits(authority, 'TN')).toBe(true);

    // The identical request with the state swapped -- refused. This is the
    // bypass the PATCH guard closes: without it, rewriting a Florida lead's
    // state to TN would pull it inside a Tennessee-only agent's licence.
    expect(permits(authority, 'FL')).toBe(false);
  });
});

describe('the state of a dialled number comes from authoritative data', () => {
  it('prefers the agency CRM record over the area code', async () => {
    // A 615 number (Tennessee) whose CRM record says Florida.
    mockPrisma.insuranceLead.findFirst.mockResolvedValue({ state: 'fl' });

    expect(await resolveStateForPhone('tenant-a', '16155551234')).toEqual({
      kind: 'state',
      state: 'FL',
    });
    expect(mockPrisma.insuranceLead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-a', phone: { endsWith: '6155551234' } },
      })
    );
  });

  it('falls back to the generic lead, then to the area code', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue({ state: 'Florida' });
    expect(await resolveStateForPhone('tenant-a', '16155551234')).toEqual({
      kind: 'state',
      state: 'FL',
    });

    mockPrisma.lead.findFirst.mockResolvedValue(null);
    expect(await resolveStateForPhone('tenant-a', '16155551234')).toEqual({
      kind: 'state',
      state: 'TN',
    });
  });

  it('reports a record whose state cannot be read as unresolvable, not as no state', async () => {
    // Authoritative data is present and says something. Failing to parse it is
    // not permission to ignore it: the originate guard refuses this.
    mockPrisma.insuranceLead.findFirst.mockResolvedValue({ state: 'XX' });
    expect(await resolveStateForPhone('tenant-a', '16155551234')).toEqual({ kind: 'unresolvable' });
  });

  it('reports a non-geographic number with no record as carrying no state', async () => {
    // Toll-free. There is no jurisdiction to hold a licence in, so the
    // originate guard lets it through rather than stopping agents calling
    // carriers and their own office.
    expect(await resolveStateForPhone('tenant-a', '18005551234')).toEqual({ kind: 'none' });
  });

  it('scopes the CRM lookup to the tenant', async () => {
    await resolveStateForPhone('tenant-a', '16155551234');
    for (const call of mockPrisma.lead.findFirst.mock.calls) {
      expect(call[0].where.tenantId).toBe('tenant-a');
    }
  });
});
