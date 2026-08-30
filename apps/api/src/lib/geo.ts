/**
 * Geo-Routing Utilities
 * Maps NANP area codes to US states for call routing
 */

// North American Numbering Plan Area Codes to US State mapping
export const AREA_CODE_TO_STATE: Record<string, string> = {
  // Alabama
  '205': 'AL',
  '251': 'AL',
  '256': 'AL',
  '334': 'AL',
  '938': 'AL',
  // Alaska
  '907': 'AK',
  // Arizona
  '480': 'AZ',
  '520': 'AZ',
  '602': 'AZ',
  '623': 'AZ',
  '928': 'AZ',
  // Arkansas
  '479': 'AR',
  '501': 'AR',
  '870': 'AR',
  // California
  '209': 'CA',
  '213': 'CA',
  '279': 'CA',
  '310': 'CA',
  '323': 'CA',
  '341': 'CA',
  '408': 'CA',
  '415': 'CA',
  '424': 'CA',
  '442': 'CA',
  '510': 'CA',
  '530': 'CA',
  '559': 'CA',
  '562': 'CA',
  '619': 'CA',
  '626': 'CA',
  '628': 'CA',
  '650': 'CA',
  '657': 'CA',
  '661': 'CA',
  '669': 'CA',
  '707': 'CA',
  '714': 'CA',
  '747': 'CA',
  '760': 'CA',
  '805': 'CA',
  '818': 'CA',
  '820': 'CA',
  '831': 'CA',
  '858': 'CA',
  '909': 'CA',
  '916': 'CA',
  '925': 'CA',
  '949': 'CA',
  '951': 'CA',
  // Colorado
  '303': 'CO',
  '719': 'CO',
  '720': 'CO',
  '970': 'CO',
  // Connecticut
  '203': 'CT',
  '475': 'CT',
  '860': 'CT',
  '959': 'CT',
  // Delaware
  '302': 'DE',
  // Florida
  '239': 'FL',
  '305': 'FL',
  '321': 'FL',
  '352': 'FL',
  '386': 'FL',
  '407': 'FL',
  '561': 'FL',
  '727': 'FL',
  '754': 'FL',
  '772': 'FL',
  '786': 'FL',
  '813': 'FL',
  '850': 'FL',
  '863': 'FL',
  '904': 'FL',
  '941': 'FL',
  '954': 'FL',
  // Georgia
  '229': 'GA',
  '404': 'GA',
  '470': 'GA',
  '478': 'GA',
  '678': 'GA',
  '706': 'GA',
  '762': 'GA',
  '770': 'GA',
  '912': 'GA',
  '943': 'GA',
  // Hawaii
  '808': 'HI',
  // Idaho
  '208': 'ID',
  '986': 'ID',
  // Illinois
  '217': 'IL',
  '224': 'IL',
  '309': 'IL',
  '312': 'IL',
  '331': 'IL',
  '618': 'IL',
  '630': 'IL',
  '708': 'IL',
  '773': 'IL',
  '779': 'IL',
  '815': 'IL',
  '847': 'IL',
  '872': 'IL',
  // Indiana
  '219': 'IN',
  '260': 'IN',
  '317': 'IN',
  '463': 'IN',
  '574': 'IN',
  '765': 'IN',
  '812': 'IN',
  '930': 'IN',
  // Iowa
  '319': 'IA',
  '515': 'IA',
  '563': 'IA',
  '641': 'IA',
  '712': 'IA',
  // Kansas
  '316': 'KS',
  '620': 'KS',
  '785': 'KS',
  '913': 'KS',
  // Kentucky
  '270': 'KY',
  '364': 'KY',
  '502': 'KY',
  '606': 'KY',
  '859': 'KY',
  // Louisiana
  '225': 'LA',
  '318': 'LA',
  '337': 'LA',
  '504': 'LA',
  '985': 'LA',
  // Maine
  '207': 'ME',
  // Maryland
  '240': 'MD',
  '301': 'MD',
  '410': 'MD',
  '443': 'MD',
  '667': 'MD',
  // Massachusetts
  '339': 'MA',
  '351': 'MA',
  '413': 'MA',
  '508': 'MA',
  '617': 'MA',
  '774': 'MA',
  '781': 'MA',
  '857': 'MA',
  '978': 'MA',
  // Michigan
  '231': 'MI',
  '248': 'MI',
  '269': 'MI',
  '313': 'MI',
  '517': 'MI',
  '586': 'MI',
  '616': 'MI',
  '734': 'MI',
  '810': 'MI',
  '906': 'MI',
  '947': 'MI',
  '989': 'MI',
  // Minnesota
  '218': 'MN',
  '320': 'MN',
  '507': 'MN',
  '612': 'MN',
  '651': 'MN',
  '763': 'MN',
  '952': 'MN',
  // Mississippi
  '228': 'MS',
  '601': 'MS',
  '662': 'MS',
  '769': 'MS',
  // Missouri
  '314': 'MO',
  '417': 'MO',
  '573': 'MO',
  '636': 'MO',
  '660': 'MO',
  '816': 'MO',
  // Montana
  '406': 'MT',
  // Nebraska
  '308': 'NE',
  '402': 'NE',
  '531': 'NE',
  // Nevada
  '702': 'NV',
  '725': 'NV',
  '775': 'NV',
  // New Hampshire
  '603': 'NH',
  // New Jersey
  '201': 'NJ',
  '551': 'NJ',
  '609': 'NJ',
  '732': 'NJ',
  '848': 'NJ',
  '856': 'NJ',
  '862': 'NJ',
  '908': 'NJ',
  '973': 'NJ',
  // New Mexico
  '505': 'NM',
  '575': 'NM',
  // New York
  '212': 'NY',
  '315': 'NY',
  '332': 'NY',
  '347': 'NY',
  '516': 'NY',
  '518': 'NY',
  '585': 'NY',
  '607': 'NY',
  '631': 'NY',
  '646': 'NY',
  '680': 'NY',
  '716': 'NY',
  '718': 'NY',
  '838': 'NY',
  '845': 'NY',
  '914': 'NY',
  '917': 'NY',
  '929': 'NY',
  '934': 'NY',
  // North Carolina
  '252': 'NC',
  '336': 'NC',
  '704': 'NC',
  '743': 'NC',
  '828': 'NC',
  '910': 'NC',
  '919': 'NC',
  '980': 'NC',
  '984': 'NC',
  // North Dakota
  '701': 'ND',
  // Ohio
  '216': 'OH',
  '220': 'OH',
  '234': 'OH',
  '330': 'OH',
  '380': 'OH',
  '419': 'OH',
  '440': 'OH',
  '513': 'OH',
  '567': 'OH',
  '614': 'OH',
  '740': 'OH',
  '937': 'OH',
  // Oklahoma
  '405': 'OK',
  '539': 'OK',
  '580': 'OK',
  '918': 'OK',
  // Oregon
  '458': 'OR',
  '503': 'OR',
  '541': 'OR',
  '971': 'OR',
  // Pennsylvania
  '215': 'PA',
  '223': 'PA',
  '267': 'PA',
  '272': 'PA',
  '412': 'PA',
  '445': 'PA',
  '484': 'PA',
  '570': 'PA',
  '610': 'PA',
  '717': 'PA',
  '724': 'PA',
  '814': 'PA',
  '878': 'PA',
  // Rhode Island
  '401': 'RI',
  // South Carolina
  '803': 'SC',
  '839': 'SC',
  '843': 'SC',
  '854': 'SC',
  '864': 'SC',
  // South Dakota
  '605': 'SD',
  // Tennessee
  '423': 'TN',
  '615': 'TN',
  '629': 'TN',
  '731': 'TN',
  '865': 'TN',
  '901': 'TN',
  '931': 'TN',
  // Texas
  '210': 'TX',
  '214': 'TX',
  '254': 'TX',
  '281': 'TX',
  '325': 'TX',
  '346': 'TX',
  '361': 'TX',
  '409': 'TX',
  '430': 'TX',
  '432': 'TX',
  '469': 'TX',
  '512': 'TX',
  '682': 'TX',
  '713': 'TX',
  '726': 'TX',
  '737': 'TX',
  '806': 'TX',
  '817': 'TX',
  '830': 'TX',
  '832': 'TX',
  '903': 'TX',
  '915': 'TX',
  '936': 'TX',
  '940': 'TX',
  '956': 'TX',
  '972': 'TX',
  '979': 'TX',
  // Utah
  '385': 'UT',
  '435': 'UT',
  '801': 'UT',
  // Vermont
  '802': 'VT',
  // Virginia
  '276': 'VA',
  '434': 'VA',
  '540': 'VA',
  '571': 'VA',
  '703': 'VA',
  '757': 'VA',
  '804': 'VA',
  // Washington
  '206': 'WA',
  '253': 'WA',
  '360': 'WA',
  '425': 'WA',
  '509': 'WA',
  '564': 'WA',
  // Washington D.C.
  '202': 'DC',
  // West Virginia
  '304': 'WV',
  '681': 'WV',
  // Wisconsin
  '262': 'WI',
  '414': 'WI',
  '534': 'WI',
  '608': 'WI',
  '715': 'WI',
  '920': 'WI',
  // Wyoming
  '307': 'WY',
};

