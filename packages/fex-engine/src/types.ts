/**
 * Types for the FEX quote engine: the data bundle it reads, the applicant it
 * is asked about, and the answer it gives.
 *
 * The bundle is data, not code. Every eligibility decision comes from a record
 * in it -- an application question, an underwriting-guide rule, an Rx entry, a
 * build-chart row, a state rule -- and every premium from a carrier rate table.
 * The engine never infers a decision on its own.
 */

// ─── Shared vocabulary ──────────────────────────────────────────────────────

/** A plan class code such as "PREFERRED", "GRADED", "IMMEDIATE", or one of the two sentinels. */
export type Outcome = string;
export const DECLINE = 'DECLINE' as const;
export const REFER = 'REFER' as const;

export type Sex = 'M' | 'F';
export type PaymentMode = 'monthly' | 'quarterly' | 'semiannual' | 'annual';
export type AgeBasis = 'ALB' | 'ANB' | 'UNKNOWN' | string;

export type RateBasis =
  | 'ANNUAL_PER_1000'
  | 'MONTHLY_PER_1000'
  | 'MONTHLY_PREMIUM_BY_FACE'
  | 'SINGLE_PREMIUM_PER_1000'
  | string;

export type Benefit = 'LEVEL' | 'GRADED' | 'MODIFIED' | 'ROP' | 'GI' | 'UNKNOWN' | string;

// ─── Time windows on rules ──────────────────────────────────────────────────

export type WindowBasis = 'diagnosed' | 'treated' | 'any';

export type RuleWindow =
  | { kind: 'ever' }
  | { kind: 'current' }
  | { kind: 'within'; months: number; basis?: WindowBasis }
  | { kind: 'beyond'; months: number; basis?: WindowBasis };

/**
 * Extra criteria on a trigger. Keys the engine evaluates:
 * current_age_gte, current_age_lt, age_at_diagnosis_lt, age_at_diagnosis_gte,
 * count_gte, cancer_type_in, cancer_type_not_in, location_in, paralysis_type_in,
 * stage_gte, with_complications, surgically_corrected, never_treated,
 * untreated, last_episode_months_ago_lte, last_episode_months_ago_gt,
 * also_has_any, insulin_units_daily_gt. Any other key is reported as an
 * assumption ("criterion not evaluated") and treated as satisfied.
 */
export type RuleExtra = Record<string, unknown>;

export interface RuleTrigger {
  codes: string[];
  window: RuleWindow;
  extra?: RuleExtra | null;
}

export interface UwRule {
  id: string;
  kind: string;
  ref: string | null;
  text: string;
  outcome: Outcome;
  triggers: RuleTrigger[];
  page: number | string | null;
  url: string | null;
  note: string | null;
  factorType: string | null;
  group: string | null;
  /** The outcome when the applicant earns the activity credit (Transamerica). */
  acOutcome: Outcome | null;
  src: 'application' | 'guide' | string | null;
}

export interface RxEntry {
  /** The name as the carrier prints it. */
  drug: string;
  outcome: Outcome;
  /** Condition codes the carrier lists this drug for. */
  ind: string[];
  /** True when the outcome depends on what the drug is taken for. */
  dep: boolean;
  indText: string | null;
  page: number | string | null;
  note: string | null;
  window?: RuleWindow | null;
  extra?: RuleExtra | null;
}

export interface BuildRow {
  height_in: number;
  height_label?: string;
  min_lb?: number;
  min_lb_by_class?: Record<string, number | null>;
  max_lb_by_class: Record<string, number | null>;
  outcome_override?: Outcome;
  note?: string;
  [key: string]: unknown;
}

export interface BuildChart {
  source_page?: number | string | null;
  source_url?: string | null;
  unit?: string;
  rows: BuildRow[];
  over_max_outcome?: Outcome;
  under_min_outcome?: Outcome;
  height_outside_chart_outcome?: Outcome;
  applies_ages?: [number, number];
  activity_credit_upgrade?: { from: Outcome; to: Outcome };
  [key: string]: unknown;
}

export interface ComboLogic {
  all?: ComboLogic[];
  count_distinct_condition_groups?: {
    factor_type?: string;
    outcome_in?: Outcome[];
    group_prefix?: string;
  };
  gte?: number;
  build_class_after_activity_credit?: Outcome;
}

export interface ComboRule {
  id: string;
  text: string;
  outcome: Outcome;
  logic: ComboLogic;
  page?: number | string | null;
  ages?: [number, number];
}

export interface ProductUw {
  /** The class an applicant with no hits receives. */
  noHits: Outcome | null;
  rules: UwRule[];
  build: BuildChart | null;
  /** Rx entries keyed by normalized drug ingredient id (or class id). */
  rx: Record<string, RxEntry[]>;
  combos: ComboRule[];
  tobacco: unknown;
  sources: Array<{ file?: string; [key: string]: unknown }>;
  routingText: unknown;
  droppedRules: unknown;
}

// ─── Products, classes, rate tables ─────────────────────────────────────────

export interface FaceByAge {
  ages: [number, number];
  max?: number | null;
  min?: number | null;
}

