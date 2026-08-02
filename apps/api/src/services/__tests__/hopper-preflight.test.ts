import { describe, expect, it, vi } from 'vitest';

import {
  analyzeHopperPreflight,
  formatHopperPreflight,
  probeHopperPreflight,
  type HopperPreflightFacts,
  type PreflightQueryClient,
} from '../hopper-preflight.js';

function facts(overrides: Partial<HopperPreflightFacts> = {}): HopperPreflightFacts {
  return {
    leadStatusEnumExists: true,
    leadStatusValues: ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST', 'DO_NOT_CALL'],
    dialingValueExists: false,
    activeCampaigns: 3,
    newLeadsInActiveCampaigns: 5_000,
    immediatelyDialableFirstCycle: 10,
    workerDialerEnabled: true,
    workerDialerDetail: 'started unconditionally',
    maxConcurrentCalls: 10,
    dialerBatchSize: 50,
    eslReachable: true,
    eslDetail: 'ok',
    fractelGatewaysConfigured: true,
    fractelGatewayNames: ['fractel1'],
    fractelPoolNumberCount: 12,
    tenantsWithoutCallerIdPool: 0,
    ...overrides,
  };
}

describe('enum verdict', () => {
  it('confirms the audit finding when DIALING is absent from the live enum', () => {
    const report = analyzeHopperPreflight(facts({ dialingValueExists: false }));
    expect(report.hopperBlockedByEnum).toBe(true);
    expect(report.findings.join(' ')).toContain('CONFIRMED LIVE');
  });

  it('contradicts the audit finding when the live enum does contain DIALING', () => {
    // schema.prisma is not the deployed schema, so this branch has to exist.
    const report = analyzeHopperPreflight(
      facts({ dialingValueExists: true, leadStatusValues: ['NEW', 'DIALING', 'CONTACTED'] })
    );
    expect(report.hopperBlockedByEnum).toBe(false);
    expect(report.verdict).toBe('HOPPER_MAY_ALREADY_BE_DIALING');
    expect(report.findings.join(' ')).toContain('may be dialing right now');
    expect(report.warnings.join(' ')).toContain('differs from the checked-in schema');
  });

  it('refuses to guess when the enum does not exist at all', () => {
    const report = analyzeHopperPreflight(
      facts({ leadStatusEnumExists: false, leadStatusValues: [] })
    );
    expect(report.verdict).toBe('INDETERMINATE');
    expect(report.repairWouldStartCallsImmediately).toBe(false);
  });
});

describe('would a repair start real calls', () => {
  it('says yes when work is queued and the dialing path is intact', () => {
    const report = analyzeHopperPreflight(facts());
    expect(report.repairWouldStartCallsImmediately).toBe(true);
    expect(report.verdict).toBe('REPAIR_WOULD_START_CALLS_IMMEDIATELY');
  });

  it('says no when there are no ACTIVE campaigns', () => {
    const report = analyzeHopperPreflight(
      facts({ activeCampaigns: 0, newLeadsInActiveCampaigns: 0, immediatelyDialableFirstCycle: 0 })
    );
    expect(report.repairWouldStartCallsImmediately).toBe(false);
    expect(report.verdict).toBe('REPAIR_WOULD_NOT_START_CALLS');
  });

  it('says no when ACTIVE campaigns hold no NEW leads', () => {
    const report = analyzeHopperPreflight(
      facts({ newLeadsInActiveCampaigns: 0, immediatelyDialableFirstCycle: 0 })
    );
    expect(report.repairWouldStartCallsImmediately).toBe(false);
  });

  it.each([
    ['worker disabled', { workerDialerEnabled: false }],
    ['ESL unreachable', { eslReachable: false }],
    ['no FracTEL gateways', { fractelGatewaysConfigured: false }],
  ])('says no when %s, but still reports the blocked Hopper', (_name, override) => {
    const report = analyzeHopperPreflight(facts(override));
    expect(report.repairWouldStartCallsImmediately).toBe(false);
    expect(report.verdict).toBe('HOPPER_BLOCKED_NO_CALLS_POSSIBLE');
    expect(report.hopperBlockedByEnum).toBe(true);
  });
});

describe('caller-ID exposure', () => {
  it('warns when an active tenant would fall back to the hard-coded caller ID', () => {
    const report = analyzeHopperPreflight(facts({ tenantsWithoutCallerIdPool: 2 }));
    expect(report.warnings.join(' ')).toContain('hard-coded OUTBOUND_CALLER_ID');
    expect(report.warnings.join(' ')).toContain('F-6');
  });

  it('stays quiet when every active tenant has its own pool', () => {
    const report = analyzeHopperPreflight(facts({ tenantsWithoutCallerIdPool: 0 }));
    expect(report.warnings.join(' ')).not.toContain('OUTBOUND_CALLER_ID');
  });
});

