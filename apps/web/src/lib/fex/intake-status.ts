/**
 * What the quote intake says about itself: each section's one-line summary,
 * whether it is complete, and what still needs the agent's attention.
 *
 * Pure, so the summaries the agent reads at a glance are tested without a
 * browser, and the components that show them carry no rules of their own.
 */

import {
  CONDITION_DETAIL_FIELDS,
  DIAGNOSED_BUCKETS,
  MED_LAST_TAKEN_BUCKETS,
  PAYMENT_MODES,
  TREATED_BUCKETS,
  type Bucket,
  type DetailField,
} from '@hopwhistle/fex-engine/catalog';

import {
  ageFromDob,
  missingForQuote,
  type DraftCondition,
  type DraftMed,
  type QuoteDraft,
} from './draft';

export type IntakeSection = 'applicant' | 'coverage' | 'health' | 'meds';

export const INTAKE_SECTIONS: readonly IntakeSection[] = [
  'applicant',
  'coverage',
  'health',
  'meds',
];

export const SECTION_TITLE: Record<IntakeSection, string> = {
  applicant: 'Applicant',
  coverage: 'Coverage',
  health: 'Health',
  meds: 'Medications',
};

/** What `missingForQuote` names, said to the agent. */
export const MISSING_TEXT: Record<string, string> = {
  state: 'Needs state',
  sex: 'Needs sex',
  age: 'Needs age (18–100)',
  dob: 'Needs date of birth',
  face: 'Needs a face amount',
  budget: 'Needs a monthly budget',
};

/** A missing field by its name, for the readiness list ("State", "Face amount"). */
export const MISSING_LABEL: Record<string, string> = {
  state: 'State',
  sex: 'Sex',
  age: 'Age (18–100)',
  dob: 'Date of birth',
  face: 'Face amount',
  budget: 'Monthly budget',
};

/** The section a missing field lives in. */
export function sectionOfMissing(field: string): IntakeSection {
  return field === 'face' || field === 'budget' ? 'coverage' : 'applicant';
}

export function applicantDone(d: QuoteDraft): boolean {
  const m = missingForQuote(d);
  return m === null || sectionOfMissing(m) !== 'applicant';
}

export function coverageDone(d: QuoteDraft): boolean {
  const n = Number((d.coverage.mode === 'face' ? d.coverage.face : d.coverage.budget) || NaN);
  return d.coverage.mode === 'face' ? n >= 1000 && n <= 500000 : n >= 5 && n <= 2000;
}

/**
 * Applicant answers that do not stop the quote but change it: tobacco left
 * unasked is quoted as non-tobacco, so it is asked, never assumed silently.
 */
export function applicantUnasked(d: QuoteDraft): string[] {
  return d.tobacco === null ? ['Tobacco'] : [];
}

const SEX_WORD = { M: 'Male', F: 'Female' } as const;

/** "AL · Male · 65 · Non-tobacco · 6′0″ · 200 lb" -- only what was answered. */
export function applicantSummary(d: QuoteDraft): string[] {
  const parts: string[] = [];
  if (d.state) parts.push(d.state);
  if (d.sex) parts.push(SEX_WORD[d.sex]);
  if (d.ageOrDob.mode === 'age') {
    if (d.ageOrDob.age) parts.push(`Age ${d.ageOrDob.age}`);
  } else {
    const age = ageFromDob(d.ageOrDob.dob);
    if (age !== null) parts.push(`Age ${age}`);
  }
  if (d.tobacco === true) parts.push('Tobacco');
  else if (d.tobacco === false) parts.push('Non-tobacco');
  if (d.heightFt) parts.push(`${d.heightFt}′${d.heightIn || '0'}″`);
  if (d.weightLb) parts.push(`${d.weightLb} lb`);
  return parts;
}

const PAYMENT_SHORT: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannual: 'Semi-annual',
  annual: 'Annual',
};

export function paymentShort(mode: string): string {
  return PAYMENT_SHORT[mode] ?? PAYMENT_MODES.find(([v]) => v === mode)?.[1] ?? mode;
}

/** "$10,000 face · Monthly · Exercises 3+/wk". */
export function coverageSummary(d: QuoteDraft): string[] {
  const parts: string[] = [];
  if (d.coverage.mode === 'face') {
    const face = Number(d.coverage.face);
    if (face) parts.push(`$${face.toLocaleString('en-US')} face`);
  } else if (d.coverage.budget) {
    parts.push(`$${d.coverage.budget}/mo budget`);
  }
  parts.push(paymentShort(d.paymentMode));
  if (d.activityCredit) parts.push('Exercises 3+/wk');
  if (d.aetnaMedSupp) parts.push('Aetna Med Supp');
  return parts;
}

// ─── Conditions ──────────────────────────────────────────────────────────────

/** A bucket's label, said briefly: "1–2 years ago" → "1–2 yrs". */
export function briefBucket(label: string): string {
  return label
    .replace(/ ago$/, '')
    .replace(/years?/, 'yrs')
    .replace(/months?/, 'mo')
    .replace('Within 30 days', '<30 days');
}

export function bucketLabel(buckets: readonly Bucket[], months: unknown): string | undefined {
  return buckets.find(([, m]) => m === months)?.[0];
}

export function detailFields(code: string): readonly DetailField[] {
  return CONDITION_DETAIL_FIELDS[code] ?? [];
}

/** The questions a condition asks that have no answer yet, by their labels. */
export function unansweredQuestions(condition: DraftCondition): string[] {
  const open: string[] = [];
  if (condition.diagnosedMonthsAgo === undefined) open.push('Diagnosed');
  if (condition.treatedMonthsAgo === undefined) open.push('Last treated');
  for (const field of detailFields(condition.code)) {
    const v = condition.detail[field.key];
    if (v === undefined || v === '') open.push(field.label.replace(/\?$/, ''));
  }
  return open;
}

