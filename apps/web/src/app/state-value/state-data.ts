/**
 * Licensing + senior-market data for the State Value Evaluator.
 *
 * Source: "state licensing-life insurance" workbook (one row per licensing
 * jurisdiction). `seniors` is the resident population aged 55-80 — the final
 * expense target market. `stateFee` is the non-resident producer licence fee
 * and `niprFee` the fixed NIPR transaction fee charged on top of it.
 */
export type Region = 'Northeast' | 'Midwest' | 'South' | 'West';

export interface StateRecord {
  code: string;
  name: string;
  region: Region;
  population: number;
  seniors: number;
  stateFee: number;
  niprFee: number;
}

/** Jurisdictions whose non-resident fee mirrors the applicant's resident fee. */
export const RECIPROCAL_CODES = ['NY', 'TN'] as const;

export const STATES: StateRecord[] = [
  { code: 'AL', name: 'Alabama', region: 'South', population: 5024279, seniors: 1276000, stateFee: 80, niprFee: 5 },
  { code: 'AK', name: 'Alaska', region: 'West', population: 733391, seniors: 168000, stateFee: 75, niprFee: 5 },
  { code: 'AZ', name: 'Arizona', region: 'West', population: 7151502, seniors: 1902000, stateFee: 120, niprFee: 5 },
  { code: 'AR', name: 'Arkansas', region: 'South', population: 3017804, seniors: 768000, stateFee: 70, niprFee: 5 },
  { code: 'CA', name: 'California', region: 'West', population: 39538223, seniors: 9250000, stateFee: 188, niprFee: 5 },
  { code: 'CO', name: 'Colorado', region: 'West', population: 5773714, seniors: 1378000, stateFee: 89, niprFee: 5 },
  { code: 'CT', name: 'Connecticut', region: 'Northeast', population: 3605944, seniors: 962000, stateFee: 130, niprFee: 5 },
  { code: 'DE', name: 'Delaware', region: 'South', population: 989948, seniors: 258000, stateFee: 100, niprFee: 5 },
  { code: 'DC', name: 'District of Columbia', region: 'South', population: 689545, seniors: 157000, stateFee: 100, niprFee: 5 },
  { code: 'FL', name: 'Florida', region: 'South', population: 21538187, seniors: 6233000, stateFee: 60, niprFee: 5 },
  { code: 'GA', name: 'Georgia', region: 'South', population: 10711908, seniors: 2450000, stateFee: 100, niprFee: 5 },
  { code: 'HI', name: 'Hawaii', region: 'West', population: 1455271, seniors: 381000, stateFee: 150, niprFee: 5 },
  { code: 'ID', name: 'Idaho', region: 'West', population: 1839106, seniors: 467000, stateFee: 80, niprFee: 5 },
  { code: 'IL', name: 'Illinois', region: 'Midwest', population: 12812508, seniors: 3155000, stateFee: 200, niprFee: 5 },
  { code: 'IN', name: 'Indiana', region: 'Midwest', population: 6785528, seniors: 1712000, stateFee: 90, niprFee: 5 },
  { code: 'IA', name: 'Iowa', region: 'Midwest', population: 3190369, seniors: 814000, stateFee: 50, niprFee: 5 },
  { code: 'KS', name: 'Kansas', region: 'Midwest', population: 2937880, seniors: 733000, stateFee: 30, niprFee: 5 },
  { code: 'KY', name: 'Kentucky', region: 'South', population: 4505836, seniors: 1147000, stateFee: 40, niprFee: 5 },
  { code: 'LA', name: 'Louisiana', region: 'South', population: 4657757, seniors: 1131000, stateFee: 75, niprFee: 5 },
  { code: 'ME', name: 'Maine', region: 'Northeast', population: 1362359, seniors: 390000, stateFee: 60, niprFee: 5 },
  { code: 'MD', name: 'Maryland', region: 'South', population: 6177224, seniors: 1517000, stateFee: 54, niprFee: 5 },
  { code: 'MA', name: 'Massachusetts', region: 'Northeast', population: 7029917, seniors: 1756000, stateFee: 225, niprFee: 5 },
  { code: 'MI', name: 'Michigan', region: 'Midwest', population: 10077331, seniors: 2649000, stateFee: 90, niprFee: 5 },
  { code: 'MN', name: 'Minnesota', region: 'Midwest', population: 5706494, seniors: 1426000, stateFee: 67, niprFee: 5 },
  { code: 'MS', name: 'Mississippi', region: 'South', population: 2961279, seniors: 736000, stateFee: 100, niprFee: 5 },
  { code: 'MO', name: 'Missouri', region: 'Midwest', population: 6154913, seniors: 1573000, stateFee: 100, niprFee: 5 },
  { code: 'MT', name: 'Montana', region: 'West', population: 1084225, seniors: 299000, stateFee: 100, niprFee: 5 },
  { code: 'NE', name: 'Nebraska', region: 'Midwest', population: 1961504, seniors: 478000, stateFee: 50, niprFee: 5 },
  { code: 'NV', name: 'Nevada', region: 'West', population: 3104614, seniors: 768000, stateFee: 185, niprFee: 5 },
  { code: 'NH', name: 'New Hampshire', region: 'Northeast', population: 1377529, seniors: 370000, stateFee: 210, niprFee: 5 },
  { code: 'NJ', name: 'New Jersey', region: 'Northeast', population: 9288994, seniors: 2369000, stateFee: 150, niprFee: 5 },
  { code: 'NM', name: 'New Mexico', region: 'West', population: 2117522, seniors: 557000, stateFee: 60, niprFee: 5 },
  { code: 'NY', name: 'New York', region: 'Northeast', population: 20201249, seniors: 4936000, stateFee: 80, niprFee: 5 },
  { code: 'NC', name: 'North Carolina', region: 'South', population: 10439388, seniors: 2650000, stateFee: 50, niprFee: 5 },
  { code: 'ND', name: 'North Dakota', region: 'Midwest', population: 779094, seniors: 183000, stateFee: 100, niprFee: 5 },
  { code: 'OH', name: 'Ohio', region: 'Midwest', population: 11799448, seniors: 3051000, stateFee: 10, niprFee: 5 },
  { code: 'OK', name: 'Oklahoma', region: 'South', population: 3959353, seniors: 979000, stateFee: 60, niprFee: 5 },
  { code: 'OR', name: 'Oregon', region: 'West', population: 4237256, seniors: 1124000, stateFee: 50, niprFee: 5 },
  { code: 'PA', name: 'Pennsylvania', region: 'Northeast', population: 13002700, seniors: 3470000, stateFee: 55, niprFee: 5 },
  { code: 'RI', name: 'Rhode Island', region: 'Northeast', population: 1097379, seniors: 290000, stateFee: 120, niprFee: 5 },
  { code: 'SC', name: 'South Carolina', region: 'South', population: 5118425, seniors: 1376000, stateFee: 25, niprFee: 5 },
  { code: 'SD', name: 'South Dakota', region: 'Midwest', population: 886667, seniors: 221000, stateFee: 30, niprFee: 5 },
  { code: 'TN', name: 'Tennessee', region: 'South', population: 6910840, seniors: 1769000, stateFee: 50, niprFee: 5 },
  { code: 'TX', name: 'Texas', region: 'South', population: 29145505, seniors: 6392000, stateFee: 50, niprFee: 5 },
  { code: 'UT', name: 'Utah', region: 'West', population: 3271616, seniors: 671000, stateFee: 75, niprFee: 5 },
  { code: 'VT', name: 'Vermont', region: 'Northeast', population: 643077, seniors: 179000, stateFee: 60, niprFee: 5 },
  { code: 'VA', name: 'Virginia', region: 'South', population: 8631393, seniors: 2139000, stateFee: 10, niprFee: 5 },
  { code: 'WA', name: 'Washington', region: 'West', population: 7693612, seniors: 1913000, stateFee: 55, niprFee: 5 },
  { code: 'WV', name: 'West Virginia', region: 'South', population: 1793716, seniors: 498000, stateFee: 50, niprFee: 5 },
  { code: 'WI', name: 'Wisconsin', region: 'Midwest', population: 5893718, seniors: 1508000, stateFee: 75, niprFee: 5 },
  { code: 'WY', name: 'Wyoming', region: 'West', population: 576851, seniors: 149000, stateFee: 150, niprFee: 5 },
];
