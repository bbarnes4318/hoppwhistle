/**
 * Normalization and validation for carrier application automation payloads.
 *
 * Ported from fe-rickie/server/services/automation/normalization.js and
 * expanded so the interactive call-center script can send either Hopwhistle
 * field names or fe-rickie field names and still map correctly.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface NormalizedCarrierPayload {
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string; // MM/DD/YYYY
  age: number | null;
  gender: string; // Male | Female
  tobacco: boolean;
  state: string; // Full state name (carrier requirement)
  address: string;
  city: string;
  zip: string;
  phone: string; // digits only, last 10
  email: string;
  ssn: string; // digits only ('' if not provided)
  birthState: string; // 2-letter code
  heightFeet: number;
  heightInches: number;
  weight: number;
  selectedPlanType: string; // Level | Graded | ROP
  selectedCoverage: number;
  monthlyPremium: number | null;
  beneficiaryName: string;
  beneficiaryRelation: string;
  contingentBeneficiaryName: string;
  contingentBeneficiaryRelation: string;
  accountHolder: string;
  bankName: string;
  bankCityState: string;
  ssPaymentSchedule: boolean;
  draftDay: string;
  routingNumber: string;
  accountNumber: string;
  accountType: string; // Checking | Saving
  hasExistingInsurance: boolean;
  willReplaceExisting: boolean;
  existingCompanyName: string;
  existingPolicyNumber: string;
  existingCoverageAmount: string;
  doctorName: string;
  doctorAddress: string;
  doctorPhone: string;
  ilDesigneeChoice: string | null;
  ownerIsInsured: boolean;
  payorIsInsured: boolean;
  ownerName: string;
  ownerRelation: string;
  ownerAddress: string;
  retryMode: boolean;
  // Optional linkage metadata (not sent to the carrier)
  appId: string | null;
  insuranceLeadId: string | null;
  prospectIntakeId: string | null;
  callId: string | null;
  healthQ1: boolean;
  healthQ2: boolean;
  healthQ3: boolean;
  healthQ4: boolean;
  healthQ5: boolean;
  healthQ6: boolean;
  healthQ7a: boolean;
  healthQ7b: boolean;
  healthQ7c: boolean;
  healthQ7d: boolean;
  healthQ8a: boolean;
  healthQ8b: boolean;
  healthQ8c: boolean;
  healthCovid: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  normalized: NormalizedCarrierPayload;
}

// 2-letter code -> full state name (as the carrier portal expects)
const STATE_ABBR_TO_NAME: Record<string, string> = {
  AK: 'Alaska',
  AL: 'Alabama',
  AR: 'Arkansas',
  AZ: 'Arizona',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DC: 'District of Columbia',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  IA: 'Iowa',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  MA: 'Massachusetts',
  MD: 'Maryland',
  ME: 'Maine',
  MI: 'Michigan',
  MN: 'Minnesota',
  MO: 'Missouri',
  MS: 'Mississippi',
  MT: 'Montana',
  NC: 'North Carolina',
  ND: 'North Dakota',
  NE: 'Nebraska',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NV: 'Nevada',
  NY: 'New York',
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
  VA: 'Virginia',
  VT: 'Vermont',
  WA: 'Washington',
  WI: 'Wisconsin',
  WV: 'West Virginia',
  WY: 'Wyoming',
};

const STATE_NAME_TO_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_ABBR_TO_NAME).map(([abbr, name]) => [name.toLowerCase(), abbr])
);

/**
 * Normalize a state input (2-letter code or full name) to the full state name.
 * Returns '' if unrecognized.
 */
export const normalizeStateName = (value: unknown): string => {
  if (!value) return '';
  const str = String(value).trim();
  if (!str) return '';
  const upper = str.toUpperCase();
  if (STATE_ABBR_TO_NAME[upper]) return STATE_ABBR_TO_NAME[upper];
  const abbr = STATE_NAME_TO_ABBR[str.toLowerCase()];
  if (abbr) return STATE_ABBR_TO_NAME[abbr];
  return str; // Pass through; state mapping will reject unknown values later
};

/**
 * Normalize a state input to a 2-letter abbreviation ('' if unrecognized).
 */
export const normalizeStateAbbr = (value: unknown): string => {
  if (!value) return '';
  const str = String(value).trim();
  if (!str) return '';
  if (str.length === 2 && STATE_ABBR_TO_NAME[str.toUpperCase()]) return str.toUpperCase();
  return STATE_NAME_TO_ABBR[str.toLowerCase()] || '';
};

/**
 * Normalize plan type to Level, Graded, or ROP.
 */
