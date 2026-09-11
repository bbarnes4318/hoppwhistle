/**
 * Census region per jurisdiction, for the region filter.
 *
 * Not part of the licensing fee drop — it is presentation grouping, kept out
 * of licensing-fees.json so that file stays a verbatim copy of what was
 * published and can be swapped wholesale on the next data drop.
 */
export type Region = 'Northeast' | 'Midwest' | 'South' | 'West';

// prettier-ignore
export const REGION_BY_CODE: Record<string, Region> = {
  CT: 'Northeast', ME: 'Northeast', MA: 'Northeast', NH: 'Northeast', RI: 'Northeast',
  VT: 'Northeast', NJ: 'Northeast', NY: 'Northeast', PA: 'Northeast',
  IL: 'Midwest', IN: 'Midwest', MI: 'Midwest', OH: 'Midwest', WI: 'Midwest',
  IA: 'Midwest', KS: 'Midwest', MN: 'Midwest', MO: 'Midwest', NE: 'Midwest',
  ND: 'Midwest', SD: 'Midwest',
  DE: 'South', DC: 'South', FL: 'South', GA: 'South', MD: 'South', NC: 'South',
  SC: 'South', VA: 'South', WV: 'South', AL: 'South', KY: 'South', MS: 'South',
  TN: 'South', AR: 'South', LA: 'South', OK: 'South', TX: 'South',
  AZ: 'West', CO: 'West', ID: 'West', MT: 'West', NV: 'West', NM: 'West',
  UT: 'West', WY: 'West', AK: 'West', CA: 'West', HI: 'West', OR: 'West',
  WA: 'West',
};

export const REGIONS: Region[] = ['Northeast', 'Midwest', 'South', 'West'];