// Non-geographic/Toll-free area codes
export const NON_GEOGRAPHIC_CODES = new Set([
  '800',
  '833',
  '844',
  '855',
  '866',
  '877',
  '888', // Toll-free
  '900', // Premium rate
  '456', // Inbound international
  '500',
  '521',
  '522',
  '523',
  '524',
  '525',
  '526',
  '527',
  '528',
  '529',
  '533', // Personal communications
  '700', // Interexchange carrier
]);

/**
 * Extract the area code from a phone number
 */
export function extractAreaCode(phoneNumber: string): string | null {
  if (!phoneNumber) return null;

  // Remove all non-digit characters
  const digits = phoneNumber.replace(/\D/g, '');

  // Handle different formats
  if (digits.length === 10) {
    return digits.substring(0, 3);
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return digits.substring(1, 4);
  } else if (digits.length > 11 && digits.startsWith('1')) {
    return digits.substring(1, 4);
  }

  return null;
}

/**
 * Get the US state code from an area code
 */
export function getStateFromAreaCode(areaCode: string): string | null {
  if (!areaCode || areaCode.length !== 3) return null;

  // Check if it's a non-geographic code
  if (NON_GEOGRAPHIC_CODES.has(areaCode)) {
    return null;
  }

  return AREA_CODE_TO_STATE[areaCode] || null;
}

