/**
 * Insurance Lead Pipeline — Ameriquote Field Mapper
 *
 * Transforms normalized inbound payloads into the exact Ameriquote/Boberdoo
 * outbound format per vertical.  Field names come directly from the
 * authoritative api-aca-fields.txt (TYPE=31) and api-fe-fields.txt (TYPE=19).
 */

import {
  getAmeriquoteApiKey,
  getAmeriquoteSrc,
  getAmeriquoteType,
  getInsuranceLeadMode,
  DEFAULTS,
} from './insurance-lead-config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AmeriquotePayload {
  [key: string]: string;
}

export interface MapResult {
  /** Payload with API key included (for posting) */
  fullPayload: AmeriquotePayload;
  /** Payload with API key redacted (for DB storage / UI display) */
  redactedPayload: AmeriquotePayload;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export function mapToAmeriquote(
  vertical: 'ACA' | 'FE' | 'B2B',
  normalized: Record<string, unknown>,
): MapResult {
  if (vertical === 'B2B') {
    return { fullPayload: {}, redactedPayload: {} };
  }
  const mode = getInsuranceLeadMode();
  const apiKey = getAmeriquoteApiKey();
  const src = getAmeriquoteSrc(vertical);
  const type = getAmeriquoteType(vertical);
  const isTest = mode === 'TEST';

  const zipCode = String(normalized.zipCode || '');

  // -----------------------------------------------------------------------
  // Build base payload — fields common to both ACA and FE
  // -----------------------------------------------------------------------
  const payload: AmeriquotePayload = {
    // API control fields
    Key: apiKey,
    API_Action: DEFAULTS.API_ACTION,
    Mode: DEFAULTS.MODE,
    Format: DEFAULTS.FORMAT,
    TYPE: type,
    SRC: src,

    // Required contact fields
    FirstName: String(normalized.firstName || ''),
    LastName: String(normalized.lastName || ''),
    Email: String(normalized.email || ''),
    Primary_Phone: String(normalized.phone || ''),

    // Required location fields
    Address: String(normalized.address || ''),
    City: String(normalized.city || ''),
    State: String(normalized.state || ''),
    ZipCode: zipCode,

    // Required demographic fields
    Age: String(normalized.age || ''),
    Birth_Date: String(normalized.birthDate || ''),

    // Required tracking fields
    IP_Address: String(normalized.ipAddress || '127.0.0.1'),
    Landing_Page: String(normalized.landingPage || DEFAULTS.LANDING_PAGE),
  };

  // Test mode flag
  if (isTest) {
    payload.Test_Lead = '1';
  }

  // -----------------------------------------------------------------------
  // ACA-specific required fields (TYPE=31)
  // -----------------------------------------------------------------------
  if (vertical === 'ACA') {
    payload.Height_Feet = String(normalized.heightFeet || '');
    payload.Height_Inches = String(normalized.heightInches || '');
    payload.Weight = String(normalized.weight || '');
  }

  // -----------------------------------------------------------------------
  // FE-specific required fields (TYPE=19)
  // -----------------------------------------------------------------------
  if (vertical === 'FE') {
    payload.Gender = String(normalized.gender || '');
  }

  // -----------------------------------------------------------------------
  // Optional fields — only include when present and non-empty
  // -----------------------------------------------------------------------
  const optionalMappings: Array<[string, string]> = [
    // Common optional
    ['address2', 'Address_2'],
    ['county', 'County'],
    ['secondaryPhone', 'Secondary_Phone'],
    ['gender', 'Gender'], // optional for ACA, required for FE (already set above)
    ['smoker', 'Smoker'],
    ['subId', 'Sub_ID'],
    ['pubId', 'Pub_ID'],
    ['source', 'SubSource'],
    ['recordingUrl', 'Recording_URL'],
    ['leadidToken', 'leadid_token'],
    ['trustedFormUrl', 'Trusted_Form_URL'],
    ['consentLanguage', 'consent_language'],

    // Insurance-specific optional
    ['coverageType', 'Coverage_Type'],
    ['faceAmount', 'Face_Amount'],
    ['lifeType', 'Life_Type'],
    ['riskType', 'Risk_Type'],
    ['insuranceType', 'insurance_type'],
    ['coverageAmount', 'coverage_amount'],
    ['coverageYears', 'coverage_years'],
    ['insuredTimeframe', 'insured_timeframe'],
    ['householdIncome', 'Household_Income'],
    ['peopleInHousehold', 'People_In_Household'],
    ['subsidy', 'Subsidy'],

    // FE-specific optional
    ['term', 'term'],
    ['monthlyPremium', 'monthly_premium'],
    ['carrier', 'carrier'],
    ['product', 'product'],
  ];

  for (const [inKey, outKey] of optionalMappings) {
    const value = normalized[inKey];
    if (value !== undefined && value !== null && value !== '') {
      // Don't overwrite if already set (e.g., Gender for FE)
      if (!payload[outKey]) {
        payload[outKey] = String(value);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Build redacted copy for safe storage
  // -----------------------------------------------------------------------
  const redactedPayload = { ...payload };
  redactedPayload.Key = '[REDACTED]';

  return { fullPayload: payload, redactedPayload };
}