export interface PlanClass {
  code: string;
  label: string;
  /** The underwriting class this plan class is written for. */
  uwClass: Outcome;
  benefit: Benefit;
  /** Death-benefit description as the carrier prints it. */
  db: string | null;
  tobaccoDistinct: boolean;
  ages: { N?: [number, number]; T?: [number, number] };
  faceMin: number | null;
  faceMax: number | null;
  faceByAge: FaceByAge[] | null;
  /** When set, the only faces offered. */
  faces: number[] | null;
  /** Key into `bundle.tables`. */
  table: string;
  payPeriod: string | null;
  fee: number | null;
}

export interface FeeByFace {
  face_lt?: number;
  face_gte?: number;
  fee_annual: number;
}

export interface StateRules {
  /** States where female applicants are priced on male rates. */
  unisexMaleStates?: string[];
  /** Class code or uwClass → states where that class is not sold. */
  classUnavailable?: Record<string, string[]>;
  /** Class code or uwClass → state → max issue age. */
  classMaxAgeByState?: Record<string, Record<string, number>>;
  faceMinByState?: Record<string, number>;
  /** state → outcome → remapped outcome. */
  outcomeRemap?: Record<string, Record<string, { to: Outcome; text: string }>>;
}

export interface RoutingTarget {
  product_id: string;
  plan_class: string;
}

export interface TobaccoRxRule {
  drug: string;
  label: string;
  window: RuleWindow;
  page: number | string | null;
}

export interface AgeOutcomeRule {
  gte?: number | null;
  lte?: number | null;
  outcome: Outcome;
  text?: string;
}

export interface Product {
  id: string;
  carrier: string;
  family: string;
  product: string;
  type: string;
  status: string;
  ratesStatus: string;
  uwStatus: string;
  uwLoaded: boolean;
  ageBasis: AgeBasis;
  fee: number | null;
  feeByFace: FeeByFace[] | null;
  modal: Partial<Record<PaymentMode, number | null>>;
  monthlyLabel: string | null;
  annualFirstYearFactor: number | null;
  tobaccoRx: TobaccoRxRule[] | null;
  minModal: number | null;
  faceIncrement: number | null;
  classes: PlanClass[];
  /** Best first. */
  classOrder: Outcome[];
  stateUnavailable: string[];
  stateUnavailableByClass: Record<string, string[]>;
  stateNotes: string[];
  notes: string[];
  source: { effective_or_doc_date?: string; [key: string]: unknown } | null;
  routing: Record<string, RoutingTarget[]> | null;
  uw: ProductUw;
  /** False = retained for audit/reference; never ranked in a live quote. */
  quotable: boolean;
  alerts: string[];
  stateRules: StateRules | null;

  // Product-specific switches (present on a few products only)
  superPreferredRequiresAetnaMedSupp?: boolean;
  superPreferredText?: string;
  rxVerificationPending?: boolean;
  tobaccoRespiratoryDeclineMonths?: number;
  respiratoryTobaccoCodes?: string[];
  tobaccoCombinationText?: string;
  tobaccoCombinationRef?: string;
  /** False: a medication alone does not make a condition "currently treated". */
  medsCountAsTreatment?: boolean;
  ageOutcomeRules?: AgeOutcomeRule[];
  hardDeclinesLoadedWhileClassRoutingPending?: boolean;
  blockerAccessStatus?: string;
  [key: string]: unknown;
}

export interface RateBand {
  band: string;
  min: number;
  max: number;
}

export interface RateTable {
  basis: RateBasis;
  includesFee: boolean;
  bands: RateBand[] | null;
  /**
   * Keyed "SEX|TOBACCO|BAND" ("U" = unisex / any). Each value maps issue age
   * to a rate per $1,000, or -- for MONTHLY_PREMIUM_BY_FACE -- to a face→premium map.
   */
  data: Record<string, Record<string, number | Record<string, number>>>;
}

// ─── Conditions and drugs ───────────────────────────────────────────────────

export interface Condition {
  code: string;
  label: string;
  category: string;
  /** True: a code added during normalization rather than printed by a carrier. */
  proposed: boolean;
}

export interface DrugIngredient {
  id: string;
  generic: string;
  brands?: string[];
  aliases?: string[];
  drug_class: string | null;
  common_indications?: string[];
  multi_use: boolean;
  member_of?: string[];
  components?: string[];
  kind?: 'class' | 'group' | string;
  members?: string[];
  related?: string[];
  note?: string;
}

export interface FexBundle {
  meta: { built: string; products: number; tables: number; conditions: number; drugs: number };
  conditions: Condition[];
  detailKeys: Record<string, string[]>;
  products: Product[];
  tables: Record<string, RateTable>;
  drugs: {
    ingredients: DrugIngredient[];
    /** Lower-cased brand / generic / alias / misspelling → ingredient id. */
    nameIndex: Record<string, string>;
  };
  [key: string]: unknown;
}

// ─── The applicant ──────────────────────────────────────────────────────────

/** Detail answers for a condition (cancer type, stage, complications, counts…). */
export type ConditionDetail = Record<string, string | number | boolean | undefined>;