/**
 * Get the US state code from a phone number
 */
export function getStateFromPhoneNumber(phoneNumber: string): string | null {
  const areaCode = extractAreaCode(phoneNumber);
  if (!areaCode) return null;
  return getStateFromAreaCode(areaCode);
}

/**
 * 5-digit ZIP code ranges to US state, sorted by range start.
 *
 * This is the standard best-effort ZIP-range table (the same shape used
 * across most open ZIP-to-state datasets), not an authoritative per-ZIP
 * database. It is more reliable than area-code lookup because ZIP
 * assignment doesn't move with number portability, but it is still an
 * approximation at range boundaries and does not cover PO-box-only or
 * unique ZIPs assigned outside their state's normal range. Replace with a
 * real ZIP database if per-ZIP precision is ever required.
 */
const ZIP_RANGES_TO_STATE: ReadonlyArray<readonly [number, number, string]> = [
  [501, 501, 'NY'],
  [544, 544, 'NY'],
  [1001, 2791, 'MA'],
  [1401, 1401, 'MA'],
  [2801, 2940, 'RI'],
  [3031, 3897, 'NH'],
  [3901, 4992, 'ME'],
  [5001, 5907, 'VT'],
  [6001, 6928, 'CT'],
  [6390, 6390, 'NY'],
  [7001, 8989, 'NJ'],
  [10001, 14975, 'NY'],
  [15001, 19640, 'PA'],
  [19701, 19980, 'DE'],
  [20001, 20039, 'DC'],
  [20042, 20599, 'DC'],
  [20101, 20198, 'VA'],
  [20601, 21930, 'MD'],
  [22001, 24658, 'VA'],
  [24701, 26886, 'WV'],
  [27006, 28909, 'NC'],
  [29001, 29945, 'SC'],
  [30002, 31999, 'GA'],
  [32003, 34997, 'FL'],
  [35004, 36925, 'AL'],
  [37010, 38589, 'TN'],
  [38601, 39776, 'MS'],
  [39813, 39901, 'GA'],
  [40003, 42788, 'KY'],
  [43001, 45999, 'OH'],
  [46001, 47997, 'IN'],
  [48001, 49971, 'MI'],
  [50001, 52809, 'IA'],
  [53001, 54990, 'WI'],
  [55001, 56763, 'MN'],
  [57001, 57799, 'SD'],
  [58001, 58856, 'ND'],
  [59001, 59937, 'MT'],
  [60002, 62999, 'IL'],
  [63001, 65899, 'MO'],
  [66002, 67954, 'KS'],
  [68001, 69367, 'NE'],
  [70001, 71497, 'LA'],
  [71601, 72959, 'AR'],
  [73001, 74966, 'OK'],
  [73301, 73301, 'TX'],
  [73344, 73344, 'TX'],
  [75001, 79999, 'TX'],
  [80001, 81658, 'CO'],
  [82001, 83128, 'WY'],
  [83201, 83876, 'ID'],
  [84001, 84784, 'UT'],
  [85001, 86556, 'AZ'],
  [87001, 88441, 'NM'],
  [88510, 88595, 'TX'],
  [88901, 89883, 'NV'],
  [90001, 96162, 'CA'],
  [96701, 96898, 'HI'],
  [97001, 97920, 'OR'],
  [98001, 99403, 'WA'],
  [99501, 99950, 'AK'],
];

