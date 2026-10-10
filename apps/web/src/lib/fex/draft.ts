/**
 * The quoter's form state, and the one place it becomes an API body.
 *
 * `QuoteDraft` is what the screen holds -- including the half-typed and the
 * not-yet-answered -- and `toApplicant` is the only translation into what the
 * engine is asked. Pure, so it is tested without a browser.
 */

import type { PaymentMode } from '@hopwhistle/fex-engine/types';

import type { FexAgencySettings, FexApplicant } from './api';

export type QuoteDraftField =
  | 'state'
  | 'sex'
  | 'tobacco'
  | 'age'
  | 'dob'
  | 'height'
  | 'weight'
  | 'face';

export interface DraftCondition {
  /** Stable React key. */
  key: string;
  code: string;
  diagnosedMonthsAgo?: number;
  /** 0 = currently treated; null = never treated; undefined = not sure. */
  treatedMonthsAgo?: number | null;
  onMeds: boolean;
  detail: Record<string, string | number | boolean | undefined>;
  /**
   * The agent finished its questions (pressed Done), so "Not sure" answers are
   * deliberate rather than unasked. Screen-only: never sent to the engine.
   */
  reviewed?: boolean;
}

export interface DraftMed {
  key: string;
  drugId: string;
  /** What the agent picked, for display ("Metformin · Glucophage"). */
  name: string;
  /** Condition code the drug is taken for, once confirmed. */
  indication?: string;
  lastTakenMonthsAgo?: number;
  startedMonthsAgo?: number;
  /** The use options offered for it, from the search hit. */
  indications?: Array<{ code: string; label: string }>;
  multiUse?: boolean;
  /** The drug class from the search hit ("Biguanide"), for display only. */
  drugClass?: string | null;
}

export interface QuoteDraft {
  state: string;
  sex: 'M' | 'F' | '';
  /** null = not answered yet. */
  tobacco: boolean | null;
  ageOrDob: { mode: 'age'; age: string } | { mode: 'dob'; dob: string };
  heightFt: string;
  heightIn: string;
  weightLb: string;
  coverage: { mode: 'face'; face: string } | { mode: 'budget'; budget: string };
  paymentMode: PaymentMode;
  activityCredit: boolean;
  aetnaMedSupp: boolean;
  conditions: DraftCondition[];
  meds: DraftMed[];
  /** Fields filled from the lead and not edited since. */
  prefilled: Set<QuoteDraftField>;
}

