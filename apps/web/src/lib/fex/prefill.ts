/**
 * What the call already knows, turned into a quote.
 *
 * Lead data arrives from four places in four shapes -- the CRM customer
 * lookup, the softphone's `prospectData`, the prospect matched by phone, and
 * free-form `customFields` from whatever vendor sold the lead -- so every
 * value is parsed leniently here: "Florida" and "FL", "05/14/1958" and
 * "1958-05-14", "$10,000" and "10k", `5'6"` and "66".
 *
 * The first source with a usable value wins, in the order listed per field.
 * A value that does not parse is skipped rather than guessed.
 *
 * Health conditions and medications are NEVER prefilled. A lead vendor's
 * "health: good" is not an underwriting answer, and the agent must ask.
 */

import { STATES } from '@hopwhistle/fex-engine/catalog';

import { US_STATES } from '@/lib/us-states';

import type { QuoteDraft, QuoteDraftField } from './draft';

type Bag = Record<string, unknown>;

export interface ProspectSources {
  /** The CRM customer-lookup record (`fetchCustomerLookup(phone).customer`). */
  customer?: Bag | null;
  /** The softphone's / console's prospect data for the call. */
  prospectData?: Bag | null;
  /** The saved prospect the softphone matched by phone. */
  matchedProspect?: Bag | null;
}

export interface ProspectPrefill {
  draft: Partial<QuoteDraft>;
  fields: Set<QuoteDraftField>;
  /** For the saved quote: full name, or first + last. */
  prospectName: string | null;
}

const isBag = (v: unknown): v is Bag => !!v && typeof v === 'object' && !Array.isArray(v);

const text = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};

const NAME_TO_CODE = new Map<string, string>([
  ...US_STATES.map(s => [s.label.toLowerCase(), s.value] as [string, string]),
  ['district of columbia', 'DC'],
  ['washington dc', 'DC'],
  ['washington d.c.', 'DC'],
]);

