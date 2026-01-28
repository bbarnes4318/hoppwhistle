// prospectUtils.ts - Prospect data utilities
// DOB calculation, location verification, and data validation

// ============================================================================
// DOB CALCULATION
// ============================================================================

/**
 * Calculate age from date of birth
 * @param dob - Date string in various formats (MM/DD/YYYY, YYYY-MM-DD, etc.)
 * @returns Age in years, or null if invalid
 */
export function calculateAgeFromDOB(dob: string | undefined): number | null {
  if (!dob) return null;

  let birthDate: Date;

  // Try to parse various date formats
  const formats = [
    // MM/DD/YYYY
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    // YYYY-MM-DD
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
    // MM-DD-YYYY
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
  ];

  for (const format of formats) {
    const match = dob.match(format);
    if (match) {
      // Determine year, month, day based on format
      let year: number, month: number, day: number;

      if (format.source.startsWith('^(\\d{4})')) {
        // YYYY-MM-DD
        [, year, month, day] = match.map(Number) as [never, number, number, number];
      } else {
        // MM/DD/YYYY or MM-DD-YYYY
        [, month, day, year] = match.map(Number) as [never, number, number, number];
      }

      birthDate = new Date(year, month - 1, day);
      break;
    }
  }

  // Fallback: try native Date parsing
  if (!birthDate!) {
    birthDate = new Date(dob);
    if (isNaN(birthDate.getTime())) {
      return null;
    }
  }

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  // Adjust age if birthday hasn't occurred yet this year
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  return age >= 0 && age <= 120 ? age : null;
}

/**
 * Format a date for display
 * @param dob - Date string
 * @returns Formatted date string (MM/DD/YYYY)
 */
export function formatDOB(dob: string | undefined): string {
  if (!dob) return '';

  const date = new Date(dob);
  if (isNaN(date.getTime())) return dob;

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();

  return `${month}/${day}/${year}`;
}

/**
 * Check if prospect is within eligible age range for final expense
 * @param age - Age in years
 * @returns Eligibility status
 */
export function checkAgeEligibility(age: number): {
  eligible: boolean;
  message: string;
} {
  if (age < 18) {
    return { eligible: false, message: 'Must be at least 18 years old' };
  }
  if (age > 85) {
    return { eligible: false, message: 'Age exceeds maximum coverage age of 85' };
  }
  if (age >= 75) {
    return { eligible: true, message: 'Limited carrier options available (75+)' };
  }
  return { eligible: true, message: '' };
}

// ============================================================================
// LOCATION VERIFICATION
// ============================================================================

/**
 * US State abbreviations and names
 */
export const US_STATES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
};

/**
 * Area code to state mapping (partial - most common)
 * For full accuracy, a webhook/API call to a service like numverify would be ideal
 */
