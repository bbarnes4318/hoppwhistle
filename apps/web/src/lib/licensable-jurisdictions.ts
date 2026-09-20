/**
 * The jurisdictions an agent can hold a licence in.
 *
 * ── Why this is not `US_STATES` ──────────────────────────────────────────────
 *
 * `lib/us-states.ts` is a 50-entry dropdown list for a prospect's address, and
 * it is the wrong list for a licence. The server accepts 56 codes --
 * `LICENSABLE_JURISDICTIONS` in `apps/api/src/lib/licensed-states.ts` -- which
 * is the 50 states plus the District of Columbia and the five inhabited
 * territories. Insurance producers genuinely hold DC and Puerto Rico licences,
 * so a picker built from the address list would silently refuse to grant six
 * jurisdictions the enforcement is perfectly willing to honour, and nothing
 * would report that: the save would succeed with the remaining states and the
 * agent would simply never be routed a DC call.
 *
 * Being NARROWER than the server is the failure mode this list exists to stop.
 * Being WIDER is the other one, and it fails loudly rather than quietly -- the
 * PATCH endpoint rejects the whole call with `INVALID_LICENSED_STATES` rather
 * than dropping the entries it does not recognise. Either way the two must
 * agree, so `licensable-jurisdictions.test.ts` reads the server's set out of
 * its source and asserts this one matches it exactly.
 *
 * ── Regions ──────────────────────────────────────────────────────────────────
 *
 * Census regions, plus a territories group. They are here so the picker can
 * offer "select every state in the South" -- an agency licensed across a region
 * would otherwise be fifteen individual clicks, and a fifteen-click form is one
 * somebody abandons halfway with a half-granted licence saved.
 */

export interface Jurisdiction {
  code: string;
  name: string;
  region: Region;
}

export type Region = 'Northeast' | 'Midwest' | 'South' | 'West' | 'Territories';

export const REGIONS: readonly Region[] = [
  'Northeast',
  'Midwest',
  'South',
  'West',
  'Territories',
] as const;

export const JURISDICTIONS: readonly Jurisdiction[] = [
  // Northeast
  { code: 'CT', name: 'Connecticut', region: 'Northeast' },
  { code: 'ME', name: 'Maine', region: 'Northeast' },
  { code: 'MA', name: 'Massachusetts', region: 'Northeast' },
  { code: 'NH', name: 'New Hampshire', region: 'Northeast' },
  { code: 'NJ', name: 'New Jersey', region: 'Northeast' },
  { code: 'NY', name: 'New York', region: 'Northeast' },
  { code: 'PA', name: 'Pennsylvania', region: 'Northeast' },
  { code: 'RI', name: 'Rhode Island', region: 'Northeast' },
  { code: 'VT', name: 'Vermont', region: 'Northeast' },

  // Midwest
  { code: 'IL', name: 'Illinois', region: 'Midwest' },
  { code: 'IN', name: 'Indiana', region: 'Midwest' },
  { code: 'IA', name: 'Iowa', region: 'Midwest' },
  { code: 'KS', name: 'Kansas', region: 'Midwest' },
  { code: 'MI', name: 'Michigan', region: 'Midwest' },
  { code: 'MN', name: 'Minnesota', region: 'Midwest' },
  { code: 'MO', name: 'Missouri', region: 'Midwest' },
  { code: 'NE', name: 'Nebraska', region: 'Midwest' },
  { code: 'ND', name: 'North Dakota', region: 'Midwest' },
  { code: 'OH', name: 'Ohio', region: 'Midwest' },
  { code: 'SD', name: 'South Dakota', region: 'Midwest' },
  { code: 'WI', name: 'Wisconsin', region: 'Midwest' },

  // South
  { code: 'AL', name: 'Alabama', region: 'South' },
  { code: 'AR', name: 'Arkansas', region: 'South' },
  { code: 'DE', name: 'Delaware', region: 'South' },
  { code: 'DC', name: 'District of Columbia', region: 'South' },
  { code: 'FL', name: 'Florida', region: 'South' },
  { code: 'GA', name: 'Georgia', region: 'South' },
  { code: 'KY', name: 'Kentucky', region: 'South' },
  { code: 'LA', name: 'Louisiana', region: 'South' },
  { code: 'MD', name: 'Maryland', region: 'South' },
  { code: 'MS', name: 'Mississippi', region: 'South' },
  { code: 'NC', name: 'North Carolina', region: 'South' },
  { code: 'OK', name: 'Oklahoma', region: 'South' },
  { code: 'SC', name: 'South Carolina', region: 'South' },
  { code: 'TN', name: 'Tennessee', region: 'South' },
  { code: 'TX', name: 'Texas', region: 'South' },
  { code: 'VA', name: 'Virginia', region: 'South' },
  { code: 'WV', name: 'West Virginia', region: 'South' },

  // West
  { code: 'AK', name: 'Alaska', region: 'West' },
  { code: 'AZ', name: 'Arizona', region: 'West' },
  { code: 'CA', name: 'California', region: 'West' },
  { code: 'CO', name: 'Colorado', region: 'West' },
  { code: 'HI', name: 'Hawaii', region: 'West' },
  { code: 'ID', name: 'Idaho', region: 'West' },
  { code: 'MT', name: 'Montana', region: 'West' },
  { code: 'NV', name: 'Nevada', region: 'West' },
  { code: 'NM', name: 'New Mexico', region: 'West' },
  { code: 'OR', name: 'Oregon', region: 'West' },
  { code: 'UT', name: 'Utah', region: 'West' },
  { code: 'WA', name: 'Washington', region: 'West' },
  { code: 'WY', name: 'Wyoming', region: 'West' },

  // Territories
  { code: 'AS', name: 'American Samoa', region: 'Territories' },
  { code: 'GU', name: 'Guam', region: 'Territories' },
  { code: 'MP', name: 'Northern Mariana Islands', region: 'Territories' },
  { code: 'PR', name: 'Puerto Rico', region: 'Territories' },
  { code: 'VI', name: 'U.S. Virgin Islands', region: 'Territories' },
];

const BY_CODE = new Map(JURISDICTIONS.map(j => [j.code, j]));

/** The full name, or the code itself for one this list does not carry. */
export function jurisdictionName(code: string): string {
  return BY_CODE.get(code)?.name ?? code;
}

export function jurisdictionsInRegion(region: Region): Jurisdiction[] {
  return JURISDICTIONS.filter(j => j.region === region);
}

/**
 * Codes matching a search, by code or by name.
 *
 * An empty query returns everything rather than nothing: the picker opens on
 * the full list, and a search box that hides the options until you type is a
 * worse form than no search box.
 */
export function searchJurisdictions(query: string): Jurisdiction[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...JURISDICTIONS];
  return JURISDICTIONS.filter(
    j => j.code.toLowerCase().includes(q) || j.name.toLowerCase().includes(q)
  );
}
