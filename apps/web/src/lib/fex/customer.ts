/**
 * A CRM customer, as the quoter sees them -- and back.
 *
 * The one place an `InsuranceLeadDetail` turns into a quote draft, a saved
 * quote's applicant turns back into one (Requote), and a draft's answers are
 * offered back to the customer record. Pure, so it is tested without a
 * browser, and no component converts a field on its own.
 *
 * ── What is prefilled ────────────────────────────────────────────────────────
 *
 * Only what the record states plainly and the engine can use: state, date of
 * birth (or age when there is no date), sex, tobacco, the coverage they asked
 * for, and height/weight when a script captured them. Each value goes through
 * the same lenient parsers as a call's prefill (`prefill.ts`), so "Florida"
 * and "FL", "05/14/1958" and "1958-05-14" all land, and a value that does not
 * parse is left blank rather than guessed.
 *
 * Health conditions and medications are NEVER prefilled, from the CRM or
 * anywhere else: a vendor's "health: good" is not an underwriting answer.
 */

import type { InsuranceLeadDetail } from '@/lib/api/leads';

import { PAYMENTS_PER_YEAR, type FexAgencySettings, type FexApplicant } from './api';
import { ageFromDob, emptyDraft, newKey, type QuoteDraft, type QuoteDraftField } from './draft';
import {
  parseAge,
  parseDob,
  parseFace,
  parseHeight,
  parseSex,
  parseState,
  parseTobacco,
  parseWeight,
} from './prefill';

type Defaults = Pick<FexAgencySettings, 'defaultFace' | 'defaultMode'> | null | undefined;

/**
 * What the agent should ask when the record does not say: the four the
 * quoter cannot price without, and tobacco. An unknown tobacco status is left
 * UNANSWERED in the draft (null) rather than defaulted to "no": the quoter
 * still prices it as non-tobacco, but the intake shows it unanswered and the
 * customer header names it, so it is asked rather than assumed.
 */
const ASK: ReadonlyArray<QuoteDraftField> = ['state', 'sex', 'dob', 'tobacco', 'face'];

export interface CustomerDraft {
  draft: QuoteDraft;
  /** Filled from the record (and marked so in the intake). */
  fields: Set<QuoteDraftField>;
  /** Not on the record and needed for a true quote: the agent asks these. */
  missing: QuoteDraftField[];
}

const custom = (lead: Pick<InsuranceLeadDetail, 'customFields'>, ...keys: string[]): unknown[] =>
  keys.map(key => (lead.customFields ?? {})[key]);