const AREA_CODE_TO_STATE: Record<string, string> = {
  // Common area codes - expanded list
  '201': 'NJ',
  '202': 'DC',
  '203': 'CT',
  '205': 'AL',
  '206': 'WA',
  '207': 'ME',
  '208': 'ID',
  '209': 'CA',
  '210': 'TX',
  '212': 'NY',
  '213': 'CA',
  '214': 'TX',
  '215': 'PA',
  '216': 'OH',
  '217': 'IL',
  '218': 'MN',
  '219': 'IN',
  '224': 'IL',
  '225': 'LA',
  '228': 'MS',
  '229': 'GA',
  '231': 'MI',
  '234': 'OH',
  '239': 'FL',
  '240': 'MD',
  '248': 'MI',
  '251': 'AL',
  '252': 'NC',
  '253': 'WA',
  '254': 'TX',
  '256': 'AL',
  '260': 'IN',
  '262': 'WI',
  '267': 'PA',
  '269': 'MI',
  '270': 'KY',
  '276': 'VA',
  '281': 'TX',
  '301': 'MD',
  '302': 'DE',
  '303': 'CO',
  '304': 'WV',
  '305': 'FL',
  '307': 'WY',
  '308': 'NE',
  '309': 'IL',
  '310': 'CA',
  '312': 'IL',
  '313': 'MI',
  '314': 'MO',
  '315': 'NY',
  '316': 'KS',
  '317': 'IN',
  '318': 'LA',
  '319': 'IA',
  '320': 'MN',
  '321': 'FL',
  '323': 'CA',
  '325': 'TX',
  '330': 'OH',
  '334': 'AL',
  '336': 'NC',
  '337': 'LA',
  '339': 'MA',
  '347': 'NY',
  '351': 'MA',
  '352': 'FL',
  '360': 'WA',
  '361': 'TX',
  '386': 'FL',
  '401': 'RI',
  '402': 'NE',
  '404': 'GA',
  '405': 'OK',
  '406': 'MT',
  '407': 'FL',
  '408': 'CA',
  '409': 'TX',
  '410': 'MD',
  '412': 'PA',
  '413': 'MA',
  '414': 'WI',
  '415': 'CA',
  '417': 'MO',
  '419': 'OH',
  '423': 'TN',
  '424': 'CA',
  '425': 'WA',
  '430': 'TX',
  '432': 'TX',
  '434': 'VA',
  '435': 'UT',
  '440': 'OH',
  '443': 'MD',
  '469': 'TX',
  '470': 'GA',
  '475': 'CT',
  '478': 'GA',
  '479': 'AR',
  '480': 'AZ',
  '484': 'PA',
  '501': 'AR',
  '502': 'KY',
  '503': 'OR',
  '504': 'LA',
  '505': 'NM',
  '507': 'MN',
  '508': 'MA',
  '509': 'WA',
  '510': 'CA',
  '512': 'TX',
  '513': 'OH',
  '515': 'IA',
  '516': 'NY',
  '517': 'MI',
  '518': 'NY',
  '520': 'AZ',
  '530': 'CA',
  '531': 'NE',
  '534': 'WI',
  '539': 'OK',
  '540': 'VA',
  '541': 'OR',
  '551': 'NJ',
  '559': 'CA',
  '561': 'FL',
  '562': 'CA',
  '563': 'IA',
  '567': 'OH',
  '570': 'PA',
  '571': 'VA',
  '573': 'MO',
  '574': 'IN',
  '580': 'OK',
  '585': 'NY',
  '586': 'MI',
  '601': 'MS',
  '602': 'AZ',
  '603': 'NH',
  '605': 'SD',
  '606': 'KY',
  '607': 'NY',
  '608': 'WI',
  '609': 'NJ',
  '610': 'PA',
  '612': 'MN',
  '614': 'OH',
  '615': 'TN',
  '616': 'MI',
  '617': 'MA',
  '618': 'IL',
  '619': 'CA',
  '620': 'KS',
  '623': 'AZ',
  '626': 'CA',
  '630': 'IL',
  '631': 'NY',
  '636': 'MO',
  '646': 'NY',
  '650': 'CA',
  '651': 'MN',
  '657': 'CA',
  '660': 'MO',
  '661': 'CA',
  '662': 'MS',
  '678': 'GA',
  '682': 'TX',
  '701': 'ND',
  '702': 'NV',
  '703': 'VA',
  '704': 'NC',
  '706': 'GA',
  '707': 'CA',
  '708': 'IL',
  '712': 'IA',
  '713': 'TX',
  '714': 'CA',
  '715': 'WI',
  '716': 'NY',
  '717': 'PA',
  '718': 'NY',
  '719': 'CO',
  '720': 'CO',
  '724': 'PA',
  '727': 'FL',
  '731': 'TN',
  '732': 'NJ',
  '734': 'MI',
  '737': 'TX',
  '740': 'OH',
  '747': 'CA',
  '754': 'FL',
  '757': 'VA',
  '760': 'CA',
  '762': 'GA',
  '763': 'MN',
  '765': 'IN',
  '770': 'GA',
  '772': 'FL',
  '773': 'IL',
  '774': 'MA',
  '775': 'NV',
  '781': 'MA',
  '785': 'KS',
  '786': 'FL',
  '801': 'UT',
  '802': 'VT',
  '803': 'SC',
  '804': 'VA',
  '805': 'CA',
  '806': 'TX',
  '808': 'HI',
  '810': 'MI',
  '812': 'IN',
  '813': 'FL',
  '814': 'PA',
  '815': 'IL',
  '816': 'MO',
  '817': 'TX',
  '818': 'CA',
  '828': 'NC',
  '830': 'TX',
  '831': 'CA',
  '832': 'TX',
  '843': 'SC',
  '845': 'NY',
  '847': 'IL',
  '848': 'NJ',
  '850': 'FL',
  '856': 'NJ',
  '857': 'MA',
  '858': 'CA',
  '859': 'KY',
  '860': 'CT',
  '862': 'NJ',
  '863': 'FL',
  '864': 'SC',
  '865': 'TN',
  '870': 'AR',
  '872': 'IL',
  '878': 'PA',
  '901': 'TN',
  '903': 'TX',
  '904': 'FL',
  '906': 'MI',
  '907': 'AK',
  '908': 'NJ',
  '909': 'CA',
  '910': 'NC',
  '912': 'GA',
  '913': 'KS',
  '914': 'NY',
  '915': 'TX',
  '916': 'CA',
  '917': 'NY',
  '918': 'OK',
  '919': 'NC',
  '920': 'WI',
  '925': 'CA',
  '928': 'AZ',
  '931': 'TN',
  '936': 'TX',
  '937': 'OH',
  '940': 'TX',
  '941': 'FL',
  '947': 'MI',
  '949': 'CA',
  '951': 'CA',
  '952': 'MN',
  '954': 'FL',
  '956': 'TX',
  '959': 'CT',
  '970': 'CO',
  '971': 'OR',
  '972': 'TX',
  '973': 'NJ',
  '978': 'MA',
  '979': 'TX',
  '980': 'NC',
  '985': 'LA',
};