export const normalizePlanType = (value: unknown): string => {
  if (!value) return 'Level';
  const val = String(value).trim().toLowerCase();
  if (val === 'i' || val === 'immediate' || val === 'level' || val === 'l') {
    return 'Level';
  }
  if (val === 'g' || val === 'graded') {
    return 'Graded';
  }
  if (val === 'r' || val === 'rop' || val.includes('return of premium')) {
    return 'ROP';
  }
  return 'Level';
};

/**
 * Normalize boolean values from various formats.
 */
export const normalizeBoolean = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  const str = String(value).trim().toLowerCase();
  return ['true', 'yes', 'y', 't', '1'].includes(str);
};

/**
 * Normalize account type to Checking or Saving.
 */
export const normalizeAccountType = (value: unknown): string => {
  if (!value) return 'Checking';
  const str = String(value).trim().toLowerCase();
  if (str === 'savings' || str === 'saving' || str === 's') {
    return 'Saving';
  }
  return 'Checking';
};

/**
 * Normalize draft day based on the Social Security payment schedule flag.
 * SS schedule accepts 1S/3S/2W/3W/4W; otherwise a day of month 1-28.
 */
export const normalizeDraftDay = (value: unknown, ssPaymentSchedule: boolean): string => {
  if (!value) return ssPaymentSchedule ? '1S' : '15';
  const str = String(value).trim().toUpperCase();
  if (ssPaymentSchedule) {
    const validWeeks = ['1S', '3S', '2W', '3W', '4W'];
    return validWeeks.includes(str) ? str : '1S';
  }
  const num = parseInt(str.replace(/[^0-9]/g, ''), 10);
  if (isNaN(num) || num < 1 || num > 28) return '15';
  return String(num);
};

/**
 * Parse a height string (e.g. 5'9", 5-9, "5 9") into feet and inches.
 */