/** The customer's name, the way the CRM shows it. */
export function customerName(
  lead: Pick<InsuranceLeadDetail, 'fullName' | 'firstName' | 'lastName'>
): string {
  return (
    lead.fullName?.trim() ||
    [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() ||
    'Unnamed customer'
  );
}

/**
 * A new quote draft for this customer: what the record knows, filled in and
 * marked; what it does not, left for the agent.
 */
export function insuranceLeadToFexDraft(
  lead: InsuranceLeadDetail,
  defaults?: Defaults
): CustomerDraft {
  const draft = emptyDraft(defaults);
  const fields = new Set<QuoteDraftField>();

  const state = parseState(lead.state);
  if (state) {
    draft.state = state;
    fields.add('state');
  }

  const dob = [lead.birthDate, ...custom(lead, 'dob', 'date_of_birth', 'birthDate')]
    .map(parseDob)
    .find(Boolean);
  if (dob) {
    draft.ageOrDob = { mode: 'dob', dob };
    fields.add('dob');
  } else {
    const age = parseAge(lead.age);
    if (age !== null) {
      draft.ageOrDob = { mode: 'age', age: String(age) };
      fields.add('age');
    }
  }

  const sex = [lead.gender, ...custom(lead, 'gender', 'sex')].map(parseSex).find(Boolean);
  if (sex) {
    draft.sex = sex;
    fields.add('sex');
  }

  // Tobacco is known only when the record says so; an empty one is asked.
  const tobacco = [lead.smoker, ...custom(lead, 'smoker', 'tobacco')]
    .map(parseTobacco)
    .find(v => v !== null);
  if (tobacco !== undefined && tobacco !== null) {
    draft.tobacco = tobacco;
    fields.add('tobacco');
  } else {
    draft.tobacco = null;
  }

  const face = [lead.faceAmount, lead.coverageAmount].map(parseFace).find(v => v !== null);
  if (face !== undefined && face !== null) {
    draft.coverage = { mode: 'face', face: String(face) };
    fields.add('face');
  }

  const height = custom(lead, 'height')
    .map(parseHeight)
    .find(v => v !== null);
  const weight = custom(lead, 'weight')
    .map(parseWeight)
    .find(v => v !== null);
  if (height != null && weight != null) {
    draft.heightFt = String(Math.floor(height / 12));
    draft.heightIn = String(height % 12);
    draft.weightLb = String(weight);
    fields.add('height');
    fields.add('weight');
  }

  draft.prefilled = new Set(fields);

  const missing = ASK.filter(field =>
    field === 'dob' ? !fields.has('dob') && !fields.has('age') : !fields.has(field)
  );
  return { draft, fields, missing };
}

/**
 * A saved quote's applicant as a draft, for Requote: the same answers, run
 * again against today's rates. A date of birth stays a date of birth -- the
 * age is today's, not the one it was quoted at.
 */
export function fexApplicantToDraft(
  applicant: FexApplicant & { quoteDate?: string },
  defaults?: Defaults
): QuoteDraft {
  const draft = emptyDraft(defaults);
  draft.state = applicant.state;
  draft.sex = applicant.sex;
  draft.tobacco = applicant.tobacco;
  draft.paymentMode = applicant.mode;
  draft.ageOrDob = applicant.dob
    ? { mode: 'dob', dob: applicant.dob }
    : { mode: 'age', age: applicant.age != null ? String(applicant.age) : '' };
  draft.coverage =
    applicant.budget != null
      ? { mode: 'budget', budget: String(applicant.budget) }
      : { mode: 'face', face: applicant.face != null ? String(applicant.face) : '' };
  if (applicant.heightIn && applicant.weightLb) {
    draft.heightFt = String(Math.floor(applicant.heightIn / 12));
    draft.heightIn = String(applicant.heightIn % 12);
    draft.weightLb = String(applicant.weightLb);
  }
  draft.activityCredit = applicant.activityCredit === true;
  draft.aetnaMedSupp = applicant.aetnaMedSupp === true;
  draft.conditions = (applicant.conditions ?? []).map(c => ({
    key: newKey('c'),
    code: c.code,
    diagnosedMonthsAgo: c.diagnosedMonthsAgo,
    treatedMonthsAgo: c.treatedMonthsAgo,
    onMeds: c.onMeds === true,
    detail: { ...(c.detail ?? {}) },
  }));
  draft.meds = (applicant.meds ?? []).map(m => ({
    key: newKey('m'),
    drugId: m.drugId,
    name: m.name ?? m.drugId,
    indication: m.indication,
    lastTakenMonthsAgo: m.lastTakenMonthsAgo,
    startedMonthsAgo: m.startedMonthsAgo,
  }));
  return draft;
}

/** "1958-05-14" -> "05/14/1958", the CRM's own date format. */
const crmDate = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
};

export interface CustomerUpdate {
  /** The PATCH body: only fields the record has blank. */
  patch: Record<string, string | number>;
  /** "Date of birth", "Sex" -- for the button that offers it. */
  labels: string[];
}

const blank = (value: unknown): boolean =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

/**
 * What the agent learned while quoting that the customer record is missing.
 *
 * Only ever fills a BLANK field: a value already on the record is the CRM's,
 * and a quote never overwrites it. Only fields that mean the same thing in
 * both places -- who the customer is, not what this quote asked -- so a
 * "what if" coverage amount or a health answer never lands on the record.
 */
