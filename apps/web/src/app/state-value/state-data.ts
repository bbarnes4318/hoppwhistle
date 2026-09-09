/**
 * Senior-market data for the State Value Evaluator: one row per licensing
 * jurisdiction, `seniors` being the resident population aged 55-80 (the final
 * expense target market).
 *
 * Populations only. The workbook's fee columns were withdrawn as incorrect —
 * a $5.00 NIPR fee that is really $5.60, resident fees recorded as
 * non-resident fees, and a fixed cost per state when a dozen jurisdictions
 * charge by the applicant's home state. Fees now live in ./fees.ts, where they
 * are resolved per (target state, resident state) rather than read off a
 * column. Do not reintroduce a fee field here.
 */
export type Region = 'Northeast' | 'Midwest' | 'South' | 'West';

export interface StateRecord {
  code: string;
  name: string;
  region: Region;
  /** Total residents. */
  population: number;
  /** Residents aged 55-80. */
  seniors: number;
}

// One jurisdiction per line reads as the source table it is; left formatted by
// hand because Prettier would explode each record to nine lines and bury the data.
// prettier-ignore
export const STATES: StateRecord[] = [
  { code: 'AL', name: 'Alabama', region: 'South', population: 5024279, seniors: 1276000 },
  { code: 'AK', name: 'Alaska', region: 'West', population: 733391, seniors: 168000 },
  { code: 'AZ', name: 'Arizona', region: 'West', population: 7151502, seniors: 1902000 },
  { code: 'AR', name: 'Arkansas', region: 'South', population: 3017804, seniors: 768000 },
  { code: 'CA', name: 'California', region: 'West', population: 39538223, seniors: 9250000 },
  { code: 'CO', name: 'Colorado', region: 'West', population: 5773714, seniors: 1378000 },
  { code: 'CT', name: 'Connecticut', region: 'Northeast', population: 3605944, seniors: 962000 },
  { code: 'DE', name: 'Delaware', region: 'South', population: 989948, seniors: 258000 },
  { code: 'DC', name: 'District of Columbia', region: 'South', population: 689545, seniors: 157000 },
  { code: 'FL', name: 'Florida', region: 'South', population: 21538187, seniors: 6233000 },
  { code: 'GA', name: 'Georgia', region: 'South', population: 10711908, seniors: 2450000 },
  { code: 'HI', name: 'Hawaii', region: 'West', population: 1455271, seniors: 381000 },
  { code: 'ID', name: 'Idaho', region: 'West', population: 1839106, seniors: 467000 },
  { code: 'IL', name: 'Illinois', region: 'Midwest', population: 12812508, seniors: 3155000 },
  { code: 'IN', name: 'Indiana', region: 'Midwest', population: 6785528, seniors: 1712000 },
  { code: 'IA', name: 'Iowa', region: 'Midwest', population: 3190369, seniors: 814000 },
  { code: 'KS', name: 'Kansas', region: 'Midwest', population: 2937880, seniors: 733000 },
  { code: 'KY', name: 'Kentucky', region: 'South', population: 4505836, seniors: 1147000 },
  { code: 'LA', name: 'Louisiana', region: 'South', population: 4657757, seniors: 1131000 },
  { code: 'ME', name: 'Maine', region: 'Northeast', population: 1362359, seniors: 390000 },
  { code: 'MD', name: 'Maryland', region: 'South', population: 6177224, seniors: 1517000 },
  { code: 'MA', name: 'Massachusetts', region: 'Northeast', population: 7029917, seniors: 1756000 },
  { code: 'MI', name: 'Michigan', region: 'Midwest', population: 10077331, seniors: 2649000 },
  { code: 'MN', name: 'Minnesota', region: 'Midwest', population: 5706494, seniors: 1426000 },
  { code: 'MS', name: 'Mississippi', region: 'South', population: 2961279, seniors: 736000 },
  { code: 'MO', name: 'Missouri', region: 'Midwest', population: 6154913, seniors: 1573000 },
  { code: 'MT', name: 'Montana', region: 'West', population: 1084225, seniors: 299000 },
  { code: 'NE', name: 'Nebraska', region: 'Midwest', population: 1961504, seniors: 478000 },
  { code: 'NV', name: 'Nevada', region: 'West', population: 3104614, seniors: 768000 },
  { code: 'NH', name: 'New Hampshire', region: 'Northeast', population: 1377529, seniors: 370000 },
  { code: 'NJ', name: 'New Jersey', region: 'Northeast', population: 9288994, seniors: 2369000 },
  { code: 'NM', name: 'New Mexico', region: 'West', population: 2117522, seniors: 557000 },
  { code: 'NY', name: 'New York', region: 'Northeast', population: 20201249, seniors: 4936000 },
  { code: 'NC', name: 'North Carolina', region: 'South', population: 10439388, seniors: 2650000 },
  { code: 'ND', name: 'North Dakota', region: 'Midwest', population: 779094, seniors: 183000 },
  { code: 'OH', name: 'Ohio', region: 'Midwest', population: 11799448, seniors: 3051000 },
  { code: 'OK', name: 'Oklahoma', region: 'South', population: 3959353, seniors: 979000 },
  { code: 'OR', name: 'Oregon', region: 'West', population: 4237256, seniors: 1124000 },
  { code: 'PA', name: 'Pennsylvania', region: 'Northeast', population: 13002700, seniors: 3470000 },
  { code: 'RI', name: 'Rhode Island', region: 'Northeast', population: 1097379, seniors: 290000 },
  { code: 'SC', name: 'South Carolina', region: 'South', population: 5118425, seniors: 1376000 },
  { code: 'SD', name: 'South Dakota', region: 'Midwest', population: 886667, seniors: 221000 },
  { code: 'TN', name: 'Tennessee', region: 'South', population: 6910840, seniors: 1769000 },
  { code: 'TX', name: 'Texas', region: 'South', population: 29145505, seniors: 6392000 },
  { code: 'UT', name: 'Utah', region: 'West', population: 3271616, seniors: 671000 },
  { code: 'VT', name: 'Vermont', region: 'Northeast', population: 643077, seniors: 179000 },
  { code: 'VA', name: 'Virginia', region: 'South', population: 8631393, seniors: 2139000 },
  { code: 'WA', name: 'Washington', region: 'West', population: 7693612, seniors: 1913000 },
  { code: 'WV', name: 'West Virginia', region: 'South', population: 1793716, seniors: 498000 },
  { code: 'WI', name: 'Wisconsin', region: 'Midwest', population: 5893718, seniors: 1508000 },
  { code: 'WY', name: 'Wyoming', region: 'West', population: 576851, seniors: 149000 },
];