export const parseHeight = (value: unknown): { feet: number; inches: number } => {
  const defaultHeight = { feet: 5, inches: 6 };
  if (!value) return defaultHeight;

  const str = String(value).trim();
  const feetInchesMatch = str.match(/(\d+)\s*'\s*(\d+)/);
  if (feetInchesMatch) {
    return {
      feet: parseInt(feetInchesMatch[1], 10),
      inches: parseInt(feetInchesMatch[2], 10),
    };
  }

  const separatorMatch = str.match(/(\d+)\s*[- ]\s*(\d+)/);
  if (separatorMatch) {
    return {
      feet: parseInt(separatorMatch[1], 10),
      inches: parseInt(separatorMatch[2], 10),
    };
  }

  const singleMatch = str.match(/^(\d+)$/);
  if (singleMatch) {
    const num = parseInt(singleMatch[1], 10);
    if (num > 3 && num < 9) {
      return { feet: num, inches: 0 };
    }
  }

  return defaultHeight;
};

/**
 * Normalize DOB to MM/DD/YYYY.
 */
export const normalizeDob = (value: unknown): string => {
  if (!value) return '';
  const str = String(value).trim();

  // ISO timestamps like 1970-05-15T00:00:00.000Z
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[2]}/${isoMatch[3]}/${isoMatch[1]}`;
  }

  if (str.includes('-')) {
    const parts = str.split('-');
    if (parts.length === 3) {
      const [y, m, d] = parts;
      if (y.length === 4) {
        return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}`;
      }
      // MM-DD-YYYY
      if (parts[2].length === 4) {
        return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
      }
    }
  }

  if (str.includes('/')) {
    const parts = str.split('/');
    if (parts.length === 3) {
      const [m, d, y] = parts;
      return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y.padStart(4, '20')}`;
    }
  }

  return str;
};

/**
 * Extract health questions from either healthQN or qN naming into a boolean map.
 */
export const normalizeHealthQuestions = (body: Record<string, any>): Record<string, boolean> => {
  const q: Record<string, boolean> = {};
  for (let i = 1; i <= 6; i++) {
    q[`healthQ${i}`] = normalizeBoolean(
      body[`healthQ${i}`] !== undefined ? body[`healthQ${i}`] : body[`q${i}`]
    );
  }

  const subQs = ['7a', '7b', '7c', '7d', '8a', '8b', '8c'];
  subQs.forEach(suffix => {
    q[`healthQ${suffix}`] = normalizeBoolean(
      body[`healthQ${suffix}`] !== undefined ? body[`healthQ${suffix}`] : body[`q${suffix}`]
    );
  });

  q.healthCovid = normalizeBoolean(body.healthCovid ?? body.covid);
  return q;
};

const firstDefined = (...values: unknown[]): unknown =>
  values.find(v => v !== undefined && v !== null);

const asTrimmedString = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value).trim();

/**
 * Validate required fields and normalize the payload for the RPA.
 * Accepts both Hopwhistle/call-center field names and fe-rickie field names.
 */
export const validateAndNormalizePayload = (body: Record<string, any>): ValidationResult => {
  const errors: string[] = [];
  const normalized = {} as NormalizedCarrierPayload;

  if (!body || typeof body !== 'object') {
    return {
      isValid: false,
      errors: ['Request body is empty'],
      normalized,
    };
  }

  // 1. Personal Info
  normalized.firstName = asTrimmedString(firstDefined(body.firstName, body.first_name));
  if (!normalized.firstName) errors.push('First Name is required');

  normalized.middleName = asTrimmedString(firstDefined(body.middleName, body.middle_name));

  normalized.lastName = asTrimmedString(firstDefined(body.lastName, body.last_name));
  if (!normalized.lastName) errors.push('Last Name is required');

  normalized.dob = normalizeDob(firstDefined(body.dob, body.birthDate, body.birth_date));
  if (!normalized.dob) {
    errors.push('Date of Birth is required');
  }

  // Calculate age if missing but DOB is present
  let age = parseInt(String(body.age), 10);
  if (isNaN(age) && normalized.dob) {
    const parts = normalized.dob.split('/');
    if (parts.length === 3) {
      const birthDate = new Date(Number(parts[2]), Number(parts[0]) - 1, Number(parts[1]));
      const today = new Date();
      age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
    }
  }
  normalized.age = isNaN(age) ? null : age;
  if (normalized.age === null) {
    errors.push('Age or Date of Birth is required to resolve age');
  }

  const genderRaw = asTrimmedString(body.gender);
  if (!genderRaw) {
    normalized.gender = '';
    errors.push('Gender is required');
  } else {
    const g = genderRaw.toUpperCase();
    if (g === 'M' || g === 'MALE') normalized.gender = 'Male';
    else if (g === 'F' || g === 'FEMALE') normalized.gender = 'Female';
    else {
      normalized.gender = genderRaw;
      errors.push('Gender must be Male or Female');
    }
  }

  normalized.tobacco = normalizeBoolean(body.tobacco);
  if (body.tobacco === undefined || body.tobacco === null) {
    errors.push('Tobacco selection is required');
  }

  normalized.state = normalizeStateName(body.state);
  if (!normalized.state) errors.push('State is required');

  normalized.address = asTrimmedString(firstDefined(body.address, body.street));
  if (!normalized.address) errors.push('Address is required');

  normalized.city = asTrimmedString(body.city);
  if (!normalized.city) errors.push('City is required');

  normalized.zip = asTrimmedString(body.zip);
  if (!normalized.zip) errors.push('Zip code is required');

  const phoneDigits = asTrimmedString(body.phone).replace(/[^0-9]/g, '');
  normalized.phone = phoneDigits.length > 10 ? phoneDigits.slice(-10) : phoneDigits;
  if (!normalized.phone) errors.push('Phone number is required');

  normalized.email =
    asTrimmedString(body.email) ||
    `${normalized.firstName.toLowerCase() || 'customer'}.${normalized.lastName.toLowerCase() || 'unknown'}@example.com`;

  normalized.ssn = asTrimmedString(body.ssn).replace(/[^0-9]/g, '');
  if (normalized.ssn && normalized.ssn.length !== 9) {
    errors.push('SSN must be exactly 9 digits when provided');
  }

  normalized.birthState =
    normalizeStateAbbr(firstDefined(body.birthState, body.stateOfBirth, body.state_of_birth)) ||
    normalizeStateAbbr(normalized.state);

  // Height / Weight — prefer explicit numeric feet/inches, fall back to parsing
  const heightFeetNum = parseInt(String(body.heightFeet), 10);
  const heightInchesNum = parseInt(String(body.heightInches), 10);
  if (!isNaN(heightFeetNum) && !isNaN(heightInchesNum)) {
    normalized.heightFeet = heightFeetNum;
    normalized.heightInches = heightInchesNum;
  } else {
    const heightData = parseHeight(firstDefined(body.height, body.heightFeet));
    normalized.heightFeet = heightData.feet;
    normalized.heightInches = heightData.inches;
  }

  normalized.weight = parseInt(String(body.weight), 10);
  if (isNaN(normalized.weight)) {
    errors.push('Weight must be a valid number');
  }

  // 2. Plan Info
  normalized.selectedPlanType = normalizePlanType(
    firstDefined(body.selectedPlanType, body.planType, body.plan)
  );
  normalized.selectedCoverage = parseInt(
    String(firstDefined(body.selectedCoverage, body.faceAmount, body.face_amount)),
    10
  );
  if (isNaN(normalized.selectedCoverage) || normalized.selectedCoverage <= 0) {
    errors.push('Coverage amount must be a positive number');
  }

  const premium = parseFloat(
    String(firstDefined(body.selectedPremium, body.monthlyPremium, body.premium))
  );
  normalized.monthlyPremium = isNaN(premium) ? null : premium;

  // 3. Beneficiary Info
  normalized.beneficiaryName = asTrimmedString(
    firstDefined(body.beneficiaryName, body.primaryBenName)
  );
  if (!normalized.beneficiaryName) errors.push('Beneficiary Name is required');

  normalized.beneficiaryRelation = asTrimmedString(
    firstDefined(body.beneficiaryRelation, body.primaryBenRel)
  );
  if (!normalized.beneficiaryRelation) errors.push('Beneficiary Relation is required');

  normalized.contingentBeneficiaryName = asTrimmedString(
    firstDefined(body.contingentBeneficiaryName, body.contingentBenName)
  );
  normalized.contingentBeneficiaryRelation = asTrimmedString(
    firstDefined(body.contingentBeneficiaryRelation, body.contingentBenRel)
  );

  // 4. Banking Info
  normalized.accountHolder =
    asTrimmedString(firstDefined(body.accountHolder, body.accountName)) ||
    `${normalized.firstName} ${normalized.lastName}`.trim();
  if (!normalized.accountHolder) errors.push('Account Holder Name is required');

  normalized.bankName = asTrimmedString(body.bankName);
  if (!normalized.bankName) errors.push('Bank Name is required');

  normalized.bankCityState = asTrimmedString(firstDefined(body.bankCityState, body.bankAddress));
  if (!normalized.bankCityState) errors.push('Bank City/State is required');

  const draftScheduleRaw = asTrimmedString(body.draftSchedule).toLowerCase();
  normalized.ssPaymentSchedule = normalizeBoolean(
    firstDefined(
      body.ssPaymentSchedule,
      draftScheduleRaw ? draftScheduleRaw === 'ss_payment' || draftScheduleRaw === 'ss' : undefined
    )
  );
  normalized.draftDay = normalizeDraftDay(
    firstDefined(body.draftDay, body.draftDate),
    normalized.ssPaymentSchedule
  );
  if (!normalized.draftDay) errors.push('Draft Day is required');

  normalized.routingNumber = asTrimmedString(
    firstDefined(body.routingNumber, body.routing)
  ).replace(/[^0-9]/g, '');
  if (!normalized.routingNumber) {
    errors.push('Routing Number is required');
  } else if (normalized.routingNumber.length !== 9) {
    errors.push('Routing Number must be exactly 9 digits');
  }

  normalized.accountNumber = asTrimmedString(
    firstDefined(body.accountNumber, body.accountNum)
  ).replace(/[^0-9]/g, '');
  if (!normalized.accountNumber) errors.push('Account Number is required');

  normalized.accountType = normalizeAccountType(body.accountType);

  // 5. Existing Insurance / Replacements
  normalized.hasExistingInsurance = normalizeBoolean(
    firstDefined(body.hasExistingInsurance, body.hasExisting)
  );
  normalized.willReplaceExisting = normalizeBoolean(
    firstDefined(body.willReplaceExisting, body.willReplace)
  );
  normalized.existingCompanyName = asTrimmedString(body.existingCompanyName);
  normalized.existingPolicyNumber = asTrimmedString(body.existingPolicyNumber);
  normalized.existingCoverageAmount = asTrimmedString(body.existingCoverageAmount);

  // 6. Doctor Info
  normalized.doctorName =
    asTrimmedString(firstDefined(body.doctorName, body.physicianName)) || 'None';
  normalized.doctorAddress = asTrimmedString(body.doctorAddress) || 'None';
  normalized.doctorPhone = asTrimmedString(body.doctorPhone) || 'None';

  // 7. Illinois Resident Designee Choice
  normalized.ilDesigneeChoice = body.ilDesigneeChoice ? String(body.ilDesigneeChoice) : null;

  // 8. Health Questions
  const healthQs = normalizeHealthQuestions(body);
  Object.assign(normalized, healthQs);

  // 9. Owner / Payor
  normalized.ownerIsInsured =
    body.ownerIsInsured !== undefined ? normalizeBoolean(body.ownerIsInsured) : true;
  normalized.payorIsInsured =
    body.payorIsInsured !== undefined ? normalizeBoolean(body.payorIsInsured) : true;
  normalized.ownerName = asTrimmedString(body.ownerName);
  normalized.ownerRelation = asTrimmedString(firstDefined(body.ownerRelation, body.ownerRel));
  normalized.ownerAddress = asTrimmedString(body.ownerAddress);

  // 10. Meta and flow control
  normalized.appId = body.id || body.appId ? String(body.id || body.appId) : null;
  normalized.insuranceLeadId = body.insuranceLeadId ? String(body.insuranceLeadId) : null;
  normalized.prospectIntakeId = body.prospectIntakeId ? String(body.prospectIntakeId) : null;
  normalized.callId = body.callId ? String(body.callId) : null;
  normalized.retryMode = normalizeBoolean(body.retryMode);

  return {
    isValid: errors.length === 0,
    errors,
    normalized,
  };
};