export function customerUpdatesFromDraft(
  lead: InsuranceLeadDetail,
  draft: QuoteDraft
): CustomerUpdate {
  const patch: Record<string, string | number> = {};
  const labels: string[] = [];

  if (blank(lead.state) && draft.state) {
    patch.state = draft.state;
    labels.push('State');
  }
  if (draft.ageOrDob.mode === 'dob' && blank(lead.birthDate)) {
    const dob = parseDob(draft.ageOrDob.dob);
    if (dob) {
      patch.birthDate = crmDate(dob);
      labels.push('Date of birth');
      const age = ageFromDob(dob);
      if (age !== null && blank(lead.age)) patch.age = age;
    }
  } else if (draft.ageOrDob.mode === 'age' && blank(lead.age) && blank(lead.birthDate)) {
    const age = parseAge(draft.ageOrDob.age);
    if (age !== null) {
      patch.age = age;
      labels.push('Age');
    }
  }
  if (blank(lead.gender) && draft.sex) {
    patch.gender = draft.sex === 'F' ? 'Female' : 'Male';
    labels.push('Sex');
  }
  // `null` is "not answered": only an answer the agent gave is written.
  if (blank(lead.smoker) && draft.tobacco !== null) {
    patch.smoker = draft.tobacco ? 'YES' : 'NO';
    labels.push('Tobacco');
  }
  return { patch, labels };
}

export interface CustomerFacts {
  name: string;
  state: string | null;
  age: number | null;
  sex: 'M' | 'F' | null;
  tobacco: boolean | null;
}

/** The customer in one line's worth of facts, for headers. */
export function customerFacts(lead: InsuranceLeadDetail): CustomerFacts {
  const dob = parseDob(lead.birthDate);
  return {
    name: customerName(lead),
    state: parseState(lead.state),
    age: dob ? ageFromDob(dob) : parseAge(lead.age),
    sex: parseSex(lead.gender),
    tobacco: parseTobacco(lead.smoker),
  };
}

/** "TN · 67 · Female · Non-tobacco": the record's facts, the ones it has. */
export function customerFactLine(lead: InsuranceLeadDetail): string {
  const f = customerFacts(lead);
  return [
    f.state,
    f.age !== null ? `Age ${f.age}` : null,
    f.sex === 'F' ? 'Female' : f.sex === 'M' ? 'Male' : null,
    f.tobacco === null ? null : f.tobacco ? 'Tobacco' : 'Non-tobacco',
  ]
    .filter(Boolean)
    .join(' · ');
}

export interface SnapshotDifference {
  field: 'State' | 'Age' | 'Sex' | 'Tobacco';
  quoted: string;
  now: string;
}

/**
 * Where the customer record no longer matches what a saved quote was run on
 * -- moved state, a birthday since, tobacco status corrected -- so a
 * historical quote is never read as if it still described them.
 */
export function snapshotDifferences(
  quoted: { state: string; age: number | null; sex: string; tobacco: boolean },
  lead: InsuranceLeadDetail
): SnapshotDifference[] {
  const now = customerFacts(lead);
  const out: SnapshotDifference[] = [];
  if (now.state && now.state !== quoted.state) {
    out.push({ field: 'State', quoted: quoted.state, now: now.state });
  }
  if (now.age !== null && quoted.age !== null && now.age !== quoted.age) {
    out.push({ field: 'Age', quoted: String(quoted.age), now: String(now.age) });
  }
  if (now.sex && now.sex !== quoted.sex) {
    out.push({ field: 'Sex', quoted: quoted.sex, now: now.sex });
  }
  if (now.tobacco !== null && now.tobacco !== quoted.tobacco) {
    const word = (t: boolean) => (t ? 'Tobacco' : 'Non-tobacco');
    out.push({ field: 'Tobacco', quoted: word(quoted.tobacco), now: word(now.tobacco) });
  }
  return out;
}

/** A modal premium as the annual figure the application form asks for. */
export function annualPremium(
  premium: number | null | undefined,
  mode: keyof typeof PAYMENTS_PER_YEAR
): number | null {
  if (premium == null || !Number.isFinite(premium)) return null;
  return Math.round(premium * PAYMENTS_PER_YEAR[mode] * 100) / 100;
}

/** The quote session's key for a customer's draft and selection. */
export const customerSessionKey = (leadId: string): string => `customer:${leadId}`;
