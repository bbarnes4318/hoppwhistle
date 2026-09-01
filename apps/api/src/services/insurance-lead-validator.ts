/**
 * Insurance Lead Pipeline — Validation & Normalization
 *
 * Zod schemas built from the authoritative ACA (TYPE=31) and FE (TYPE=19)
 * Ameriquote / Boberdoo field spec files.  Normalizes phone, email, state,
 * zip, dates, gender, and name fields.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/** Strip to exactly 10 digits */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  // Handle 11-digit with leading 1
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

/** Lowercase + trim */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Uppercase 2-letter state abbreviation */
export function normalizeState(raw: string): string {
  return raw.trim().toUpperCase().slice(0, 2);
}

/** Ensure 5-digit zip */
export function normalizeZip(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.slice(0, 5).padStart(5, '0');
}

/**
 * Excel writes a date as a day count from 1899-12-30, and a CSV exported from
 * it carries that number rather than anything date-shaped: a real vendor file
 * arrived with birthDate "21724" for a lead born 1959-06-23. The epoch is
 * 1899-12-30 rather than 1900-01-01 because Excel counts a 1900-02-29 that
 * never existed; that offset is correct for every serial past 60, which any
 * plausible birth date is by four orders of magnitude.
 */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/** Is this a date that exists — rejects 16/09/1980, 02/30/2001, year 3 BC. */
function isRealCalendarDate(month: number, day: number, year: number): boolean {
  if (year < 1900 || year > new Date().getFullYear()) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  // Day 0 of the next month is the last day of this one.
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Shape *and* calendar. The schema used to test the shape alone, which let a
 * day-first "16/09/1980" through as month sixteen — the normalizer declines to
 * convert it and hands back the input, and the input is already MM/DD-shaped.
 */
export function isValidBirthDate(value: string): boolean {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return false;
  return isRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function format(month: number, day: number, year: number): string | null {
  if (!isRealCalendarDate(month, day, year)) return null;
  return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
}

/**
 * Convert various date formats to MM/DD/YYYY (Ameriquote requirement).
 *
 * Anything it cannot convert comes back untouched, so the schema's refine
 * rejects it. That is deliberate for the two shapes that used to slip through:
 * a day-first "16/09/1980" was passed along as written and posted month 16,
 * and a bare "1980" became 01/01/1980 — a birthday we invented, on a field the
 * buyer prices against. Neither is recoverable downstream, so both now fail
 * here where the row still names the lead.
 */
export function normalizeBirthDate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return raw;

  // MM/DD/YYYY and M/D/YYYY — already the target shape, but still checked:
  // this is where a day-first date is caught.
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    return format(Number(slash[1]), Number(slash[2]), Number(slash[3])) ?? raw;
  }

  // YYYY-MM-DD, with or without a time component.
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return format(Number(iso[2]), Number(iso[3]), Number(iso[1])) ?? raw;
  }

  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);

    // A bare year carries no day, and guessing one puts a wrong birthday in
    // front of the buyer. It is also ambiguous with a serial: read as a day
    // count, "1980" is 1905-06-02.
    if (/^\d{4}$/.test(trimmed) && n >= 1900 && n <= new Date().getFullYear()) {
      return raw;
    }

    // Excel serial. Bounded to dates a living person could be born on, so an
    // unrelated number in the column is rejected rather than turned into one.
    const asDate = new Date(EXCEL_EPOCH_MS + n * MS_PER_DAY);
    if (!isNaN(asDate.getTime())) {
      const year = asDate.getUTCFullYear();
      if (year >= 1900 && asDate.getTime() <= Date.now()) {
        return format(asDate.getUTCMonth() + 1, asDate.getUTCDate(), year) ?? raw;
      }
    }

    return raw;
  }

  // Anything else a Date can read — "Sep 16 1980", "16-Sep-1980", "09.16.1980".
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return format(parsed.getMonth() + 1, parsed.getDate(), parsed.getFullYear()) ?? raw;
  }

  return raw; // Return as-is, validation will catch it
}

