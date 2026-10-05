/**
 * What the quoting screens need besides the engine: the answer buckets agents
 * pick from, the condition shortcuts and synonyms, the follow-up questions a
 * condition asks, and the display labels for statuses. Data only, no bundle --
 * safe to import in the browser.
 *
 * Every bucket value is in MONTHS BEFORE THE QUOTE DATE, which is what the
 * engine reads. `undefined` means "not sure" (the engine assumes, and says so);
 * `null` on the treatment scale means "never treated".
 */

import type { PaymentMode } from './types.js';

export type Bucket = readonly [label: string, months: number | undefined | null];

/** "When was it diagnosed / when did it happen?" */
export const DIAGNOSED_BUCKETS: readonly Bucket[] = [
  ['Not sure', undefined],
  ['Within 30 days', 0.5],
  ['1–3 months ago', 2],
  ['3–6 months ago', 4.5],
  ['6–12 months ago', 9],
  ['1–2 years ago', 18],
  ['2–3 years ago', 30],
  ['3–4 years ago', 42],
  ['4–5 years ago', 54],
  ['5–10 years ago', 90],
  ['10+ years ago', 150],
];

/**
 * "When was it last treated?" -- last surgery, procedure, hospital stay or
 * treatment change. 0 = currently being treated or on medication for it.
 */
export const TREATED_BUCKETS: readonly Bucket[] = [
  ['Not sure', undefined],
  ['Currently (treatment or meds)', 0],
  ['Within 30 days', 0.5],
  ['1–3 months ago', 2],
  ['3–6 months ago', 4.5],
  ['6–12 months ago', 9],
  ['1–2 years ago', 18],
  ['2–3 years ago', 30],
  ['3–4 years ago', 42],
  ['4–5 years ago', 54],
  ['5–10 years ago', 90],
  ['10+ years ago', 150],
  ['Never treated', null],
];

/** "Still taking it?" for a medication (`lastTakenMonthsAgo`). */
export const MED_LAST_TAKEN_BUCKETS: readonly Bucket[] = [
  ['Currently taking', 0],
  ['Stopped 1–6 months ago', 3],
  ['Stopped 6–12 months ago', 9],
  ['Stopped 1–2 years ago', 18],
  ['Stopped 2–3 years ago', 30],
  ['Stopped 3–5 years ago', 48],
  ['Stopped 5+ years ago', 90],
];

/**
 * The knockout questions, as one-tap chips above the condition search, in
 * this order. These are the answers that decide most final expense cases.
 */
export const QUICK_CONDITIONS: readonly string[] = [
  'NURSING_FACILITY',
  'OXYGEN',
  'WHEELCHAIR',
  'ADL_ASSIST',
  'KIDNEY_DIALYSIS',
  'TERMINAL_ILLNESS',
  'HOSPICE',
  'ALZHEIMERS_DEMENTIA',
  'CHF',
  'COPD',
  'CANCER',
  'STROKE',
  'HEART_ATTACK',
  'DIABETES',
  'DIABETES_INSULIN',
  'HIV_AIDS',
  'POA_REQUIRED',
];

/** Words agents and prospects actually say, searched alongside each condition's label. */
export const CONDITION_SYNONYMS: Readonly<Record<string, string>> = {
  CHF: 'heart failure congestive',
  COPD: 'copd lung emphysema bronchitis',
  DIABETES: 'sugar diabetic type 2 type ii',
  DIABETES_INSULIN: 'insulin shots diabetes',
  HYPERTENSION: 'blood pressure bp hbp',
  HEART_ATTACK: 'mi heart attack',
  AFIB: 'afib a-fib atrial fibrillation irregular',
  STROKE: 'cva stroke',
  KIDNEY_DIALYSIS: 'dialysis esrd renal',
  CHRONIC_KIDNEY_DISEASE: 'ckd kidney renal insufficiency',
  ALZHEIMERS_DEMENTIA: 'alzheimers dementia memory',
  NURSING_FACILITY: 'nursing home assisted living',
  OXYGEN: 'oxygen o2',
  WHEELCHAIR: 'wheelchair scooter',
  ADL_ASSIST: 'adl bathing dressing help',
  HIV_AIDS: 'hiv aids',
  CANCER: 'cancer tumor malignancy chemo',
  POA_REQUIRED: 'power of attorney poa',
  TIA: 'mini stroke tia',
  CAD: 'heart disease coronary',
  ANGIOPLASTY_STENT: 'stent angioplasty',
  HEART_SURGERY: 'bypass cabg open heart valve',
  DUI: 'dui dwi',
  FELONY: 'felony jail prison conviction',
};

