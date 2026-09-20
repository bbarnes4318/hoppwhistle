import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  JURISDICTIONS,
  REGIONS,
  jurisdictionName,
  jurisdictionsInRegion,
  searchJurisdictions,
} from '@/lib/licensable-jurisdictions';

/**
 * The picker and the server have to accept the same jurisdictions.
 *
 * They are two lists in two packages, and each way of disagreeing fails
 * differently:
 *
 *   NARROWER than the server is silent. A missing DC means an administrator
 *   cannot grant a DC licence, the save succeeds with everything else, and the
 *   agent is simply never routed a DC call. Nothing reports it.
 *
 *   WIDER than the server is loud but total. PATCH /api/v1/users/:userId
 *   rejects the whole request with INVALID_LICENSED_STATES rather than dropping
 *   the entry it does not know, so one bad code loses every other change in the
 *   same save.
 *
 * So this reads the server's own set out of its source. Comparing against a
 * hand-copied list here would just be a third place to be wrong.
 */
const API_SOURCE = resolve(__dirname, '../../../../api/src/lib/licensed-states.ts');

function serverJurisdictions(): string[] {
  const source = readFileSync(API_SOURCE, 'utf8');
  const block = /LICENSABLE_JURISDICTIONS\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(source);
  if (!block) {
    throw new Error('LICENSABLE_JURISDICTIONS not found in apps/api/src/lib/licensed-states.ts');
  }
  return [
    ...new Set(block[1].match(/'([A-Z]{2})'/g)?.map(entry => entry.slice(1, -1)) ?? []),
  ].sort();
}

describe('the picker matches what the server will accept', () => {
  const server = serverJurisdictions();
  const picker = JURISDICTIONS.map(j => j.code).sort();

  it('reads a plausible set out of the server source', () => {
    expect(server.length).toBeGreaterThan(50);
    expect(server).toContain('TN');
    expect(server).toContain('DC');
  });

  it('offers exactly the jurisdictions the server licenses', () => {
    expect(picker).toEqual(server);
  });

  it('offers the six the address dropdown does not carry', () => {
    // The reason this list exists rather than reusing US_STATES.
    for (const code of ['DC', 'PR', 'GU', 'VI', 'AS', 'MP']) {
      expect(picker, `${code} is missing from the picker`).toContain(code);
    }
  });
});

describe('the list itself', () => {
  it('has no duplicate codes', () => {
    const codes = JURISDICTIONS.map(j => j.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('names every jurisdiction', () => {
    for (const j of JURISDICTIONS) {
      expect(j.name.length, `${j.code} has no name`).toBeGreaterThan(0);
      expect(j.name).not.toBe(j.code);
    }
  });

  it('puts every jurisdiction in exactly one declared region', () => {
    for (const j of JURISDICTIONS) {
      expect(REGIONS, `${j.code} is in an unknown region`).toContain(j.region);
    }
    const grouped = REGIONS.flatMap(region => jurisdictionsInRegion(region));
    expect(grouped).toHaveLength(JURISDICTIONS.length);
  });

  it('leaves no region empty', () => {
    for (const region of REGIONS) {
      expect(jurisdictionsInRegion(region).length, `${region} is empty`).toBeGreaterThan(0);
    }
  });
});

describe('jurisdictionName', () => {
  it('names a code it knows', () => {
    expect(jurisdictionName('TN')).toBe('Tennessee');
    expect(jurisdictionName('DC')).toBe('District of Columbia');
  });

  /*
   * A licence row written before the server started validating may hold a code
   * this list does not carry. Showing the code is a worse label but a true one;
   * showing "undefined" beside somebody's name is not.
   */
  it('falls back to the code for one it does not', () => {
    expect(jurisdictionName('ZZ')).toBe('ZZ');
  });
});

describe('searchJurisdictions', () => {
  it('returns everything for an empty query', () => {
    expect(searchJurisdictions('')).toHaveLength(JURISDICTIONS.length);
    expect(searchJurisdictions('   ')).toHaveLength(JURISDICTIONS.length);
  });

  it('matches on code and on name, ignoring case', () => {
    expect(searchJurisdictions('tn').map(j => j.code)).toContain('TN');
    expect(searchJurisdictions('tennes').map(j => j.code)).toEqual(['TN']);
    expect(searchJurisdictions('CAROLINA').map(j => j.code)).toEqual(['NC', 'SC']);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchJurisdictions('zzzzz')).toHaveLength(0);
  });
});