/**
 * Complete once every question has an answer, or once the agent pressed Done
 * on it -- "Not sure" is then what the prospect said, not a skipped question.
 */
export function conditionComplete(condition: DraftCondition): boolean {
  return Boolean(condition.reviewed) || unansweredQuestions(condition).length === 0;
}

/** "2 details needed" / "1 detail needed". */
export function detailsNeededText(condition: DraftCondition): string {
  const n = unansweredQuestions(condition).length;
  return `${n} detail${n === 1 ? '' : 's'} needed`;
}

/** What was said about a condition, briefly: "Dx 1–2 yrs · Tx current · On meds". */
export function conditionFacts(condition: DraftCondition): string[] {
  const facts: string[] = [];
  const dx = bucketLabel(DIAGNOSED_BUCKETS, condition.diagnosedMonthsAgo);
  if (condition.diagnosedMonthsAgo !== undefined && dx) facts.push(`Dx ${briefBucket(dx)}`);
  if (condition.treatedMonthsAgo === 0) facts.push('Treated now');
  else if (condition.treatedMonthsAgo === null) facts.push('Never treated');
  else if (condition.treatedMonthsAgo !== undefined) {
    const tx = bucketLabel(TREATED_BUCKETS, condition.treatedMonthsAgo);
    if (tx) facts.push(`Tx ${briefBucket(tx)}`);
  }
  for (const field of detailFields(condition.code)) {
    const value = condition.detail[field.key];
    if (value === undefined || value === '') continue;
    const name = field.label.replace(/\?$/, '');
    if (field.type === 'yesno') facts.push(`${name}: ${value ? 'yes' : 'no'}`);
    else if (field.type === 'select')
      facts.push(field.options.find(([v]) => v === value)?.[1] ?? String(value));
    else if (field.type === 'number') facts.push(`${name} ${value}`);
    else {
      const b = bucketLabel(DIAGNOSED_BUCKETS, value);
      if (b) facts.push(`${name} ${briefBucket(b)}`);
    }
  }
  if (condition.onMeds) facts.push('On meds');
  if (!facts.length && condition.reviewed) facts.push('Details not sure');
  return facts;
}

// ─── Medications ─────────────────────────────────────────────────────────────

/** The uses a medication may be asked about: its own list, else the quote's. */
export function medUseOptions(
  med: DraftMed,
  asked: readonly string[] | undefined,
  conditionLabel: (code: string) => string
): Array<{ code: string; label: string }> {
  if (med.indications?.length) return med.indications;
  return (asked ?? []).map(code => ({ code, label: conditionLabel(code) }));
}

/** The medication's use is a question: it has several, or a carrier asked. */
export function medAsksUse(
  med: DraftMed,
  asked: readonly string[] | undefined,
  conditionLabel: (code: string) => string
): boolean {
  return (
    (Boolean(med.multiUse) || Boolean(asked)) &&
    medUseOptions(med, asked, conditionLabel).length > 0
  );
}

export function medNeedsUse(
  med: DraftMed,
  asked: readonly string[] | undefined,
  conditionLabel: (code: string) => string
): boolean {
  return !med.indication && medAsksUse(med, asked, conditionLabel);
}

/**
 * The condition codes a medication is for, as far as the data says: the use
 * the agent confirmed, else the drug's single listed use. A multi-use drug
 * whose use is unconfirmed is for nothing yet -- never guessed.
 */
export function medConditionCodes(med: DraftMed): string[] {
  if (med.indication) return [med.indication];
  if (!med.multiUse && med.indications?.length === 1) return [med.indications[0].code];
  return [];
}

/** "metformin (Glucophage)" → "Metformin": the name for a crowded line. */
export function medShortName(name: string): string {
  const generic = name.replace(/\s*\(.*\)\s*$/, '');
  return generic.charAt(0).toUpperCase() + generic.slice(1);
}

/** "Stopped 1–6 months ago", or nothing while still taking it. */
export function medTakenText(med: DraftMed): string | undefined {
  return med.lastTakenMonthsAgo && med.lastTakenMonthsAgo > 0
    ? bucketLabel(MED_LAST_TAKEN_BUCKETS, med.lastTakenMonthsAgo)
    : undefined;
}

// ─── What still needs the agent ──────────────────────────────────────────────

export interface AttentionItem {
  section: IntakeSection;
  /** The condition or medication key, to open it directly. */
  itemKey?: string;
  /** "Diabetes", "gabapentin". */
  subject: string;
  /** "2 details needed", "what is it for?". */
  need: string;
}

/**
 * Open questions that change the quote but do not stop it: unanswered
 * condition details (the engine assumes, and says so) and medications whose
 * use a carrier asked. In the order the sections are asked.
 */
export function attentionItems(
  draft: QuoteDraft,
  needsIndication: ReadonlyMap<string, readonly string[]>,
  conditionLabel: (code: string) => string
): AttentionItem[] {
  const items: AttentionItem[] = applicantUnasked(draft).map(subject => ({
    section: 'applicant' as const,
    subject,
    need: 'not asked',
  }));
  for (const c of draft.conditions) {
    if (conditionComplete(c)) continue;
    items.push({
      section: 'health',
      itemKey: c.key,
      subject: conditionLabel(c.code),
      need: detailsNeededText(c),
    });
  }
  for (const m of draft.meds) {
    if (!medNeedsUse(m, needsIndication.get(m.drugId), conditionLabel)) continue;
    items.push({ section: 'meds', itemKey: m.key, subject: m.name, need: 'what is it for?' });
  }
  return items;
}
