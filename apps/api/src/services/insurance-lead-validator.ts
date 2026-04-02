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

/** Convert various date formats to MM/DD/YYYY (Ameriquote requirement) */
export function normalizeBirthDate(raw: string): string {
  // If already MM/DD/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;

  // YYYY-MM-DD
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[2]}/${isoMatch[3]}/${isoMatch[1]}`;

  // M/D/YYYY or MM/D/YYYY etc
  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const m = slashMatch[1].padStart(2, '0');
    const d = slashMatch[2].padStart(2, '0');
    return `${m}/${d}/${slashMatch[3]}`;
  }

  // Fallback — try Date parsing
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    const y = String(parsed.getFullYear());
    return `${m}/${d}/${y}`;
  }

  return raw; // Return as-is, validation will catch it
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
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC','PR','VI','GU','AS','MP',
]);

// ---------------------------------------------------------------------------
// Shared base schema — fields common to both ACA and FE inbound payloads
// ---------------------------------------------------------------------------

const baseInboundSchema = z.object({
  // Contact — required
  firstName: z.string().min(1, 'firstName is required').transform(trimName),
  lastName: z.string().min(1, 'lastName is required').transform(trimName),
  phone: z.string().min(1, 'phone is required').transform(normalizePhone)
    .refine(v => v.length === 10, 'phone must be exactly 10 digits'),
  email: z.string().min(1, 'email is required').transform(normalizeEmail)
    .refine(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'email must be valid'),

  // Location — required
  address: z.string().min(1, 'address is required').transform(v => v.trim()),
  city: z.string().min(1, 'city is required').transform(v => v.trim()),
  state: z.string().min(1, 'state is required').transform(normalizeState)
    .refine(v => US_STATES.has(v), 'state must be a valid 2-letter US state'),
  zipCode: z.string().min(1, 'zipCode is required').transform(normalizeZip)
    .refine(v => /^\d{5}$/.test(v), 'zipCode must be 5 digits'),

  // Demographics — required
  birthDate: z.string().min(1, 'birthDate is required').transform(normalizeBirthDate)
    .refine(v => /^\d{2}\/\d{2}\/\d{4}$/.test(v), 'birthDate must be MM/DD/YYYY'),
  age: z.union([z.number(), z.string().transform(v => parseInt(v, 10))])
    .optional(),

  // Optional common fields
  address2: z.string().optional().transform(v => v?.trim()),
  county: z.string().optional().transform(v => v?.trim()),
  secondaryPhone: z.string().optional().transform(v => v ? normalizePhone(v) : undefined),
  source: z.string().optional(),
  landingPage: z.string().optional(),
  ipAddress: z.string().optional(),

  // Compliance / tracking
  leadidToken: z.string().optional(),
  trustedFormUrl: z.string().optional(),
  consentLanguage: z.string().optional(),
  subId: z.string().optional(),
  pubId: z.string().optional(),
  recordingUrl: z.string().optional(),
});

// ---------------------------------------------------------------------------
// ACA schema (TYPE=31)
// ACA requires: Height_Feet, Height_Inches, Weight for full-mode post
// Gender is NOT required for ACA
// ---------------------------------------------------------------------------

export const acaInboundSchema = baseInboundSchema.extend({
  // ACA-specific required fields
  heightFeet: z.union([z.number(), z.string().transform(v => parseInt(v, 10))])
    .refine(v => !isNaN(v) && v > 0, 'heightFeet is required and must be positive'),
  heightInches: z.union([z.number(), z.string().transform(v => parseInt(v, 10))])
    .refine(v => !isNaN(v) && v >= 0, 'heightInches is required and must be >= 0'),
  weight: z.union([z.number().transform(v => String(v)), z.string().min(1, 'weight is required')]),

  // Optional ACA fields
  gender: z.string().optional().transform(v => v ? normalizeGender(v) : undefined),
  smoker: z.string().optional().transform(v => v ? (v.toLowerCase().startsWith('y') ? 'Yes' : 'No') : undefined),
  householdIncome: z.union([z.number(), z.string()]).optional(),
  peopleInHousehold: z.union([z.number(), z.string()]).optional(),
  subsidy: z.string().optional(),
  coverageType: z.string().optional(),
  insuranceType: z.string().optional(),
  coverageAmount: z.string().optional(),
  coverageYears: z.string().optional(),
  insuredTimeframe: z.string().optional(),
});

// ---------------------------------------------------------------------------
// FE schema (TYPE=19)
// FE requires: Gender at ping time
// FE does NOT require Height/Weight
// ---------------------------------------------------------------------------

export const feInboundSchema = baseInboundSchema.extend({
  // FE-specific required field
  gender: z.string().min(1, 'gender is required for FE leads').transform(normalizeGender)
    .refine(v => ['Male', 'Female', 'Non-binary'].includes(v),
      'gender must be Male, Female, or Non-binary'),

  // Optional FE fields
  heightFeet: z.union([z.number(), z.string().transform(v => parseInt(v, 10))]).optional(),
  heightInches: z.union([z.number(), z.string().transform(v => parseInt(v, 10))]).optional(),
  weight: z.union([z.number().transform(v => String(v)), z.string()]).optional(),
  smoker: z.string().optional().transform(v => v ? (v.toLowerCase().startsWith('y') ? 'Yes' : 'No') : undefined),
  lifeType: z.string().optional(),
  faceAmount: z.union([z.number(), z.string()]).optional(),
  riskType: z.string().optional(),
  insuranceType: z.string().optional(),
  coverageAmount: z.string().optional(),
  coverageYears: z.string().optional(),
  insuredTimeframe: z.string().optional(),
  term: z.string().optional(),
  monthlyPremium: z.string().optional(),
  carrier: z.string().optional(),
  product: z.string().optional(),
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
  vertical: 'ACA' | 'FE',
  payload: Record<string, unknown>,
): ValidationResult {
  const schema = vertical === 'ACA' ? acaInboundSchema : feInboundSchema;

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