/** "FL", "fl", "Florida" → "FL"; anything else → null. */
export function parseState(raw: unknown): string | null {
  const t = text(raw);
  if (!t) return null;
  const upper = t.toUpperCase().replace(/\./g, '');
  if (upper.length === 2 && STATES.includes(upper)) return upper;
  return NAME_TO_CODE.get(t.toLowerCase().replace(/\s+/g, ' ')) ?? null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "MM/DD/YYYY" or "YYYY-MM-DD" (or an ISO timestamp) → "YYYY-MM-DD"; else null. */
export function parseDob(raw: unknown): string | null {
  const t = text(raw);
  if (!t) return null;
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(t);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
    if (!match) return null;
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  if (y < 1900 || date.getTime() > Date.now()) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** A whole-number age 18–100, or null. */
export function parseAge(raw: unknown): number | null {
  const t = text(raw);
  if (!t || !/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 18 && n <= 100 ? n : null;
}

/** M, F, male, female (any case) → 'M' | 'F'; else null. */
export function parseSex(raw: unknown): 'M' | 'F' | null {
  const t = text(raw)?.toLowerCase();
  if (t === 'm' || t === 'male') return 'M';
  if (t === 'f' || t === 'female') return 'F';
  return null;
}

/** yes/y/true/smoker/1 → true; no/n/false/non-smoker/0 → false; else null. */
export function parseTobacco(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw;
  const t = text(raw)
    ?.toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (!t) return null;
  if (['yes', 'y', 'true', 'smoker', '1', 'tobacco'].includes(t)) return true;
  if (['no', 'n', 'false', 'non-smoker', 'nonsmoker', '0', 'non-tobacco'].includes(t)) return false;
  return null;
}

/** "$10,000", "10k", 10000 → 10000, when it is 1,000–500,000; else null. */
export function parseFace(raw: unknown): number | null {
  const t = text(raw)
    ?.toLowerCase()
    .replace(/[$,\s]/g, '');
  if (!t) return null;
  const match = /^(\d+(?:\.\d+)?)(k)?$/.exec(t);
  if (!match) return null;
  const n = Number(match[1]) * (match[2] ? 1000 : 1);
  return n >= 1000 && n <= 500000 ? Math.round(n) : null;
}

/** `5'6"`, `5'6`, `5-6`, `5 ft 6 in`, `66` → total inches 48–90; else null. */
export function parseHeight(raw: unknown): number | null {
  const t = text(raw)?.toLowerCase();
  if (!t) return null;
  let inches: number | null = null;
  const plain = /^(\d{2})(?:\s*(?:in|inches|"))?$/.exec(t);
  const feet = /^(\d)\s*(?:'|ft|feet|-|’)\s*(?:(\d{1,2})\s*(?:"|''|in|inches|”)?)?$/.exec(t);
  if (plain) inches = Number(plain[1]);
  else if (feet) inches = Number(feet[1]) * 12 + Number(feet[2] ?? 0);
  return inches !== null && inches >= 48 && inches <= 90 ? inches : null;
}

/** A weight in pounds 70–600, or null. */
export function parseWeight(raw: unknown): number | null {
  const t = text(raw)
    ?.toLowerCase()
    .replace(/\s*(lbs?|pounds)$/, '');
  if (!t || !/^\d{2,3}(\.\d+)?$/.test(t)) return null;
  const n = Math.round(Number(t));
  return n >= 70 && n <= 600 ? n : null;
}

function firstOf<T>(values: unknown[], parse: (v: unknown) => T | null): T | null {
  for (const value of values) {
    const parsed = parse(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function prefillFromProspect(sources: ProspectSources): ProspectPrefill {
  const customer = isBag(sources.customer) ? sources.customer : {};
  const prospect = isBag(sources.prospectData) ? sources.prospectData : {};
  const matched = isBag(sources.matchedProspect) ? sources.matchedProspect : {};
  const insurance = isBag(customer.insurance) ? customer.insurance : {};
  const custom: Bag = {
    ...(isBag(customer.customFields) ? customer.customFields : {}),
    ...(isBag(prospect.customFields) ? prospect.customFields : {}),
  };

  const draft: Partial<QuoteDraft> = {};
  const fields = new Set<QuoteDraftField>();

  const state = firstOf([customer.state, prospect.state, matched.state], parseState);
  if (state) {
    draft.state = state;
    fields.add('state');
  }

  const dob = firstOf(
    [
      customer.birthDate,
      prospect.dob,
      custom.dob,
      custom.date_of_birth,
      custom.birthDate,
      custom.birth_date,
    ],
    parseDob
  );
  if (dob) {
    draft.ageOrDob = { mode: 'dob', dob };
    fields.add('dob');
  } else {
    const age = firstOf([customer.age, prospect.age], parseAge);
    if (age !== null) {
      draft.ageOrDob = { mode: 'age', age: String(age) };
      fields.add('age');
    }
  }

  const sex = firstOf(
    [customer.gender, customer.sex, prospect.gender, prospect.sex, custom.gender, custom.sex],
    parseSex
  );
  if (sex) {
    draft.sex = sex;
    fields.add('sex');
  }

  const tobacco = firstOf(
    [insurance.smoker, prospect.tobacco, custom.smoker, custom.tobacco],
    parseTobacco
  );
  if (tobacco !== null) {
    draft.tobacco = tobacco;
    fields.add('tobacco');
  }

  const face = firstOf(
    [insurance.faceAmount, insurance.coverageAmount, prospect.faceAmount],
    parseFace
  );
  if (face !== null) {
    draft.coverage = { mode: 'face', face: String(face) };
    fields.add('face');
  }

  const height = firstOf([prospect.height, custom.height], parseHeight);
  if (height !== null) {
    draft.heightFt = String(Math.floor(height / 12));
    draft.heightIn = String(height % 12);
    fields.add('height');
  }

  const weight = firstOf([prospect.weight, custom.weight], parseWeight);
  if (weight !== null) {
    draft.weightLb = String(weight);
    fields.add('weight');
  }

  const nameOf = (bag: Bag): string | null =>
    text(bag.fullName) ??
    ([text(bag.firstName) ?? text(bag.first_name), text(bag.lastName) ?? text(bag.last_name)]
      .filter(Boolean)
      .join(' ') ||
      null);
  const prospectName = nameOf(customer) ?? nameOf(prospect) ?? nameOf(matched);

  return { draft, fields, prospectName };
}