/**
 * Convert a lead's original post date to the `m/d/Y H:i:s` Ameriquote wants for
 * Origin_Lead_Date. Aged-lead files usually carry a date only, so a missing
 * time component becomes midnight rather than being dropped.
 */
export function normalizeDatePosted(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00` : trimmed);
  if (isNaN(parsed.getTime())) return trimmed; // Return as-is; validation will catch it

  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${parsed.getMonth() + 1}/${parsed.getDate()}/${parsed.getFullYear()}`;
  const time = `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
  return `${date} ${time}`;
}

/** Normalize gender to Title Case matching Ameriquote allowed values */
export function normalizeGender(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (lower === 'm' || lower === 'male') return 'Male';
  if (lower === 'f' || lower === 'female') return 'Female';
  if (lower === 'non-binary' || lower === 'nonbinary' || lower === 'nb') return 'Non-binary';
  // Return Title Cased
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

/** Calculate age from birth date string */
export function calculateAge(birthDateStr: string): number | null {
  // Parse MM/DD/YYYY
  const match = birthDateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const month = parseInt(match[1], 10) - 1;
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);
  const dob = new Date(year, month, day);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
}

/** Trim name */
function trimName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// US states list for validation
// ---------------------------------------------------------------------------

const US_STATES = new Set([
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
  'PR',
  'VI',
  'GU',
  'AS',
  'MP',
]);

// ---------------------------------------------------------------------------
// Shared base schema — fields common to both ACA and FE inbound payloads
// ---------------------------------------------------------------------------

const optionalString = z.preprocess(
  v => (v === '' || v === null ? undefined : v),
  z.string().optional()
);

const baseInboundSchema = z.object({
  // Contact
  firstName: optionalString.transform(v => (v ? trimName(v) : undefined)),
  lastName: optionalString.transform(v => (v ? trimName(v) : undefined)),
  phone: z
    .string()
    .min(1, 'phone is required')
    .transform(normalizePhone)
    .refine(v => v.length === 10, 'phone must be exactly 10 digits'),
  email: optionalString
    .transform(v => (v ? normalizeEmail(v) : undefined))
    .refine(v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'email must be valid'),

  // Location
  address: optionalString.transform(v => v?.trim()),
  city: optionalString.transform(v => v?.trim()),
  state: optionalString
    .transform(v => (v ? normalizeState(v) : undefined))
    .refine(v => !v || US_STATES.has(v), 'state must be a valid 2-letter US state'),
  zipCode: optionalString
    .transform(v => (v ? normalizeZip(v) : undefined))
    .refine(v => !v || /^\d{5}$/.test(v), 'zipCode must be 5 digits'),

  // Demographics
  birthDate: optionalString
    .transform(v => (v ? normalizeBirthDate(v) : undefined))
    .refine(
      v => !v || isValidBirthDate(v),
      // Quoting the value is what makes this fixable: "must be MM/DD/YYYY" on
      // 18 rows never said the column held Excel serials.
      v => ({ message: `birthDate must be a real date in MM/DD/YYYY (got "${v}")` })
    ),
  age: z.union([z.number(), z.string().transform(v => parseInt(v, 10))]).optional(),

  // Optional common fields
  address2: z
    .string()
    .optional()
    .transform(v => v?.trim()),
  county: z
    .string()
    .optional()
    .transform(v => v?.trim()),
  secondaryPhone: z
    .string()
    .optional()
    .transform(v => (v ? normalizePhone(v) : undefined)),
  source: z.string().optional(),
  landingPage: z.string().optional(),
  // Kept permissive so a malformed IP never fails an inbound lead outright.
  // Delivery readiness (insurance-lead-readiness) is where a missing or
  // placeholder IP gets flagged, because that is the buyer's requirement.
  ipAddress: optionalString.transform(v => v?.trim()),
  /** Original date the lead was generated — becomes Origin_Lead_Date. */
  datePosted: optionalString
    .transform(v => (v ? normalizeDatePosted(v) : undefined))
    .refine(
      v => !v || /^\d{1,2}\/\d{1,2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(v),
      'datePosted must be a parseable date (e.g. 2026-07-14 or 07/14/2026)'
    ),

  // Compliance / tracking
  leadidToken: z.string().optional(),
  trustedFormUrl: z.string().optional(),
  consentLanguage: z.string().optional(),
  subId: z.string().optional(),
  pubId: z.string().optional(),
  recordingUrl: z.string().optional(),

  // New optional fields
  requestedEffectiveDate: z.string().optional(),
  ssn: z.string().optional(),
  primaryBeneficiaryName: z.string().optional(),
  primaryBeneficiaryRelationship: z.string().optional(),
  primaryBeneficiaryShare: z.string().optional(),
  secondPrimaryBeneficiaryName: z.string().optional(),
  secondPrimaryBeneficiaryRelationship: z.string().optional(),
  currentPolicyInForce: z.string().optional(),
  replacementReductionModification: z.string().optional(),
  replacementCompanyName: z.string().optional(),
  replacementFaceAmount: z.string().optional(),
  bankName: z.string().optional(),
  accountType: z.string().optional(),
  routingNumber: z.string().optional(),
  accountNumber: z.string().optional(),
  agentName: z.string().optional(),

  // Quote & Calculation fields
  aflacMonthlyQuote: z.string().optional(),
  aflacModifiedMonthlyQuote: z.string().optional(),
  sbliMonthlyQuote: z.string().optional(),
  sbliModifiedMonthlyQuote: z.string().optional(),
  cicaMonthlyQuote: z.string().optional(),
  cicaGiMonthlyQuote: z.string().optional(),
  gtlMonthlyQuote: z.string().optional(),
  transamericaMonthlyQuote: z.string().optional(),
  transamericaGradedMonthlyQuote: z.string().optional(),
  corebridgeMonthlyQuote: z.string().optional(),
  amamMonthlyQuote: z.string().optional(),
  amamGradedMonthlyQuote: z.string().optional(),
  amamReturnOrPremiumMonthlyQuote: z.string().optional(),
  ahlMonthlyQuote: z.string().optional(),
  ahlGradedMonthlyQuote: z.string().optional(),
  royalNeighborsMonthlyQuote: z.string().optional(),
  royalNeighborsGradedMonthlyQuote: z.string().optional(),
  gerberGiMonthlyQuote: z.string().optional(),
  mutualOfOmahaMonthlyQuote: z.string().optional(),
  mutualOfOmahaGradedMonthlyQuote: z.string().optional(),
  amamQuote: z.string().optional(),
  amamLessThanCurrent: z.string().optional(),
  gtlQuote: z.string().optional(),
  gtlLessThanCurrent: z.string().optional(),
  cheapestCarrierUnderCurrent: z.string().optional(),
  savingsVsCurrent: z.string().optional(),

  // Script transfer fields
  ageRange: z.string().optional(),
  hasFinalExpenseCoverage: z.string().optional(),
  coverageType: z.string().optional(),
  responsiblePerson: z.string().optional(),
  financialBurden: z.string().optional(),
  correctState: z.string().optional(),
  tobaccoStatus: z.string().optional(),
  tobaccoType: z.string().optional(),
  majorHealthHistory: z.string().optional(),
  majorHealthDetails: z.string().optional(),
  hasBankAccount: z.string().optional(),
  callbackTime: z.string().optional(),

  // Custom / arbitrary fields from Call Center or other integrations
  listId: z.string().optional(),
  status: z.string().optional(),
  customFields: z.record(z.any()).optional(),
});

// ---------------------------------------------------------------------------
// ACA schema (TYPE=31)
// ACA requires: Height_Feet, Height_Inches, Weight for full-mode post
// Gender is NOT required for ACA
// ---------------------------------------------------------------------------

export const acaInboundSchema = baseInboundSchema.extend({
  // ACA-specific fields (optional)
  heightFeet: z
    .preprocess(
      v => (v === '' || v === null ? undefined : v),
      z.union([z.number(), z.string().transform(v => parseInt(v, 10))])
    )
    .optional()
    .refine(v => v === undefined || (!isNaN(v) && v > 0), 'heightFeet must be positive'),
  heightInches: z
    .preprocess(
      v => (v === '' || v === null ? undefined : v),
      z.union([z.number(), z.string().transform(v => parseInt(v, 10))])
    )
    .optional()
    .refine(v => v === undefined || (!isNaN(v) && v >= 0), 'heightInches must be >= 0'),
  weight: z
    .preprocess(
      v => (v === '' || v === null ? undefined : v),
      z.union([z.number().transform(v => String(v)), z.string()])
    )
    .optional(),

  // Optional ACA fields
  gender: z
    .string()
    .optional()
    .transform(v => (v ? normalizeGender(v) : undefined)),
  smoker: z
    .string()
    .optional()
    .transform(v => (v ? (v.toLowerCase().startsWith('y') ? 'Yes' : 'No') : undefined)),
  householdIncome: z.union([z.number(), z.string()]).optional(),
  peopleInHousehold: z.union([z.number(), z.string()]).optional(),
  subsidy: z.string().optional(),
  coverageType: z.string().optional(),
  insuranceType: z.string().optional(),
  coverageAmount: z.union([z.number().transform(v => String(v)), z.string()]).optional(),
  coverageYears: z.string().optional(),
  insuredTimeframe: z.string().optional(),
});

// ---------------------------------------------------------------------------
// FE schema (TYPE=19)
// FE requires: Gender at ping time
// FE does NOT require Height/Weight
// ---------------------------------------------------------------------------

export const feInboundSchema = baseInboundSchema.extend({
  // FE-specific fields (optional)
  gender: optionalString
    .transform(v => (v ? normalizeGender(v) : undefined))
    .refine(
      v => v === undefined || ['Male', 'Female', 'Non-binary'].includes(v),
      'gender must be Male, Female, or Non-binary'
    ),

  // Optional FE fields
  heightFeet: z.union([z.number(), z.string().transform(v => parseInt(v, 10))]).optional(),
  heightInches: z.union([z.number(), z.string().transform(v => parseInt(v, 10))]).optional(),
  weight: z.union([z.number().transform(v => String(v)), z.string()]).optional(),
  smoker: z
    .string()
    .optional()
    .transform(v => (v ? (v.toLowerCase().startsWith('y') ? 'Yes' : 'No') : undefined)),
  lifeType: z.string().optional(),
  faceAmount: z.union([z.number(), z.string()]).optional(),
  riskType: z.string().optional(),
  insuranceType: z.string().optional(),
  coverageAmount: z.union([z.number().transform(v => String(v)), z.string()]).optional(),
  coverageYears: z.string().optional(),
  insuredTimeframe: z.string().optional(),
  term: z.string().optional(),
  monthlyPremium: z.union([z.number().transform(v => String(v)), z.string()]).optional(),
  carrier: z.string().optional(),
  product: z.string().optional(),
});

// B2B specific inbound schema
export const b2bInboundSchema = baseInboundSchema.extend({
  company: optionalString,
  repName: optionalString,
  industry: optionalString,
  revenue: optionalString,
  yearEstablished: optionalString,
});

// ---------------------------------------------------------------------------
// Validation entry point
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  normalized: Record<string, unknown> | null;
  errors: Array<{ path: string; message: string }> | null;
}

export function validateAndNormalize(
  vertical: 'ACA' | 'FE' | 'B2B',
  payload: Record<string, unknown>
): ValidationResult {
  let schema;
  if (vertical === 'ACA') {
    schema = acaInboundSchema;
  } else if (vertical === 'FE') {
    schema = feInboundSchema;
  } else {
    schema = b2bInboundSchema;
  }

  const result = schema.safeParse(payload);

  if (result.success) {
    const data = result.data as Record<string, unknown>;
    // Auto-calculate age from birthDate if not provided
    if (!data.age && typeof data.birthDate === 'string') {
      const computedAge = calculateAge(data.birthDate);
      if (computedAge !== null) {
        data.age = computedAge;
      }
    }
    return { valid: true, normalized: data, errors: null };
  }

  // Extract structured errors
  const errors = result.error.issues.map(issue => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));

  // Still build a partial normalized object for CRM storage
  const partial: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') {
      partial[key] = value.trim();
    } else {
      partial[key] = value;
    }
  }

  return { valid: false, normalized: partial, errors };
}