/**
 * Extract area code from phone number
 */
export function extractAreaCode(phone: string): string | null {
  if (!phone) return null;

  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');

  // Handle 10-digit or 11-digit (with leading 1) numbers
  if (digits.length === 10) {
    return digits.substring(0, 3);
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.substring(1, 4);
  }

  return null;
}

/**
 * Get state from area code
 */
export function getStateFromAreaCode(areaCode: string): string | null {
  return AREA_CODE_TO_STATE[areaCode] || null;
}

/**
 * Verify location from phone number
 * Returns the state abbreviation if found, or null
 */
export function verifyLocationFromPhone(phone: string): string | null {
  const areaCode = extractAreaCode(phone);
  if (!areaCode) return null;
  return getStateFromAreaCode(areaCode);
}

/**
 * Check if claimed state matches phone area code
 */
export function verifyStateMatchesPhone(
  claimedState: string,
  phone: string
): {
  matches: boolean;
  phoneState: string | null;
  message: string;
} {
  const phoneState = verifyLocationFromPhone(phone);

  if (!phoneState) {
    return {
      matches: true, // Can't verify, assume match
      phoneState: null,
      message: 'Unable to verify location from phone number',
    };
  }

  const normalizedClaimed = claimedState.toUpperCase().trim();
  const matches = normalizedClaimed === phoneState;

  return {
    matches,
    phoneState,
    message: matches
      ? `Location verified: ${US_STATES[phoneState] || phoneState}`
      : `Phone area code suggests ${US_STATES[phoneState] || phoneState}, but claimed state is ${US_STATES[normalizedClaimed] || normalizedClaimed}`,
  };
}

/**
 * Validate state abbreviation
 */
export function isValidState(state: string): boolean {
  if (!state) return false;
  return state.toUpperCase() in US_STATES;
}

/**
 * Get full state name from abbreviation
 */
export function getStateName(abbreviation: string): string {
  return US_STATES[abbreviation.toUpperCase()] || abbreviation;
}

// ============================================================================
// PROSPECT DATA VALIDATION
// ============================================================================

/**
 * Validate SSN format
 */
export function isValidSSN(ssn: string): boolean {
  if (!ssn) return false;
  const digits = ssn.replace(/\D/g, '');
  return digits.length === 9;
}

/**
 * Format SSN for display (XXX-XX-XXXX)
 */
export function formatSSN(ssn: string): string {
  if (!ssn) return '';
  const digits = ssn.replace(/\D/g, '');
  if (digits.length !== 9) return ssn;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/**
 * Mask SSN for display (XXX-XX-1234)
 */
export function maskSSN(ssn: string): string {
  if (!ssn) return '';
  const digits = ssn.replace(/\D/g, '');
  if (digits.length !== 9) return ssn;
  return `XXX-XX-${digits.slice(5)}`;
}

/**
 * Validate routing number (basic check)
 */
export function isValidRoutingNumber(routing: string): boolean {
  if (!routing) return false;
  const digits = routing.replace(/\D/g, '');
  return digits.length === 9;
}

/**
 * Format phone number for display
 */
export function formatPhone(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  return phone;
}
