/**
 * Insurance Lead Pipeline — Delivery Readiness
 *
 * Zod validation (insurance-lead-validator) answers "can we store this lead?".
 * That is a much lower bar than "will the buyer accept this lead?": phone is
 * the only field we require, while Boberdoo rejects a post that is missing any
 * column marked "Post Required" in the authoritative spec files
 * (api-aca-fields.txt TYPE=31, api-fe-fields.txt TYPE=19).
 *
 * This module answers the buyer's question, so a bulk send can be previewed
 * instead of discovered one rejected lead at a time.
 */

/** Placeholder the mapper substitutes when a lead carries no IP at all. */
export const PLACEHOLDER_IP = '127.0.0.1';

// Landing_Page is not checked here. The mapper supplies our own opt-in page
// (DEFAULTS.LANDING_PAGE) for every lead, so it is always a real value.

const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
// Loose on purpose — it only has to tell an address apart from junk, not
// canonicalize it. The colon groups are what keep a bare hex word like "beef"
// from passing as an IP.
const IPV6_PATTERN = /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i;

export interface ReadinessIssue {
  /** Inbound (camelCase) field name, i.e. the CSV column to fix. */
  field: string;
  /** Outbound Ameriquote field name the buyer will complain about. */
  outboundField: string;
  message: string;
}

export interface ReadinessReport {
  /** True when every Post Required field is present and well-formed. */
  ready: boolean;
  /** Missing/invalid required fields — the buyer will reject the post. */
  blockers: ReadinessIssue[];
  /** Present-but-suspect values — the post goes through, at a cost. */
  warnings: ReadinessIssue[];
}

interface RequiredField {
  field: string;
  outboundField: string;
  /** Extra check beyond "is non-empty". */
  validate?: (value: string) => string | null;
  /**
   * A second field that satisfies this requirement on its own. Used where two
   * different artifacts prove the same thing — TrustedForm or LeadiD both
   * evidence consent, and a lead needs one of them, not both.
   */
  alternative?: string;
}

// ---------------------------------------------------------------------------
// Required-field tables — mirror the "Post Required" column of the spec files
// ---------------------------------------------------------------------------

const COMMON_REQUIRED: RequiredField[] = [
  {
    field: 'firstName',
    outboundField: 'FirstName',
  },
  { field: 'lastName', outboundField: 'LastName' },
  {
    field: 'phone',
    outboundField: 'Primary_Phone',
    validate: v => (/^\d{10}$/.test(v) ? null : 'must be exactly 10 digits'),
  },
  {
    field: 'email',
    outboundField: 'Email',
    validate: v => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'must be a valid email address'),
  },
  { field: 'address', outboundField: 'Address' },
  { field: 'city', outboundField: 'City' },
  {
    field: 'state',
    outboundField: 'State',
    validate: v => (/^[A-Z]{2}$/.test(v) ? null : 'must be a 2-letter state abbreviation'),
  },
  {
    field: 'zipCode',
    outboundField: 'ZipCode',
    validate: v => (/^\d{5}$/.test(v) ? null : 'must be 5 digits'),
  },
  {
    field: 'birthDate',
    outboundField: 'Birth_Date',
    validate: v => (/^\d{2}\/\d{2}\/\d{4}$/.test(v) ? null : 'must be MM/DD/YYYY'),
  },
  {
    field: 'age',
    outboundField: 'Age',
    validate: v => (/^\d{1,3}$/.test(v) ? null : 'must be a whole number'),
  },
  {
    field: 'ipAddress',
    outboundField: 'IP_Address',
    validate: v => {
      if (v === PLACEHOLDER_IP) {
        // The mapper substitutes loopback when a lead has no IP at all. It
        // satisfies the buyer's format check while proving nothing about where
        // the consumer actually opted in, so it is not a real value.
        return "is the loopback placeholder, not the consumer's captured IP";
      }
      return IPV4_PATTERN.test(v) || IPV6_PATTERN.test(v) ? null : 'must be a valid IP address';
    },
  },
];

/**
 * Consent proof. The buyer's spec marks these `Post Required: NO`, which only
 * means Boberdoo will not reject a post that omits them — it says nothing
 * about whether we may sell a lead with no evidence the consumer consented.
 * That is our rule, and it is stricter than theirs, so it lives here as a
 * blocker rather than a warning.
 *
 * Either a TrustedForm certificate or a LeadiD token satisfies it.
 */