let keySeq = 0;
export const newKey = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${++keySeq}`;

export function emptyDraft(
  settings?: Pick<FexAgencySettings, 'defaultFace' | 'defaultMode'> | null
): QuoteDraft {
  return {
    state: '',
    sex: '',
    tobacco: false,
    ageOrDob: { mode: 'age', age: '' },
    heightFt: '',
    heightIn: '',
    weightLb: '',
    coverage: { mode: 'face', face: String(settings?.defaultFace ?? 10000) },
    paymentMode: settings?.defaultMode ?? 'monthly',
    activityCredit: false,
    aetnaMedSupp: false,
    conditions: [],
    meds: [],
    prefilled: new Set(),
  };
}

/** Merge a prefill (from `prefillFromProspect`) over a base draft. */
export function applyPrefill(
  base: QuoteDraft,
  prefill: { draft: Partial<QuoteDraft>; fields: Set<QuoteDraftField> }
): QuoteDraft {
  return {
    ...base,
    ...prefill.draft,
    conditions: base.conditions,
    meds: base.meds,
    prefilled: new Set([...base.prefilled, ...prefill.fields]),
  };
}

export type DraftAction =
  | { type: 'set'; patch: Partial<Omit<QuoteDraft, 'prefilled'>>; fields?: QuoteDraftField[] }
  /** `key`: the caller's own, to open the new condition straight away. */
  | { type: 'addCondition'; code: string; key?: string }
  | { type: 'updateCondition'; key: string; patch: Partial<Omit<DraftCondition, 'key'>> }
  | { type: 'removeCondition'; key: string }
  | { type: 'addMed'; med: Omit<DraftMed, 'key'>; key?: string }
  | { type: 'updateMed'; key: string; patch: Partial<Omit<DraftMed, 'key'>> }
  | { type: 'removeMed'; key: string }
  /** Answer "what is it prescribed for?" for every med with this drug id. */
  | { type: 'setIndication'; drugId: string; indication: string }
  | { type: 'replace'; draft: QuoteDraft };

export function draftReducer(draft: QuoteDraft, action: DraftAction): QuoteDraft {
  switch (action.type) {
    case 'set': {
      const prefilled = new Set(draft.prefilled);
      for (const field of action.fields ?? []) prefilled.delete(field);
      return { ...draft, ...action.patch, prefilled };
    }
    case 'addCondition':
      if (draft.conditions.some(c => c.code === action.code)) return draft;
      return {
        ...draft,
        conditions: [
          ...draft.conditions,
          { key: action.key ?? newKey('c'), code: action.code, onMeds: false, detail: {} },
        ],
      };
    case 'updateCondition':
      return {
        ...draft,
        conditions: draft.conditions.map(c =>
          c.key === action.key ? { ...c, ...action.patch } : c
        ),
      };
    case 'removeCondition':
      return { ...draft, conditions: draft.conditions.filter(c => c.key !== action.key) };
    case 'addMed':
      if (draft.meds.some(m => m.drugId === action.med.drugId)) return draft;
      return {
        ...draft,
        meds: [
          ...draft.meds,
          { lastTakenMonthsAgo: 0, ...action.med, key: action.key ?? newKey('m') },
        ],
      };
    case 'updateMed':
      return {
        ...draft,
        meds: draft.meds.map(m => (m.key === action.key ? { ...m, ...action.patch } : m)),
      };
    case 'removeMed':
      return { ...draft, meds: draft.meds.filter(m => m.key !== action.key) };
    case 'setIndication':
      return {
        ...draft,
        meds: draft.meds.map(m =>
          m.drugId === action.drugId ? { ...m, indication: action.indication } : m
        ),
      };
    case 'replace':
      return action.draft;
    default:
      return draft;
  }
}

const intOf = (raw: string): number | null => {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

/** Age last birthday on `on` (YYYY-MM-DD) for a YYYY-MM-DD date of birth. */
export function ageFromDob(dob: string, on: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = on.getFullYear() - y;
  if (on.getMonth() + 1 < mo || (on.getMonth() + 1 === mo && on.getDate() < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** Height in inches, from feet and inches, or null when not entered. */
export function heightInches(draft: Pick<QuoteDraft, 'heightFt' | 'heightIn'>): number | null {
  const ft = intOf(draft.heightFt);
  if (ft === null) return null;
  const inches = intOf(draft.heightIn) ?? 0;
  return Math.round(ft * 12 + inches);
}

/**
 * Every field the draft still needs before it can be quoted, in the order
 * they are asked: state, sex, age (or date of birth), then coverage.
 */
export function missingFieldsForQuote(draft: QuoteDraft): string[] {
  const missing: string[] = [];
  if (!draft.state) missing.push('state');
  if (!draft.sex) missing.push('sex');
  if (draft.ageOrDob.mode === 'age') {
    const age = intOf(draft.ageOrDob.age);
    if (age === null || age < 18 || age > 100) missing.push('age');
  } else {
    const age = ageFromDob(draft.ageOrDob.dob);
    if (age === null || age < 18 || age > 100) missing.push('dob');
  }
  if (draft.coverage.mode === 'face') {
    const face = intOf(draft.coverage.face);
    if (face === null || face < 1000 || face > 500000) missing.push('face');
  } else {
    const budget = intOf(draft.coverage.budget);
    if (budget === null || budget < 5 || budget > 2000) missing.push('budget');
  }
  return missing;
}

/** Why the draft cannot be quoted yet (the first missing field), or null when it can. */
export function missingForQuote(draft: QuoteDraft): string | null {
  return missingFieldsForQuote(draft)[0] ?? null;
}

/**
 * The API body for this draft, or null while it is missing state, sex,
 * age/DOB or coverage. Height goes only with a weight (the engine needs both
 * for a build chart, and the API refuses one without the other).
 */
export function toApplicant(draft: QuoteDraft): FexApplicant | null {
  if (missingForQuote(draft)) return null;

  const applicant: FexApplicant = {
    state: draft.state,
    sex: draft.sex as 'M' | 'F',
    tobacco: draft.tobacco === true,
    mode: draft.paymentMode,
    conditions: draft.conditions.map(c => {
      const detail = Object.fromEntries(
        Object.entries(c.detail).filter(([, v]) => v !== undefined && v !== '')
      ) as Record<string, string | number | boolean>;
      return {
        code: c.code,
        ...(c.diagnosedMonthsAgo !== undefined ? { diagnosedMonthsAgo: c.diagnosedMonthsAgo } : {}),
        ...(c.treatedMonthsAgo !== undefined ? { treatedMonthsAgo: c.treatedMonthsAgo } : {}),
        ...(c.onMeds ? { onMeds: true } : {}),
        ...(Object.keys(detail).length ? { detail } : {}),
      };
    }),
    meds: draft.meds.map(m => ({
      drugId: m.drugId,
      ...(m.name ? { name: m.name.slice(0, 80) } : {}),
      ...(m.indication ? { indication: m.indication } : {}),
      ...(m.lastTakenMonthsAgo !== undefined ? { lastTakenMonthsAgo: m.lastTakenMonthsAgo } : {}),
      ...(m.startedMonthsAgo !== undefined ? { startedMonthsAgo: m.startedMonthsAgo } : {}),
    })),
  };

  if (draft.ageOrDob.mode === 'age') applicant.age = Math.round(intOf(draft.ageOrDob.age)!);
  else applicant.dob = draft.ageOrDob.dob;

  if (draft.coverage.mode === 'face') applicant.face = Math.round(intOf(draft.coverage.face)!);
  else applicant.budget = intOf(draft.coverage.budget)!;

  const weight = intOf(draft.weightLb);
  const height = heightInches(draft);
  if (
    weight !== null &&
    height !== null &&
    weight >= 70 &&
    weight <= 600 &&
    height >= 48 &&
    height <= 90
  ) {
    applicant.heightIn = height;
    applicant.weightLb = Math.round(weight);
  }

  if (draft.activityCredit) applicant.activityCredit = true;
  if (draft.aetnaMedSupp) applicant.aetnaMedSupp = true;
  return applicant;
}