export type DetailField =
  | {
      key: string;
      label: string;
      type: 'select';
      options: ReadonlyArray<readonly [value: string, label: string]>;
    }
  | { key: string; label: string; type: 'yesno' | 'number' }
  /** A DIAGNOSED_BUCKETS-style "how long ago" picker, stored in months. */
  | { key: string; label: string; type: 'bucket' };

/**
 * Follow-up questions a condition asks once it is added. The answers go into
 * the condition's `detail` under `key`. Left blank, the engine does not apply
 * the rules that need them and lists that as an assumption.
 */
export const CONDITION_DETAIL_FIELDS: Readonly<Record<string, readonly DetailField[]>> = {
  CANCER: [
    {
      key: 'cancer_type',
      label: 'Cancer type',
      type: 'select',
      options: [
        ['', 'Not sure'],
        ['solid', 'Solid tumor (breast, prostate, colon, lung…)'],
        ['multiple_myeloma', 'Multiple myeloma'],
        ['leukemia', 'Leukemia'],
        ['lymphoma', 'Lymphoma'],
        ['blood', 'Other blood cancer'],
        ['bone_marrow', 'Bone marrow cancer'],
      ],
    },
  ],
  ANEURYSM: [
    {
      key: 'location',
      label: 'Location',
      type: 'select',
      options: [
        ['', 'Not sure'],
        ['brain', 'Brain'],
        ['aortic', 'Aortic'],
        ['other', 'Other'],
      ],
    },
    { key: 'surgically_corrected', label: 'Surgically repaired?', type: 'yesno' },
  ],
  SARCOIDOSIS: [
    {
      key: 'stage',
      label: 'Stage',
      type: 'select',
      options: [
        ['', 'Not sure'],
        ['1', '1'],
        ['2', '2'],
        ['3', '3'],
        ['4', '4'],
      ],
    },
  ],
  SEIZURES: [{ key: 'last_episode_months_ago', label: 'Last seizure', type: 'bucket' }],
  STROKE: [{ key: 'complications', label: 'Lasting complications?', type: 'yesno' }],
  TIA: [{ key: 'complications', label: 'Lasting complications?', type: 'yesno' }],
  HEART_ATTACK: [{ key: 'complications', label: 'Complications?', type: 'yesno' }],
  AMPUTATION_ACCIDENT: [{ key: 'complications', label: 'Complications?', type: 'yesno' }],
  PARALYSIS: [
    {
      key: 'paralysis_type',
      label: 'Type',
      type: 'select',
      options: [
        ['', 'Not sure'],
        ['paraplegia', 'Paraplegia'],
        ['quadriplegia', 'Quadriplegia'],
        ['hemiplegia', 'Hemiplegia'],
      ],
    },
  ],
  DUI: [{ key: 'count', label: 'How many', type: 'number' }],
  FELONY: [{ key: 'count', label: 'How many', type: 'number' }],
  RECKLESS_DRIVING: [{ key: 'count', label: 'How many', type: 'number' }],
  HOSPITALIZED_MULTIPLE: [{ key: 'count', label: 'Number of stays', type: 'number' }],
  HOSPITAL_DAYS: [{ key: 'count', label: 'Total days', type: 'number' }],
  DIABETES_INSULIN: [{ key: 'insulin_units_daily', label: 'Units per day', type: 'number' }],
};

