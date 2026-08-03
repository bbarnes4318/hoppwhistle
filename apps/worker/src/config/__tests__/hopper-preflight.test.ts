/**
 * The Hopper startup preflight.
 *
 * Answers "if this starts right now, how many calls does it place, to whom" —
 * and refuses when it cannot tell. Every source here is a fixture or a double;
 * nothing in this file can reach a real database.
 */

import { describe, expect, it, vi } from 'vitest';

import type { HopperScope } from '../hopper-gate.js';
import { PreflightVerdict, runHopperPreflight, type PreflightSource } from '../hopper-preflight.js';

const scope = (over: Partial<HopperScope> = {}): HopperScope => ({
  tenantIds: over.tenantIds ?? ['tenant-a'],
  campaignIds: over.campaignIds ?? [],
});

/** A source that behaves like a healthy database with work in it. */
function source(over: Partial<PreflightSource> = {}): PreflightSource {
  return {
    countDialableLeads:
      over.countDialableLeads ?? (() => Promise.resolve({ leads: 40, tenants: 1, campaigns: 2 })),
    countDialableLeadsUnscoped: over.countDialableLeadsUnscoped ?? (() => Promise.resolve(9_000)),
    countStaleReservations: over.countStaleReservations ?? (() => Promise.resolve(0)),
    reservationSchemaPresent: over.reservationSchemaPresent ?? (() => Promise.resolve(true)),
  };
}

const options = (over: Record<string, unknown> = {}) => ({
  source: source(),
  scope: scope(),
  batchSize: 50,
  concurrencyCap: 10,
  originationEnabled: false,
  ...over,
});

describe('the preflight reports what a start would actually do', () => {
  it('bounds the first cycle by the smallest of leads, batch size and concurrency', async () => {
    // The number that matters to whoever authorises this is not "how many
    // leads exist" — it is how many telephones ring in the first second.
    const report = await runHopperPreflight(options());
    expect(report.facts.immediatelyDialableLeads).toBe(40);
    expect(report.facts.maxFirstCycleReservations).toBe(10);
    expect(report.facts.maxConcurrentCalls).toBe(10);
    expect(report.verdict).toBe(PreflightVerdict.CLEAR);
    expect(report.permitsStartup).toBe(true);
  });

  it('reports the tenants and campaigns the scope actually touches', async () => {
    const report = await runHopperPreflight(options());
    expect(report.facts.affectedTenants).toBe(1);
    expect(report.facts.affectedCampaigns).toBe(2);
  });

  it('reports whether the allowlist genuinely restricts the selection', async () => {
    const restricted = await runHopperPreflight(options());
    expect(restricted.facts.allowlistRestrictsSelection).toBe(true);

    // If the scoped and unscoped counts match, the allowlist names everything
    // there is. That is a legitimate configuration and a very different risk,
    // and an operator should not have to infer it.
    const everything = await runHopperPreflight(
      options({
        source: source({
          countDialableLeads: () => Promise.resolve({ leads: 40, tenants: 1, campaigns: 2 }),
          countDialableLeadsUnscoped: () => Promise.resolve(40),
        }),
      })
    );
    expect(everything.facts.allowlistRestrictsSelection).toBe(false);
  });

  it('reports whether any origination would be attempted at all', async () => {
    const off = await runHopperPreflight(options());
    expect(off.facts.wouldAttemptOrigination).toBe(false);

    const on = await runHopperPreflight(options({ originationEnabled: true }));
    expect(on.facts.wouldAttemptOrigination).toBe(true);

    // No leads means no calls, whatever the switch says.
    const noWork = await runHopperPreflight(
      options({
        originationEnabled: true,
        source: source({
          countDialableLeads: () => Promise.resolve({ leads: 0, tenants: 0, campaigns: 0 }),
        }),
      })
    );
    expect(noWork.facts.wouldAttemptOrigination).toBe(false);
  });
});

describe('9. a failing preflight prevents startup', () => {
  it('refuses when the reservation schema is absent', async () => {
    const report = await runHopperPreflight(
      options({ source: source({ reservationSchemaPresent: () => Promise.resolve(false) }) })
    );
    expect(report.verdict).toBe(PreflightVerdict.SCHEMA_INSUFFICIENT);
    expect(report.permitsStartup).toBe(false);
  });

  it('refuses while stale reservations are unresolved', async () => {
    // Taking new work while previous attempts are unresolved is how a lead
    // gets dialled twice.
    const report = await runHopperPreflight(
      options({ source: source({ countStaleReservations: () => Promise.resolve(3) }) })
    );
    expect(report.verdict).toBe(PreflightVerdict.STALE_RESERVATIONS_PRESENT);
    expect(report.permitsStartup).toBe(false);
  });

  it('refuses when the scope matches nothing', async () => {
    const report = await runHopperPreflight(
      options({
        source: source({
          countDialableLeads: () => Promise.resolve({ leads: 0, tenants: 0, campaigns: 0 }),
        }),
      })
    );
    expect(report.verdict).toBe(PreflightVerdict.EMPTY_SCOPE);
    expect(report.permitsStartup).toBe(false);
  });

  it('refuses rather than assuming zero when it cannot read', async () => {
    // "We could not tell" must never resolve to "so it is fine". Zero leads and
    // an unreadable database produce the same count and opposite conclusions.
    const report = await runHopperPreflight(
      options({
        source: source({
          countDialableLeads: () => Promise.reject(new Error('connection terminated')),
        }),
      })
    );
    expect(report.verdict).toBe(PreflightVerdict.INDETERMINATE);
    expect(report.permitsStartup).toBe(false);
  });

  it('leaks no credential when the read fails', async () => {
    const report = await runHopperPreflight(
      options({
        source: source({
          reservationSchemaPresent: () =>
            Promise.reject(new Error('failed at postgres://app:hunter2@db:5432/app')),
        }),
      })
    );
    expect(JSON.stringify(report)).not.toMatch(/hunter2|postgres:\/\//);
  });
});

describe('6 and 7. the scope is passed to the source, not applied afterwards', () => {
  it('hands the exact scope to the counting query', async () => {
    // The allowlist has to reach the SQL. A preflight that counted everything
    // and filtered in JavaScript would report a number that has nothing to do
    // with what the dialer would select.
    const countDialableLeads = vi.fn(() => Promise.resolve({ leads: 1, tenants: 1, campaigns: 1 }));
    const requested = scope({ tenantIds: ['tenant-a'], campaignIds: ['camp-1', 'camp-2'] });

    await runHopperPreflight(options({ scope: requested, source: source({ countDialableLeads }) }));

    expect(countDialableLeads).toHaveBeenCalledWith(requested);
  });

  it('counts stale reservations within the same scope', async () => {
    const countStaleReservations = vi.fn(() => Promise.resolve(0));
    const requested = scope({ tenantIds: ['tenant-b'] });

    await runHopperPreflight(
      options({ scope: requested, source: source({ countStaleReservations }) })
    );

    expect(countStaleReservations).toHaveBeenCalledWith(requested);
  });
});