describe('formatting', () => {
  it('renders without throwing and flags an imminent-call repair', () => {
    const text = formatHopperPreflight(analyzeHopperPreflight(facts()));
    expect(text).toContain('read-only');
    expect(text).toContain('REPAIR_WOULD_START_CALLS_IMMEDIATELY');
    expect(text).toContain('WOULD place real outbound telephone calls');
  });

  it('never prints a host, password, or connection string', () => {
    const text = formatHopperPreflight(
      analyzeHopperPreflight(facts({ eslDetail: 'TCP connect to port 8021 succeeded' }))
    );
    expect(text).not.toMatch(/postgres:\/\//);
    expect(text).not.toMatch(/ClueCon/i);
    expect(text).not.toMatch(/password/i);
  });
});

describe('probe', () => {
  /** Routes each SELECT to a canned result by matching on its text. */
  function fakeDb(counts: Record<string, number>, enumValues: string[]): PreflightQueryClient {
    return {
      $queryRawUnsafe: vi.fn((query: string) => {
        if (query.includes('pg_enum')) return Promise.resolve(enumValues.map(value => ({ value })));
        if (query.includes('FROM "campaigns" WHERE status'))
          return Promise.resolve([{ count: counts.campaigns }]);
        if (query.includes('FROM "leads"')) return Promise.resolve([{ count: counts.leads }]);
        if (query.includes('EXCEPT'))
          return Promise.resolve([{ count: counts.tenantsWithoutPool }]);
        if (query.includes('phone_numbers'))
          return Promise.resolve([{ count: counts.poolNumbers }]);
        return Promise.reject(new Error(`unexpected query: ${query}`));
      }) as PreflightQueryClient['$queryRawUnsafe'],
    };
  }

  const deps = (db: PreflightQueryClient, env = {}) => ({
    db,
    env,
    checkEsl: vi.fn(() => Promise.resolve({ reachable: true, detail: 'ok' })),
  });

  it('issues only SELECT statements', async () => {
    const db = fakeDb({ campaigns: 1, leads: 100, poolNumbers: 4, tenantsWithoutPool: 0 }, ['NEW']);
    await probeHopperPreflight(deps(db));

    const calls = (db.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [query] of calls) {
      expect(String(query).trimStart().toUpperCase().startsWith('SELECT')).toBe(true);
      expect(String(query)).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/i);
    }
  });

  it('bounds the first-cycle estimate by concurrency, batch size, and actual leads', async () => {
    const db = fakeDb({ campaigns: 2, leads: 5_000, poolNumbers: 4, tenantsWithoutPool: 0 }, [
      'NEW',
    ]);
    const result = await probeHopperPreflight(
      deps(db, { MAX_CONCURRENT_CALLS: '7', DIALER_BATCH_SIZE: '50' })
    );
    expect(result.immediatelyDialableFirstCycle).toBe(7);

    const scarce = fakeDb({ campaigns: 1, leads: 3, poolNumbers: 4, tenantsWithoutPool: 0 }, [
      'NEW',
    ]);
    const scarceResult = await probeHopperPreflight(
      deps(scarce, { MAX_CONCURRENT_CALLS: '10', DIALER_BATCH_SIZE: '50' })
    );
    expect(scarceResult.immediatelyDialableFirstCycle).toBe(3);
  });

  it("reproduces the Hopper's ESL host precedence", async () => {
    const db = fakeDb({ campaigns: 0, leads: 0, poolNumbers: 0, tenantsWithoutPool: 0 }, ['NEW']);
    const d = deps(db, { FREESWITCH_HOST: 'fallback-host', FREESWITCH_ESL_PORT: '9999' });
    await probeHopperPreflight(d);
    expect(d.checkEsl).toHaveBeenCalledWith('fallback-host', 9999);
  });

  it('reads the live enum values verbatim', async () => {
    const db = fakeDb({ campaigns: 0, leads: 0, poolNumbers: 0, tenantsWithoutPool: 0 }, [
      'NEW',
      'DIALING',
      'LOST',
    ]);
    const result = await probeHopperPreflight(deps(db));
    expect(result.leadStatusValues).toEqual(['NEW', 'DIALING', 'LOST']);
    expect(result.dialingValueExists).toBe(true);
  });

  it('treats an absent pool as gateways-not-configured', async () => {
    const db = fakeDb({ campaigns: 1, leads: 10, poolNumbers: 0, tenantsWithoutPool: 1 }, ['NEW']);
    const result = await probeHopperPreflight(deps(db));
    expect(result.fractelGatewaysConfigured).toBe(false);
    expect(result.tenantsWithoutCallerIdPool).toBe(1);
  });

  it('handles bigint counts from Postgres', async () => {
    const db: PreflightQueryClient = {
      $queryRawUnsafe: vi.fn((query: string) => {
        if (query.includes('pg_enum')) return Promise.resolve([{ value: 'NEW' }]);
        return Promise.resolve([{ count: BigInt(42) }]);
      }) as PreflightQueryClient['$queryRawUnsafe'],
    };
    const result = await probeHopperPreflight(deps(db));
    expect(result.activeCampaigns).toBe(42);
  });
});