/**
 * Get the US state code from a 5-digit ZIP code, via range lookup.
 * See ZIP_RANGES_TO_STATE for accuracy caveats.
 */
export function getStateFromZip(zip: string | null | undefined): string | null {
  if (!zip) return null;

  const digits = zip.replace(/\D/g, '');
  if (digits.length < 5) return null;

  const zipNum = parseInt(digits.substring(0, 5), 10);
  if (!Number.isFinite(zipNum)) return null;

  for (const [min, max, state] of ZIP_RANGES_TO_STATE) {
    if (zipNum >= min && zipNum <= max) {
      return state;
    }
  }

  return null;
}

/** Which signal resolved the caller's state (or that none did). */
export type StateResolutionSource = 'CALLER_SUPPLIED' | 'ZIP' | 'AREA_CODE' | 'UNRESOLVED';

export interface StateResolutionInput {
  /** State captured in the IVR, or supplied on the ping payload. Highest priority. */
  suppliedState?: string | null;
  /** Caller's ZIP code, if present. Second priority. */
  zip?: string | null;
  /** Pre-extracted 3-digit area code. Used if phoneNumber is not given. */
  areaCode?: string | null;
  /** Caller's phone number (ANI), used to derive an area code if areaCode is not given. */
  phoneNumber?: string | null;
}

export interface StateResolution {
  state: string | null;
  source: StateResolutionSource;
}

/**
 * Resolve a caller's state from the available signals, in priority order:
 * IVR/ping-supplied state, then ZIP, then area code. Area code is last
 * because number portability makes it unreliable - a caller can keep an
 * old area code after moving states.
 */