export const BENEFIT_LABEL: Readonly<Record<string, string>> = {
  LEVEL: 'Level',
  GRADED: 'Graded',
  MODIFIED: 'Modified',
  ROP: 'Return of premium',
  GI: 'Guaranteed issue',
  UNKNOWN: 'Benefit n/a',
};

export type Tone = 'good' | 'warn' | 'mod' | 'bad' | 'neutral';

/** How current a product's rates are, for the carrier data view. */
export const RATES_STATUS_LABEL: Readonly<Record<string, readonly [label: string, tone: Tone]>> = {
  CURRENT_2026: ['2026 source', 'good'],
  CURRENT_VALIDATED_2026: ['2026 live-validated', 'good'],
  CURRENT_PRODUCT_2026: ['Current product', 'good'],
  CURRENT_PRODUCT_2026_PORTAL_GATED: ['Current · portal gated', 'warn'],
  CURRENT_PRODUCT_FAMILY_2026: ['Current product family', 'good'],
  CURRENT_CARRIER_GUIDE_ACTIVE_2026: ['Current carrier rate guide', 'good'],
  VERIFY_2026: ['Verify rates', 'warn'],
  STALE_VERIFY: ['Older rate book', 'mod'],
  HISTORICAL_ONLY: ['Historical only', 'mod'],
  CURRENT_PRODUCT_NO_RATES: ['Current product · rates needed', 'warn'],
  HISTORICAL_REPLACED: ['Historical / replaced', 'mod'],
  DISCONTINUED_NEW_BUSINESS: ['Discontinued', 'bad'],
};

/** Where a product's health rules came from, for the carrier data view. */
export const UW_STATUS_LABEL: Readonly<Record<string, string>> = {
  CURRENT_CARRIER_2026: 'Carrier guide 2026',
  CURRENT_CARRIER_GUIDE: 'Carrier guide',
  CURRENT_PUBLIC_GUIDE: 'Carrier guide (public)',
  THIRD_PARTY_VERBATIM_CROSSCHECKED: 'Application (verified copy)',
  THIRD_PARTY_SINGLE_SOURCE: 'Application (single copy)',
  HISTORICAL_FORM_VERIFY: 'Older form',
  NO_UW_CONTENT: 'No health rules loaded',
  CURRENT_PRODUCT_EXACT_Q_PENDING: 'Questions pending',
  CURRENT_CARRIER_NO_HEALTH_QUESTIONS: 'No health questions · carrier confirmed',
  CURRENT_CARRIER_GUIDE_RX_PENDING: 'Current guide · Rx/eApp pending',
  CURRENT_PROCESS_PRODUCT_RULES_PENDING: 'Current process · product rules pending',
  CURRENT_2026_GUIDE_RATES_PENDING: 'Current 2026 guide · rates pending',
  CURRENT_2026_CARRIER_UW_RX_LOADED_RATES_PENDING: 'Current 2026 UW + Rx · rates pending',
  CURRENT_ROUTING_LEGACY_FORM_QUESTIONS: 'Routing current · form wording verify',
  PARTIAL_HARD_DECLINES_CLASS_ROUTING_PENDING: 'Hard declines loaded · class routing pending',
  VERIFY_2026: 'Carrier guide (verify)',
  WORKBOOK_TRANSCRIPTION_VERIFY: 'Paraphrased questions',
  CURRENT_PRODUCT_APP_ROUTING_RX_PENDING: 'Application loaded · Rx verify',
};

export const PAYMENT_MODES: ReadonlyArray<readonly [PaymentMode, string]> = [
  ['monthly', 'Monthly bank draft'],
  ['quarterly', 'Quarterly'],
  ['semiannual', 'Semi-annual'],
  ['annual', 'Annual'],
];

/** Face amount presets; any amount may also be typed. */
export const FACE_PRESETS: readonly number[] = [5000, 7500, 10000, 15000, 20000, 25000];

export const STATES: readonly string[] = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'DC',
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
];
