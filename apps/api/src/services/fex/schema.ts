/**
 * What a quote request may carry, checked before the engine sees it.
 *
 * The engine is pure and trusts its input: an unknown condition code is simply
 * never matched, which reads as "no health issue". So every code and drug id
 * is checked against the loaded bundle here, and a request naming one that
 * does not exist is refused rather than quoted as healthier than it is.
 *
 * `quoteDate` is never read from the client. The server sets it to today in
 * America/New_York -- the portal's day everywhere else -- so a quote cannot be
 * back-dated into a younger age band.
 */

import { agesOn, type Applicant } from '@hopwhistle/fex-engine';
import { STATES } from '@hopwhistle/fex-engine/catalog';
import { z } from 'zod';

import type { FexEngine } from './bundle.js';

export const PAYMENT_MODE_VALUES = ['monthly', 'quarterly', 'semiannual', 'annual'] as const;
export const QUOTE_SOURCES = ['PAGE', 'SOFTPHONE', 'CALL_CENTER'] as const;

const DETAIL_KEYS = [
  'cancer_type',
  'location',
  'stage',
  'paralysis_type',
  'complications',
  'surgically_corrected',
  'count',
  'last_episode_months_ago',
  'insulin_units_daily',
  'never_treated',
] as const;

const months = z.number().finite().min(0).max(1200);

const ConditionSchema = z
  .object({
    code: z.string().min(1).max(80),
    diagnosedMonthsAgo: months.optional(),
    treatedMonthsAgo: months.nullable().optional(),
    onMeds: z.boolean().optional(),
    detail: z
      .record(z.enum(DETAIL_KEYS), z.union([z.string().max(80), z.number().finite(), z.boolean()]))
      .optional(),
  })
  .strict();

const MedSchema = z
  .object({
    drugId: z.string().min(1).max(120),
    name: z.string().max(80).optional(),
    indication: z.string().min(1).max(80).optional(),
    startedMonthsAgo: months.optional(),
    lastTakenMonthsAgo: months.optional(),
  })
  .strict();

export const ApplicantSchema = z
  .object({
    state: z.enum(STATES as unknown as [string, ...string[]], {
      errorMap: () => ({ message: 'must be a two-letter US state or DC' }),
    }),
    sex: z.enum(['M', 'F']),
    tobacco: z.boolean(),
    age: z.number().int().min(18).max(100).optional(),
    dob: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
      .optional(),
    heightIn: z.number().int().min(48).max(90).optional(),
    weightLb: z.number().int().min(70).max(600).optional(),
    face: z.number().int().min(1000).max(500000).optional(),
    budget: z.number().finite().min(5).max(2000).optional(),
    mode: z.enum(PAYMENT_MODE_VALUES),
    activityCredit: z.boolean().optional(),
    aetnaMedSupp: z.boolean().optional(),
    conditions: z.array(ConditionSchema).max(40).default([]),
    meds: z.array(MedSchema).max(30).default([]),
  })
  .strict();

export type ApplicantInput = z.infer<typeof ApplicantSchema>;

/** Today, YYYY-MM-DD, in America/New_York. */
export function quoteDateToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function isRealDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export type ParsedApplicant =
  | { ok: true; applicant: Applicant & { quoteDate: string } }
  | { ok: false; message: string };

/** One readable line naming the first bad field, prefixed with where it is. */
function describe(error: z.ZodError, prefix: string): string {
  const issue = error.issues[0];
  const path = [prefix, ...issue.path].filter(p => p !== '').join('.');
  return `${path}: ${issue.message}`;
}

/**
 * Validate an applicant against the schema and the loaded bundle, and stamp
 * the server's quote date on it. `prefix` names where it sat in the body.
 */
export function parseApplicant(
  raw: unknown,
  engine: FexEngine,
  quoteDate: string = quoteDateToday(),
  prefix = 'applicant'
): ParsedApplicant {
  if (raw === undefined || raw === null || typeof raw !== 'object') {
    return { ok: false, message: `${prefix}: Required` };
  }
  // The client never sets the quote date; drop it before the strict parse.
  const { quoteDate: _ignored, ...rest } = raw as Record<string, unknown>;
  void _ignored;

  const parsed = ApplicantSchema.safeParse(rest);
  if (!parsed.success) return { ok: false, message: describe(parsed.error, prefix) };
  const a = parsed.data;
  const fail = (field: string, message: string): ParsedApplicant => ({
    ok: false,
    message: `${prefix}.${field}: ${message}`,
  });

  if ((a.age === undefined) === (a.dob === undefined)) {
    return fail('age', 'give exactly one of age or dob');
  }
  if (a.dob !== undefined) {
    if (!isRealDate(a.dob)) return fail('dob', 'is not a real date');
    const { alb } = agesOn(a.dob, quoteDate);
    if (alb < 18 || alb > 100) return fail('dob', 'age on the quote date must be 18–100');
  }
  if ((a.heightIn === undefined) !== (a.weightLb === undefined)) {
    return fail(
      a.heightIn === undefined ? 'heightIn' : 'weightLb',
      'give height and weight together'
    );
  }
  if ((a.face === undefined) === (a.budget === undefined)) {
    return fail('face', 'give exactly one of face or budget');
  }
  for (const [i, condition] of a.conditions.entries()) {
    if (!engine.conditionsByCode.has(condition.code)) {
      return fail(`conditions.${i}.code`, `unknown condition "${condition.code}"`);
    }
  }
  for (const [i, med] of a.meds.entries()) {
    if (!engine.drugs.byId.has(med.drugId)) {
      return fail(`meds.${i}.drugId`, `unknown medication "${med.drugId}"`);
    }
    if (med.indication !== undefined && !engine.conditionsByCode.has(med.indication)) {
      return fail(`meds.${i}.indication`, `unknown condition "${med.indication}"`);
    }
  }

  const applicant: Applicant & { quoteDate: string } = {
    state: a.state,
    sex: a.sex,
    tobacco: a.tobacco,
    mode: a.mode,
    conditions: a.conditions.map(c => ({ ...c })),
    meds: a.meds.map(m => ({ ...m })),
    quoteDate,
  };
  if (a.age !== undefined) applicant.age = a.age;
  if (a.dob !== undefined) applicant.dob = a.dob;
  if (a.heightIn !== undefined) applicant.heightIn = a.heightIn;
  if (a.weightLb !== undefined) applicant.weightLb = a.weightLb;
  if (a.face !== undefined) applicant.face = a.face;
  if (a.budget !== undefined) applicant.budget = a.budget;
  if (a.activityCredit !== undefined) applicant.activityCredit = a.activityCredit;
  if (a.aetnaMedSupp !== undefined) applicant.aetnaMedSupp = a.aetnaMedSupp;
  return { ok: true, applicant };
}

/** The age a summary row shows: the given age, or age last birthday on the quote date. */
export function summaryAge(applicant: Applicant & { quoteDate: string }): number | null {
  if (applicant.age !== undefined) return applicant.age;
  if (applicant.dob) return agesOn(applicant.dob, applicant.quoteDate).alb;
  return null;
}