export interface ApplicantCondition {
  code: string;
  /** Months before the quote date. Undefined = not sure. */
  diagnosedMonthsAgo?: number;
  /** 0 = currently treated / on meds; null = never treated; undefined = not sure. */
  treatedMonthsAgo?: number | null;
  /** Ticked separately: on maintenance medication for this condition. */
  onMeds?: boolean;
  detail?: ConditionDetail;
}

export interface ApplicantMed {
  /** Ingredient id from `DrugIndex.resolve` / `search`. */
  drugId: string;
  /** What the agent typed or picked (brand or generic). */
  name?: string;
  /** Condition code the drug is taken for, when the agent confirmed it. */
  indication?: string;
  startedMonthsAgo?: number;
  /** 0 or undefined = currently taking. */
  lastTakenMonthsAgo?: number;
}

export interface Applicant {
  /** Two-letter state, incl. DC. */
  state: string;
  sex: Sex;
  tobacco: boolean;
  /** Age, when no DOB is given. */
  age?: number;
  /** YYYY-MM-DD. When given, the age is computed per the carrier's age basis. */
  dob?: string;
  /** YYYY-MM-DD. Defaults to today. Pass it explicitly for reproducible quotes. */
  quoteDate?: string;
  heightIn?: number;
  weightLb?: number;
  /** Face amount. Either face or budget. */
  face?: number;
  /** Modal premium budget: the engine finds the largest face that fits. */
  budget?: number;
  mode?: PaymentMode;
  /** Exercises 3+ days a week (Transamerica activity credit). */
  activityCredit?: boolean;
  /** Has a qualifying Aetna/CVS Medicare Supplement (Accendo Super Preferred). */
  aetnaMedSupp?: boolean;
  conditions: ApplicantCondition[];
  meds: ApplicantMed[];
}

export interface QuoteOptions {
  mode?: PaymentMode;
  /** Also evaluate products with `quotable: false` (reference / audit view). */
  includeUnquotable?: boolean;
  /**
   * Agent-facing reason text. An Rx entry's `note` is research provenance
   * ("VERIFIED_FROM_CARRIER_GUIDE…", "mapped to BLOOD_CLOTS") as often as it is
   * carrier wording. By default it is appended to the reason text in
   * parentheses, exactly as v18 did. With `agentText: true` the text stops at
   * the carrier's indication and the note moves to `Reason.note`, for a
   * "source note" disclosure. `ineligibleReason`, which quotes the deciding
   * reason, follows. Nothing else changes.
   */
  agentText?: boolean;
  /**
   * Price a monthly quote even where the carrier publishes no monthly factor,
   * at `ESTIMATED_MONTHLY_FACTOR` of the annual premium, with a note saying
   * so. Off by default, which is exactly v18: no monthly premium, the annual
   * one only. Agents quote and sell monthly, so the app turns this on.
   */
  estimateMonthly?: boolean;
}

// ─── The answer ─────────────────────────────────────────────────────────────

export type ReasonKind = 'rule' | 'rx' | 'build' | 'combo' | 'state' | 'routing' | 'age';

export interface Reason {
  kind: ReasonKind;
  outcome: Outcome;
  text: string;
  ref?: string | null;
  page?: number | string | null;
  url?: string | null;
  ruleId?: string;
  assumed?: string[];
  src?: string | null;
  /** Only with `QuoteOptions.agentText`: the Rx entry's research / carrier note. */
  note?: string | null;
}

export interface QuoteLine {
  classCode: string;
  classLabel: string;
  uwClass: Outcome;
  benefit: Benefit;
  db: string | null;
  face: number;
  /** Modal premium in the requested mode; null when the carrier publishes no factor for it. */
  premium: number | null;
  annual: number | null;
  mode: PaymentMode;
  modeLabel: string;
  basis: RateBasis;
  /** Why the face differs from what was asked (capped, minimum, nearest published face). */
  faceAdjusted: string | null;
  premiumNote: string | null;
  payPeriod: string | null;
}

export interface NeedsIndication {
  drugId: string;
  name: string;
  /** Condition codes to offer the agent. */
  options: string[];
}

export interface ProductResult {
  productId: string;
  carrier: string;
  family: string;
  product: string;
  type: string;
  status: string;
  ratesStatus: string;
  uwStatus: string;
  uwLoaded: boolean;
  alerts: string[];
  age: number;
  ageBasis: AgeBasis;
  eligible: boolean;
  /** The underwriting class decided, DECLINE, or null when health rules are not loaded. */
  outcome: Outcome | null;
  outcomeLabel: string;
  best: QuoteLine | null;
  /** Other classes / pay periods this applicant qualifies for, best first. */
  others: QuoteLine[];
  /** Why, worst outcome first, with page citations. */
  reasons: Reason[];
  /** Medications whose use must be confirmed before the result is final. */
  needsIndication: NeedsIndication[];
  /** Everything the engine had to assume because an answer was missing. */
  assumptions: string[];
  /** The carrier will refer this case to its home office / Rx check. */
  refer: boolean;
  ineligibleReason?: string;
  /** The result is written on another product (e.g. Immediate → Easy Solution). */
  routedTo?: string | null;
}