const CONSENT_PROOF: RequiredField[] = [
  {
    field: 'trustedFormUrl',
    outboundField: 'Trusted_Form_URL',
    alternative: 'leadidToken',
    validate: v =>
      /^https?:\/\//i.test(v) ? null : 'must be a certificate URL starting with http(s)://',
  },
];

/** FE (TYPE=19) requires Gender at both ping and post. */
const FE_REQUIRED: RequiredField[] = [
  {
    field: 'gender',
    outboundField: 'Gender',
    validate: v =>
      ['Male', 'Female', 'Non-binary'].includes(v) ? null : 'must be Male, Female, or Non-binary',
  },
];

/** ACA (TYPE=31) requires height and weight at post. Gender is optional. */
const ACA_REQUIRED: RequiredField[] = [
  {
    field: 'heightFeet',
    outboundField: 'Height_Feet',
    validate: v => (/^\d{1,2}$/.test(v) ? null : 'must be a whole number'),
  },
  {
    field: 'heightInches',
    outboundField: 'Height_Inches',
    validate: v => (/^\d{1,2}$/.test(v) ? null : 'must be a whole number'),
  },
  { field: 'weight', outboundField: 'Weight' },
];

// ---------------------------------------------------------------------------
// Readiness check
// ---------------------------------------------------------------------------

function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/**
 * Check one normalized payload against the buyer's post requirements.
 *
 * B2B has no Ameriquote mapping at all, so it is reported as never deliverable
 * rather than silently passing a readiness check it can't act on.
 */
export function checkDeliveryReadiness(
  vertical: 'ACA' | 'FE' | 'B2B',
  normalized: Record<string, unknown>
): ReadinessReport {
  if (vertical === 'B2B') {
    return {
      ready: false,
      blockers: [
        {
          field: 'vertical',
          outboundField: 'TYPE',
          message: 'B2B leads have no Ameriquote delivery mapping',
        },
      ],
      warnings: [],
    };
  }

  const required = [
    ...COMMON_REQUIRED,
    ...(vertical === 'FE' ? FE_REQUIRED : ACA_REQUIRED),
    ...CONSENT_PROOF,
  ];

  const blockers: ReadinessIssue[] = [];

  for (const spec of required) {
    const value = readString(normalized, spec.field);

    if (!value) {
      // An alternative artifact satisfies the requirement outright.
      if (spec.alternative && readString(normalized, spec.alternative)) continue;

      blockers.push({
        field: spec.field,
        outboundField: spec.outboundField,
        message: spec.alternative
          ? `${spec.outboundField} is missing and so is ${spec.alternative} — the lead has no consent proof`
          : `${spec.outboundField} is required by the buyer but the lead has no value`,
      });
      continue;
    }

    const problem = spec.validate?.(value);
    if (problem) {
      blockers.push({
        field: spec.field,
        outboundField: spec.outboundField,
        message: `${spec.outboundField} ${problem} (got "${value}")`,
      });
    }
  }

  return { ready: blockers.length === 0, blockers, warnings: collectWarnings(normalized) };
}

/**
 * Values that pass every hard check but still cost money when they are wrong.
 * These never block a send.
 *
 * Consent proof and a real IP used to live here. They are blockers now — a
 * warning is something you can decide to ignore a thousand times in a row,
 * which is not the right shape for "this lead has no evidence of consent".
 */
function collectWarnings(normalized: Record<string, unknown>): ReadinessIssue[] {
  const warnings: ReadinessIssue[] = [];

  if (
    !readString(normalized, 'trustedFormUrl') &&
    readString(normalized, 'leadidToken') &&
    !readString(normalized, 'consentLanguage')
  ) {
    warnings.push({
      field: 'consentLanguage',
      outboundField: 'consent_language',
      message:
        'LeadiD token but no TrustedForm certificate and no consent language — thinner proof than a cert',
    });
  }

  if (!readString(normalized, 'datePosted')) {
    warnings.push({
      field: 'datePosted',
      outboundField: 'Origin_Lead_Date',
      message:
        'No original lead date — an aged lead sent without one can be priced or disputed as fresh',
    });
  }

  return warnings;
}