export function resolveCallerState(input: StateResolutionInput): StateResolution {
  const supplied = input.suppliedState?.toUpperCase().trim();
  if (supplied && isValidStateCode(supplied)) {
    return { state: supplied, source: 'CALLER_SUPPLIED' };
  }

  const zipState = getStateFromZip(input.zip);
  if (zipState) {
    return { state: zipState, source: 'ZIP' };
  }

  const areaCode = input.areaCode || (input.phoneNumber ? extractAreaCode(input.phoneNumber) : null);
  const areaCodeState = areaCode ? getStateFromAreaCode(areaCode) : null;
  if (areaCodeState) {
    return { state: areaCodeState, source: 'AREA_CODE' };
  }

  return { state: null, source: 'UNRESOLVED' };
}

/** Why a state-eligibility check came out the way it did. */
export type StateEligibilityReason =
  | 'NATIONAL' // acceptedStates is empty; every state is accepted
  | 'ACCEPTED' // caller's resolved state is in acceptedStates
  | 'STATE_UNRESOLVED' // acceptedStates is a licensing boundary, caller's state is unknown
  | 'STATE_NOT_ACCEPTED'; // caller's resolved state is not in acceptedStates

export interface StateEligibilityResult {
  accepted: boolean;
  reason: StateEligibilityReason;
}

/**
 * Check whether a caller's state is accepted by a buyer endpoint, and why.
 * @param callerState The 2-letter state code of the caller, or null/undefined if unresolved
 * @param acceptedStates Array of accepted state codes (empty = National, accepts all)
 */
export function checkCallerStateEligibility(
  callerState: string | null | undefined,
  acceptedStates: string[]
): StateEligibilityResult {
  // Empty array means "National" - accepts all states
  if (!acceptedStates || acceptedStates.length === 0) {
    return { accepted: true, reason: 'NATIONAL' };
  }

  // A non-empty acceptedStates list is the buyer telling us where they are
  // licensed to take calls. If we couldn't resolve the caller's state, we
  // cannot prove the call is in bounds - guessing on the buyer's behalf
  // would make their regulatory exposure our routing convenience. Fail
  // closed: exclude the buyer.
  if (!callerState) {
    return { accepted: false, reason: 'STATE_UNRESOLVED' };
  }

  // Normalize and check
  const normalizedCallerState = callerState.toUpperCase().trim();
  const accepted = acceptedStates.some(
    state => state.toUpperCase().trim() === normalizedCallerState
  );
  return { accepted, reason: accepted ? 'ACCEPTED' : 'STATE_NOT_ACCEPTED' };
}

/**
 * Check if a caller's state is accepted by a buyer endpoint
 * @param callerState The 2-letter state code of the caller
 * @param acceptedStates Array of accepted state codes (empty = National, accepts all)
 * @returns true if the caller's state is accepted
 */
export function isCallerStateAccepted(
  callerState: string | null | undefined,
  acceptedStates: string[]
): boolean {
  return checkCallerStateEligibility(callerState, acceptedStates).accepted;
}

/**
 * Validate that a state code is a valid US state
 */
export function isValidStateCode(stateCode: string): boolean {
  const validStates = new Set([
    'AL',
    'AK',
    'AZ',
    'AR',
    'CA',
    'CO',
    'CT',
    'DE',
    'FL',
    'GA',
    'HI',
    'ID',
    'IL',
    'IN',
    'IA',
    'KS',
    'KY',
    'LA',
    'ME',
    'MD',
    'MA',
    'MI',
    'MN',
    'MS',
    'MO',
    'MT',
    'NE',
    'NV',
    'NH',
    'NJ',
    'NM',
    'NY',
    'NC',
    'ND',
    'OH',
    'OK',
    'OR',
    'PA',
    'RI',
    'SC',
    'SD',
    'TN',
    'TX',
    'UT',
    'VT',
    'VA',
    'WA',
    'WV',
    'WI',
    'WY',
    'DC',
  ]);
  return validStates.has(stateCode.toUpperCase().trim());
}
