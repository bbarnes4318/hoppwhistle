/**
 * The FEX underwriting + pricing engine.
 *
 * For each carrier product it decides the plan class the applicant gets --
 * from that carrier's own application questions, underwriting-guide rules, Rx
 * list, build chart and state rules -- then prices every class the applicant
 * qualifies for from the carrier's rate table, and says why, with page
 * citations. Pure and deterministic: no I/O, no clock except "today" when an
 * applicant has a DOB and no quoteDate.
 *
 * Ported line-for-line from the v18 single-file quoter. `test/golden.v18.json`
 * holds that build's answers for 4,000 applicants; the port must reproduce
 * every one of them exactly.
 */

import { DrugIndex, IMPLIES } from './drug-index.js';
import {
  DECLINE,
  REFER,
  type Applicant,
  type ApplicantCondition,
  type ComboLogic,
  type FexBundle,
  type Outcome,
  type PaymentMode,
  type PlanClass,
  type Product,
  type ProductResult,
  type QuoteLine,
  type QuoteOptions,
  type RateBasis,
  type Reason,
  type RuleExtra,
  type RuleTrigger,
  type RuleWindow,
  type UwRule,
  type WindowBasis,
} from './types.js';

export const MODE_LABEL: Record<PaymentMode, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannual: 'Semi-annual',
  annual: 'Annual',
};

// ─── Age ────────────────────────────────────────────────────────────────────

function parseDate(value: string | undefined): Date {
  if (!value) return new Date();
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

/** Age last birthday and age nearest birthday on the quote date. */
export function agesOn(dob: string, quoteDate?: string): { alb: number; anb: number } {
  const birth = parseDate(dob);
  const on = parseDate(quoteDate);
  let alb = on.getUTCFullYear() - birth.getUTCFullYear();
  const hadBirthday =
    on.getUTCMonth() > birth.getUTCMonth() ||
    (on.getUTCMonth() === birth.getUTCMonth() && on.getUTCDate() >= birth.getUTCDate());
  if (!hadBirthday) alb -= 1;
  const last = new Date(
    Date.UTC(birth.getUTCFullYear() + alb, birth.getUTCMonth(), birth.getUTCDate())
  );
  const next = new Date(
    Date.UTC(birth.getUTCFullYear() + alb + 1, birth.getUTCMonth(), birth.getUTCDate())
  );
  const anb =
    (on.getTime() - last.getTime()) / (next.getTime() - last.getTime()) >= 0.5 ? alb + 1 : alb;
  return { alb, anb };
}

function issueAge(applicant: Applicant, product: Product): { age: number; note?: string } {
  if (!applicant.dob) return { age: applicant.age ?? 0 };
  const { alb, anb } = agesOn(applicant.dob, applicant.quoteDate);
  if (product.ageBasis === 'ANB') return { age: anb };
  if (product.ageBasis === 'ALB') return { age: alb };
  return {
    age: alb,
    note:
      alb !== anb
        ? `Age basis not published by carrier — quoted at age last birthday ${alb} (nearest would be ${anb})`
        : undefined,
  };
}

// ─── Facts: what the applicant has, after implications ──────────────────────

interface Fact {
  code: string;
  diagnosedMonthsAgo?: number;
  treatedMonthsAgo?: number | null;
  onMeds?: boolean;
  detail?: ApplicantCondition['detail'];
  fromMed?: string;
  implied?: string;
}

type Facts = Map<string, Fact[]>;

function buildFacts(applicant: Applicant, drugs: DrugIndex | undefined): Facts {
  const facts: Facts = new Map();
  const add = (fact: Fact): void => {
    const list = facts.get(fact.code) ?? [];
    list.push(fact);
    facts.set(fact.code, list);
  };

  for (const condition of applicant.conditions) add({ ...condition, onMeds: condition.onMeds });

  for (const med of applicant.meds) {
    const current = (med.lastTakenMonthsAgo ?? 0) === 0;
    if (med.indication && facts.has(med.indication) && current) {
      for (const fact of facts.get(med.indication)!) fact.onMeds = true;
    }
    // A confirmed use the agent did not list as a condition is a condition.
    if (med.indication && !facts.has(med.indication)) {
      add({
        code: med.indication,
        treatedMonthsAgo: med.lastTakenMonthsAgo ?? 0,
        diagnosedMonthsAgo: med.startedMonthsAgo,
        fromMed: med.name || med.drugId,
        implied: `taking ${med.name || med.drugId}`,
      });
    }
    // Insulin for diabetes is insulin-dependent diabetes.
    if (
      drugs &&
      drugs.isInsulin(med.drugId) &&
      (med.indication ?? 'DIABETES').startsWith('DIABET') &&
      !facts.has('DIABETES_INSULIN')
    ) {
      add({
        code: 'DIABETES_INSULIN',
        treatedMonthsAgo: med.lastTakenMonthsAgo ?? 0,
        diagnosedMonthsAgo: med.startedMonthsAgo,
        fromMed: med.name || med.drugId,
        implied: `taking ${med.name || med.drugId}`,
      });
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [code, list] of Array.from(facts.entries())) {
      for (const broader of IMPLIES[code] ?? []) {
        if (!facts.has(broader)) {
          for (const fact of list) add({ ...fact, code: broader, implied: `implied by ${code}` });
          changed = true;
        }
      }
    }
  }
  return facts;
}

/**
 * Whether being on medication counts as "currently treated". Most carriers say
 * yes; a product with `medsCountAsTreatment: false` says a med alone does not.
 */
function applyTreatmentPolicy(facts: Facts, product: Product): Facts {
  const out: Facts = new Map();
  const medsAreNotTreatment = product.medsCountAsTreatment === false;
  for (const [code, list] of facts) {
    out.set(
      code,
      list.map(fact =>
        medsAreNotTreatment
          ? fact.fromMed && fact.treatedMonthsAgo === 0
            ? { ...fact, treatedMonthsAgo: undefined }
            : fact
          : fact.onMeds && fact.treatedMonthsAgo !== 0
            ? { ...fact, treatedMonthsAgo: 0 }
            : fact
      )
    );
  }
  return out;
}

// ─── Windows and criteria ───────────────────────────────────────────────────

type Assume = (message: string) => void;

function monthsFor(fact: Fact, basis: WindowBasis | undefined): number | undefined {
  const diagnosed = fact.diagnosedMonthsAgo;
  const treated = fact.treatedMonthsAgo === null ? undefined : fact.treatedMonthsAgo;
  if (basis === 'diagnosed') return diagnosed ?? treated;
  if (basis === 'treated') return treated ?? diagnosed;
  const known = [diagnosed, treated].filter((v): v is number => typeof v === 'number');
  return known.length ? Math.min(...known) : undefined;
}

export function formatMonths(months: number): string {
  if (months < 1) return `${Math.round(months * 30)} days`;
  if (months % 12 === 0) return months === 12 ? '12 months' : `${months / 12} years`;
  return `${months} months`;
}

function windowHits(window: RuleWindow, fact: Fact, assume: Assume, label: string): boolean {
  switch (window.kind) {
    case 'ever':
      return true;
    case 'current':
      if (fact.treatedMonthsAgo === 0) return true;
      if (fact.treatedMonthsAgo === undefined && fact.diagnosedMonthsAgo === undefined) {
        assume(`${label}: current status not entered — assumed current`);
        return true;
      }
      return false;
    case 'within': {
      const months = monthsFor(fact, window.basis);
      if (months === undefined) {
        assume(`${label}: dates not entered — assumed within ${formatMonths(window.months)}`);
        return true;
      }
      return months <= window.months;
    }
    case 'beyond': {
      const months = monthsFor(fact, window.basis);
      return months === undefined ? false : months > window.months;
    }
  }
  return false;
}

interface EvalContext {
  age: number;
  facts: Facts;
  assumed: Set<string>;
}

function extraHolds(
  extra: RuleExtra | null | undefined,
  fact: Fact,
  ctx: EvalContext,
  assume: Assume,
  label: string
): boolean {
  if (!extra) return true;
  const detail = fact.detail ?? {};
  for (const [key, raw] of Object.entries(extra)) {
    // The criterion's value: a number, a list of codes, or a flag, per key.
    const value = raw as number;
    const list = raw as string[];
    switch (key) {
      case 'current_age_gte':
        if (!(ctx.age >= value)) return false;
        break;
      case 'current_age_lt':
        if (!(ctx.age < value)) return false;
        break;
      case 'age_at_diagnosis_lt':
      case 'age_at_diagnosis_gte': {
        if (fact.diagnosedMonthsAgo === undefined) {
          assume(
            `${label}: diagnosis date not entered — assumed ${
              key.endsWith('lt') ? `at or after age ${value}` : `before age ${value}`
            }; enter the date to check this rule`
          );
          return false;
        }
        const ageAtDiagnosis = ctx.age - fact.diagnosedMonthsAgo / 12;
        if (key.endsWith('lt') ? !(ageAtDiagnosis < value) : !(ageAtDiagnosis >= value)) {
          return false;
        }
        break;
      }
      case 'count_gte':
        if (!(Number(detail.count ?? 1) >= value)) return false;
        break;
      case 'cancer_type_in':
      case 'location_in':
      case 'paralysis_type_in': {
        const field =
          key === 'cancer_type_in'
            ? 'cancer_type'
            : key === 'location_in'
              ? 'location'
              : 'paralysis_type';
        if (detail[field] === undefined || detail[field] === '') {
          assume(
            `${label}: ${field.replace('_', ' ')} not entered — rules for ${list.join('/')} not applied`
          );
          return false;
        }
        if (!list.includes(String(detail[field]))) return false;
        break;
      }
      case 'cancer_type_not_in':
        if (detail.cancer_type === undefined) break;
        if (list.includes(String(detail.cancer_type))) return false;
        break;
      case 'stage_gte':
        if (detail.stage === undefined) {
          assume(`${label}: stage not entered — stage ${value}+ rule not applied`);
          return false;
        }
        if (!(Number(detail.stage) >= value)) return false;
        break;
      case 'with_complications':
      case 'surgically_corrected': {
        const field = key === 'with_complications' ? 'complications' : 'surgically_corrected';
        if (detail[field] === undefined) {
          if (field === 'complications') {
            if (value) {
              assume(`${label}: complications not answered — assumed none`);
              return false;
            }
            break;
          }
          if (value) return false;
          assume(`${label}: repair status not answered — assumed not repaired`);
          break;
        }
        if (!!detail[field] !== !!value) return false;
        break;
      }
      case 'never_treated':
      case 'untreated': {
        const neverTreated = fact.treatedMonthsAgo === null || detail.never_treated === true;
        if (!!value !== neverTreated) return false;
        break;
      }
      case 'last_episode_months_ago_lte':
      case 'last_episode_months_ago_gt': {
        const last =
          (detail.last_episode_months_ago as number | undefined) ??
          fact.treatedMonthsAgo ??
          undefined;
        if (last == null) {
          assume(`${label}: last episode date unknown`);
          if (key.endsWith('gt')) return false;
          break;
        }
        if (key.endsWith('lte') ? !(last <= value) : !(last > value)) return false;
        break;
      }
      case 'also_has_any':
        if (!list.some(code => ctx.facts.has(code))) return false;
        break;
      case 'insulin_units_daily_gt':
        if (detail.insulin_units_daily === undefined) {
          assume(`${label}: daily insulin units unknown — assumed over ${value}`);
          break;
        }
        if (!(Number(detail.insulin_units_daily) > value)) return false;
        break;
      default:
        assume(`${label}: carrier criterion "${key}" not evaluated`);
    }
  }
  return true;
}

function triggerHits(
  trigger: RuleTrigger,
  ctx: EvalContext,
  labelFor: (code: string) => string
): { hit: boolean; assumed: string[]; code?: string } {
  for (const code of trigger.codes) {
    const list = ctx.facts.get(code);
    if (!list) continue;
    for (const fact of list) {
      const assumed: string[] = [];
      const assume: Assume = m => assumed.push(m);
      const label = labelFor(code);
      if (
        windowHits(trigger.window, fact, assume, label) &&
        extraHolds(trigger.extra, fact, ctx, assume, label)
      ) {
        return { hit: true, assumed, code };
      }
    }
  }
  return { hit: false, assumed: [] };
}

/** Position of an outcome in the product's class order: higher is worse. */
export function rank(product: Product, outcome: Outcome): number {
  if (outcome === DECLINE) return 1e6;
  if (outcome === REFER) return -1;
  const direct = product.classOrder.indexOf(outcome);
  if (direct >= 0) return direct;
  const cls = product.classes.find(c => c.code === outcome);
  if (cls) {
    const viaClass = product.classOrder.indexOf(cls.uwClass);
    if (viaClass >= 0) return viaClass;
  }
  return product.classOrder.length;
}

// ─── Pricing ────────────────────────────────────────────────────────────────

function round2(value: number): number {
  return Math.round((value + 1e-9) * 100) / 100;
}

function policyFee(product: Product, cls: PlanClass, face: number): number {
  if (product.feeByFace && product.feeByFace.length) {
    for (const band of product.feeByFace) {
      if (
        (band.face_lt !== undefined && face < band.face_lt) ||
        (band.face_gte !== undefined && face >= band.face_gte)
      ) {
        return band.fee_annual;
      }
    }
  }
  return cls.fee ?? product.fee ?? 0;
}

function lookupRate(
  data: FexBundle['tables'][string]['data'],
  sex: string,
  tobacco: string,
  band: string,
  age: number
): number | Record<string, number> | undefined {
  for (const key of [
    `${sex}|${tobacco}|${band}`,
    `${sex}|U|${band}`,
    `U|${tobacco}|${band}`,
    `U|U|${band}`,
  ]) {
    const row = data[key];
    if (row && row[String(age)] !== undefined) return row[String(age)];
  }
  return undefined;
}

interface PriceContext {
  b: FexBundle;
  p: Product;
  cls: PlanClass;
  age: number;
  sex: string;
  tobacco: boolean;
  mode: PaymentMode;
  state: string;
}

type RateHit =
  | { rate: number; byFace?: undefined; basis: RateBasis; includesFee: boolean }
  | { rate?: undefined; byFace: Record<string, number>; basis: RateBasis; includesFee: boolean };

function rateFor(ctx: PriceContext, face: number): RateHit | undefined {
  const table = ctx.b.tables[ctx.cls.table];
  if (!table) return undefined;
  const sex = ctx.p.stateRules?.unisexMaleStates?.includes(ctx.state) ? 'M' : ctx.sex;
  const tobacco = ctx.tobacco ? 'T' : 'N';
  let band = '';
  if (table.bands && table.bands.length) {
    band = (
      table.bands.find(b => face >= b.min && face <= b.max) ??
      (face < table.bands[0].min ? table.bands[0] : table.bands[table.bands.length - 1])
    ).band;
  }
  const hit = lookupRate(table.data, sex, tobacco, band, ctx.age);
  if (hit == null) return undefined;
  return typeof hit === 'object'
    ? { byFace: hit, basis: table.basis, includesFee: table.includesFee }
    : { rate: hit, basis: table.basis, includesFee: table.includesFee };
}

interface Priced {
  premium: number | null;
  annual: number | null;
  face: number;
  note?: string;
  basis: RateBasis;
}

function premiumFor(ctx: PriceContext, face: number): Priced | undefined {
  const hit = rateFor(ctx, face);
  if (!hit) return undefined;
  const modal = ctx.p.modal;

  if (hit.byFace) {
    const faces = Object.keys(hit.byFace)
      .map(Number)
      .sort((a, b) => a - b);
    const chosen = faces.filter(f => f <= face).pop() ?? faces[0];
    const printed = hit.byFace[String(chosen)];
    const printedMonthly = hit.basis.startsWith('MONTHLY');
    let premium: number | null = printed;
    let annual: number | null = null;
    let note: string | undefined;
    if (printedMonthly) {
      if (ctx.mode !== 'monthly') {
        premium = null;
        note = 'Carrier publishes monthly premiums only';
      }
    } else if (ctx.mode !== 'annual') {
      const factor = modal[ctx.mode];
      premium = factor ? round2(printed * factor) : null;
      annual = printed;
      if (!factor) note = `${MODE_LABEL[ctx.mode]} factor not published`;
    }
    return { premium, annual, face: chosen, note, basis: hit.basis };
  }

  const rate = hit.rate;
  if (hit.basis === 'SINGLE_PREMIUM_PER_1000') {
    return {
      premium: round2((rate * face) / 1e3),
      annual: null,
      face,
      note: 'Single premium (paid once)',
      basis: hit.basis,
    };
  }
  const fee = hit.includesFee ? 0 : policyFee(ctx.p, ctx.cls, face);
  if (hit.basis === 'MONTHLY_PER_1000') {
    const monthly = round2((rate * face) / 1e3 + fee);
    return {
      premium: ctx.mode === 'monthly' ? monthly : null,
      annual: null,
      face,
      basis: hit.basis,
      note: ctx.mode === 'monthly' ? undefined : 'Carrier publishes monthly rates only',
    };
  }
  const annualRaw = (rate * face) / 1e3 + fee;
  const annual = round2(annualRaw);
  if (ctx.mode === 'annual') {
    const firstYear = ctx.p.annualFirstYearFactor;
    return firstYear && firstYear !== 1
      ? {
          premium: annual,
          annual,
          face,
          basis: hit.basis,
          note: `First-year annual premium is ${'$' + round2(annualRaw * firstYear).toFixed(2)} (×${firstYear}); ${'$' + annual.toFixed(2)} from year 2`,
        }
      : { premium: annual, annual, face, basis: hit.basis };
  }
  const factor = modal[ctx.mode];
  return factor
    ? { premium: round2(annualRaw * factor), annual, face, basis: hit.basis }
    : {
        premium: null,
        annual,
        face,
        basis: hit.basis,
        note: `${MODE_LABEL[ctx.mode]} factor not published by carrier — annual premium shown`,
      };
}

/** The largest face whose modal premium fits the budget, on the product's face increment. */
function maxFaceForBudget(
  ctx: PriceContext,
  budget: number,
  min: number,
  max: number,
  step: number
): number | undefined {
  const fits = (face: number): Priced | undefined => {
    const priced = premiumFor(ctx, face);
    return priced && priced.premium !== null && priced.premium <= budget + 1e-9
      ? priced
      : undefined;
  };
  const hit = rateFor(ctx, max);
  if (hit?.byFace) {
    const faces = Object.keys(hit.byFace)
      .map(Number)
      .filter(f => f >= min && f <= max)
      .sort((a, b) => b - a);
    for (const face of faces) if (fits(face)) return face;
    return undefined;
  }
  if (!fits(min)) return undefined;
  if (fits(max)) return max;
  let lo = Math.ceil(min / step);
  let hi = Math.floor(max / step);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid * step)) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(min, lo * step);
}

function faceLimits(
  product: Product,
  cls: PlanClass,
  age: number,
  state: string
): { min: number; max: number } {
  let min = cls.faceMin ?? 0;
  let max = cls.faceMax ?? Infinity;
  for (const band of cls.faceByAge ?? []) {
    if (age >= band.ages[0] && age <= band.ages[1]) {
      if (band.max !== undefined && band.max !== null) max = Math.min(max, band.max);
      if (band.min !== undefined && band.min !== null) min = Math.max(min, band.min);
    }
  }
  const stateMin = product.stateRules?.faceMinByState?.[state];
  if (stateMin) min = Math.max(min, stateMin);
  return { min, max };
}

function ageProblem(
  product: Product,
  cls: PlanClass,
  age: number,
  tobacco: boolean,
  state: string
): string | null {
  let range = (tobacco && cls.tobaccoDistinct ? cls.ages.T : cls.ages.N) ?? cls.ages.N;
  if (tobacco && cls.ages.T && cls.ages.N && age < cls.ages.T[0] && age >= cls.ages.N[0]) {
    range = cls.ages.N;
  }
  if (!range) return null;
  if (age < range[0] || age > range[1]) {
    return `${cls.label}: issue ages ${range[0]}–${range[1]}${tobacco && cls.tobaccoDistinct ? ' (tobacco)' : ''}`;
  }
  const stateMax =
    product.stateRules?.classMaxAgeByState?.[cls.code]?.[state] ??
    product.stateRules?.classMaxAgeByState?.[cls.uwClass]?.[state];
  return stateMax !== undefined && age > stateMax
    ? `${cls.label}: max issue age ${stateMax} in ${state}`
    : null;
}

function stateClassProblem(product: Product, cls: PlanClass, state: string): string | null {
  const unavailable = product.stateRules?.classUnavailable ?? {};
  const states = unavailable[cls.code] ?? unavailable[cls.uwClass];
  return states && states.includes(state) ? `${cls.label} not available in ${state}` : null;
}

function money(n: number): string {
  return n.toLocaleString('en-US');
}

function priceClass(
  bundle: FexBundle,
  product: Product,
  cls: PlanClass,
  applicant: Applicant,
  age: number,
  mode: PaymentMode
): QuoteLine | string {
  const limits = faceLimits(product, cls, age, applicant.state);
  const ctx: PriceContext = {
    b: bundle,
    p: product,
    cls,
    age,
    sex: applicant.sex,
    tobacco: applicant.tobacco,
    mode,
    state: applicant.state,
  };
  let face: number;
  let faceAdjusted: string | null = null;
  const step = product.faceIncrement && product.faceIncrement > 0 ? product.faceIncrement : 1;

  if (applicant.budget && !applicant.face) {
    const max = isFinite(limits.max) ? limits.max : 5e4;
    const fitted = maxFaceForBudget(ctx, applicant.budget, limits.min, max, step);
    if (fitted === undefined) {
      const atMin = premiumFor(ctx, limits.min);
      return atMin?.premium != null
        ? `${cls.label}: minimum $${money(limits.min)} costs $${atMin.premium.toFixed(2)} — over budget`
        : `${cls.label}: no rate for age ${age}`;
    }
    face = fitted;
  } else {
    face = applicant.face ?? 1e4;
    if (face > limits.max) {
      faceAdjusted = `Max $${money(limits.max)} at age ${age}`;
      face = limits.max;
    }
    if (face < limits.min) {
      faceAdjusted = `Min $${money(limits.min)}`;
      face = limits.min;
    }
    if (cls.faces && cls.faces.length && !cls.faces.includes(face)) {
      const offered =
        [...cls.faces]
          .sort((a, b) => a - b)
          .filter(f => f <= face)
          .pop() ?? cls.faces[0];
      faceAdjusted = `Offered in $${cls.faces.join('/$')} only`;
      face = offered;
    }
  }

  const priced = premiumFor(ctx, face);
  if (!priced) {
    return `${cls.label}: no published rate for age ${age}${applicant.tobacco ? ' tobacco' : ''}`;
  }
  if (priced.face !== face) faceAdjusted = `Nearest published face $${money(priced.face)}`;
  const premiumNote = priced.note ?? null;
  if (
    product.minModal &&
    priced.premium !== null &&
    mode === 'monthly' &&
    priced.premium < product.minModal
  ) {
    return `${cls.label}: $${priced.premium.toFixed(2)} is under the $${product.minModal} minimum monthly premium`;
  }
  return {
    classCode: cls.code,
    classLabel: cls.label,
    uwClass: cls.uwClass,
    benefit: cls.benefit,
    db: cls.db,
    face: priced.face,
    premium: priced.premium,
    annual: priced.annual,
    mode,
    modeLabel: priced.basis === 'SINGLE_PREMIUM_PER_1000' ? 'Single' : MODE_LABEL[mode],
    basis: priced.basis,
    faceAdjusted,
    premiumNote,
    payPeriod: cls.payPeriod ?? null,
  };
}

// ─── Hits and combinations ──────────────────────────────────────────────────

interface Hit {
  outcome: Outcome;
  reason: Reason;
  rule?: UwRule;
  group?: string | null;
  factorType?: string | null;
}

function applyCombos(
  product: Product,
  applicant: Applicant,
  age: number,
  hits: Hit[],
  buildClass: Outcome | null
): void {
  const best = product.classOrder[0];

  // Activity credit on medical hits (one condition group, every rule has an AC outcome).
  if (applicant.activityCredit && age >= 18 && (buildClass === null || buildClass === best)) {
    const medical = hits.filter(
      h => h.factorType === 'MEDICAL' && h.outcome !== best && h.outcome !== DECLINE
    );
    if (new Set(medical.map(h => h.group)).size === 1 && medical.every(h => h.rule?.acOutcome)) {
      for (const h of medical) {
        h.reason.text += ` — activity credit applied (${h.outcome} → ${h.rule!.acOutcome})`;
        h.outcome = h.rule!.acOutcome!;
        h.reason.outcome = h.outcome;
      }
    }
  }

  // Activity credit on build.
  let buildAfterCredit = buildClass;
  const upgrade = product.uw.build?.activity_credit_upgrade;
  if (applicant.activityCredit && upgrade && age >= 18 && buildClass === upgrade.from) {
    for (const h of hits) {
      if (h.factorType === 'BUILD') {
        h.outcome = upgrade.to;
        h.reason.outcome = upgrade.to;
        h.reason.text += ' — activity credit applied';
      }
    }
    buildAfterCredit = upgrade.to;
  }

  const distinctGroups = (
    spec: NonNullable<ComboLogic['count_distinct_condition_groups']>
  ): number => {
    const groups = new Set<string>();
    for (const h of hits) {
      if (spec.factor_type && h.factorType !== spec.factor_type) continue;
      if (spec.outcome_in && !spec.outcome_in.includes(h.outcome)) continue;
      if (spec.group_prefix && !(h.group ?? '').startsWith(spec.group_prefix)) continue;
      groups.add(h.group ?? h.rule?.id ?? Math.random().toString());
    }
    return groups.size;
  };
  const holds = (logic: ComboLogic): boolean =>
    logic.all
      ? logic.all.every(holds)
      : logic.count_distinct_condition_groups
        ? distinctGroups(logic.count_distinct_condition_groups) >= (logic.gte ?? 1)
        : logic.build_class_after_activity_credit
          ? buildAfterCredit === logic.build_class_after_activity_credit
          : false;

  for (const combo of product.uw.combos) {
    if (combo.ages && (age < combo.ages[0] || age > combo.ages[1])) continue;
    try {
      if (holds(combo.logic)) {
        hits.push({
          outcome: combo.outcome,
          factorType: 'COMBO',
          reason: {
            kind: 'combo',
            outcome: combo.outcome,
            text: combo.text,
            page: combo.page,
            ruleId: combo.id,
          },
        });
      }
    } catch {
      // A malformed combo record is skipped rather than failing the quote.
    }
  }
}

/** The label to show for an outcome on this product. */
export function outcomeLabel(product: Product, outcome: Outcome): string {
  const cls = product.classes.find(c => c.uwClass === outcome || c.code === outcome);
  if (!cls) return outcome.charAt(0) + outcome.slice(1).toLowerCase();
  return cls.uwClass !== cls.code && cls.payPeriod
    ? cls.uwClass.charAt(0) + cls.uwClass.slice(1).toLowerCase()
    : cls.label;
}

export function heightLabel(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

// ─── One product ────────────────────────────────────────────────────────────

export function quoteProduct(
  bundle: FexBundle,
  drugs: DrugIndex,
  product: Product,
  applicant: Applicant,
  options: QuoteOptions = {}
): ProductResult {
  const mode = applicant.mode ?? options.mode ?? 'monthly';
  const { age, note: ageNote } = issueAge(applicant, product);
  const assumed = new Set<string>();
  const reasons: Reason[] = [];
  const result: ProductResult = {
    productId: product.id,
    carrier: product.carrier,
    family: product.family,
    product: product.product,
    type: product.type,
    status: product.status,
    ratesStatus: product.ratesStatus,
    uwStatus: product.uwStatus,
    uwLoaded: product.uwLoaded,
    alerts: [...product.alerts],
    age,
    ageBasis: product.ageBasis,
    eligible: false,
    outcome: null,
    outcomeLabel: '',
    best: null,
    others: [],
    reasons,
    needsIndication: [],
    assumptions: [],
    refer: false,
  };
  if (ageNote) result.assumptions.push(ageNote);

  if (product.stateUnavailable.includes(applicant.state)) {
    result.ineligibleReason = `Not sold in ${applicant.state}`;
    reasons.push({ kind: 'state', outcome: DECLINE, text: result.ineligibleReason });
    return result;
  }

  const labelFor = (code: string): string =>
    bundle.conditions.find(c => c.code === code)?.label ?? code;
  const facts = applyTreatmentPolicy(buildFacts(applicant, drugs), product);
  const ctx: EvalContext = { age, facts, assumed };
  const hits: Hit[] = [];

  // Recent lung disorder + current tobacco (a combined application question on some products).
  if (product.tobaccoRespiratoryDeclineMonths && applicant.tobacco) {
    const codes = product.respiratoryTobaccoCodes ?? [];
    const recent = codes.find(code => {
      const fact = facts.get(code)?.[0];
      if (!fact) return false;
      const known = [fact.diagnosedMonthsAgo, fact.treatedMonthsAgo].filter(
        (v): v is number => typeof v === 'number'
      );
      return known.length && Math.min(...known) <= product.tobaccoRespiratoryDeclineMonths!;
    });
    if (recent) {
      hits.push({
        outcome: DECLINE,
        reason: {
          kind: 'rule',
          outcome: DECLINE,
          text:
            product.tobaccoCombinationText ??
            'Recent lung/respiratory disorder plus current tobacco use triggers the carrier application decline question.',
          ref: product.tobaccoCombinationRef ?? 'Q6E',
          page: 2,
          url: product.uw.sources?.[0]?.file,
          src: 'application',
        },
      });
    }
  }

  // Application questions and guide rules: first matching trigger per rule.
  for (const rule of product.uw.rules) {
    for (const trigger of rule.triggers) {
      const hit = triggerHits(trigger, ctx, labelFor);
      if (hit.hit) {
        hit.assumed.forEach(a => assumed.add(a));
        hits.push({
          rule,
          outcome: rule.outcome,
          group: rule.group,
          factorType: rule.factorType,
          reason: {
            kind: 'rule',
            outcome: rule.outcome,
            text: rule.text,
            ref: rule.ref,
            page: rule.page,
            url: rule.url,
            ruleId: rule.id,
            assumed: hit.assumed,
            src: rule.src,
          },
        });
        break;
      }
    }
  }

  // Medications.
  let tobaccoRxNote: string | null = null;
  for (const med of applicant.meds) {
    const name = med.name || drugs.byId.get(med.drugId)?.generic || med.drugId;

    for (const rule of product.tobaccoRx ?? []) {
      if (drugs.related(med.drugId).includes(rule.drug)) {
        const fact: Fact = {
          code: 'RX',
          treatedMonthsAgo: med.lastTakenMonthsAgo ?? 0,
          diagnosedMonthsAgo: med.startedMonthsAgo,
        };
        if (windowHits(rule.window, fact, () => {}, name)) {
          tobaccoRxNote = `${rule.label} — priced at tobacco rates${rule.page ? ` (p.${rule.page})` : ''}`;
        }
      }
    }

    if (drugs.multiUse(med.drugId) && !med.indication) {
      const options = new Set(drugs.byId.get(med.drugId)?.common_indications ?? []);
      result.needsIndication.push({ drugId: med.drugId, name, options: Array.from(options) });
    }

    const relatedIds = drugs.related(med.drugId);
    let entries = [];
    for (const id of relatedIds) for (const entry of product.uw.rx[id] ?? []) entries.push(entry);
    if (!entries.length) continue;
    // When the carrier lists the exact name the agent picked, use only those rows.
    const exact = med.name
      ? entries.filter(e => e.drug.toLowerCase() === med.name!.toLowerCase())
      : [];
    if (exact.length) entries = exact;

    const stoppedOverTwoYears = (med.lastTakenMonthsAgo ?? 0) > 24;
    const medFact: Fact = {
      code: 'RX',
      treatedMonthsAgo: med.lastTakenMonthsAgo ?? 0,
      diagnosedMonthsAgo: med.startedMonthsAgo,
    };
    const useUnconfirmed: typeof entries = [];

    for (const entry of entries) {
      let applies = false;
      if (entry.dep) {
        if (med.indication) {
          applies =
            entry.ind.includes(med.indication) ||
            entry.ind.some(code => (IMPLIES[med.indication!] ?? []).includes(code));
        } else if (entry.ind.length) {
          useUnconfirmed.push(entry);
        }
      } else {
        applies = true;
      }
      if (!applies) continue;

      let conditionFact: Fact | undefined;
      for (const code of entry.ind) {
        const fact = facts.get(code)?.[0];
        if (fact) {
          conditionFact = fact;
          break;
        }
      }
      if (!entry.window && stoppedOverTwoYears) continue;

      const entryAssumed: string[] = [];
      const assume: Assume = m => entryAssumed.push(m);
      const windowFact: Fact = {
        code: 'RX',
        diagnosedMonthsAgo: conditionFact?.diagnosedMonthsAgo ?? med.startedMonthsAgo,
        treatedMonthsAgo: medFact.treatedMonthsAgo,
      };
      if (
        entry.window &&
        !windowHits(
          entry.window,
          windowFact,
          m =>
            assume(
              `${name}: ${conditionFact ? 'diagnosis' : 'start'} date not entered — ${
                m.split('—')[1]?.trim() ?? 'assumed recent'
              }`
            ),
          name
        )
      ) {
        continue;
      }
      if (entry.extra && !extraHolds(entry.extra, conditionFact ?? medFact, ctx, assume, name)) {
        continue;
      }
      entryAssumed.forEach(a => assumed.add(a));
      hits.push({
        outcome: entry.outcome,
        reason: {
          kind: 'rx',
          outcome: entry.outcome,
          text: options.agentText
            ? `${entry.drug}${entry.indText ? ' — ' + entry.indText : ''}`
            : `${entry.drug}${entry.indText ? ' — ' + entry.indText : ''}${entry.note ? ' (' + entry.note + ')' : ''}`,
          note: options.agentText ? (entry.note ?? null) : undefined,
          page: entry.page,
          assumed: entryAssumed,
        },
      });
    }

    // Use not confirmed: apply the worst listed use and ask the agent.
    if (useUnconfirmed.length) {
      const worst = useUnconfirmed.reduce((a, b) =>
        rank(product, b.outcome) > rank(product, a.outcome) ? b : a
      );
      const uses = Array.from(
        new Set(useUnconfirmed.map(e => e.indText || e.ind.map(labelFor).join('/')).filter(Boolean))
      );
      hits.push({
        outcome: worst.outcome,
        reason: {
          kind: 'rx',
          outcome: worst.outcome,
          text: `${worst.drug} — use not confirmed; carrier lists it for ${uses.slice(0, 4).join('; ')}. Worst listed use applied.`,
          page: worst.page,
          assumed: ['indication not confirmed'],
        },
      });
      if (!result.needsIndication.some(n => n.drugId === med.drugId)) {
        result.needsIndication.push({
          drugId: med.drugId,
          name,
          options: Array.from(new Set(useUnconfirmed.flatMap(e => e.ind))),
        });
      }
    }
  }

  if (product.rxVerificationPending && applicant.meds?.length) {
    result.refer = true;
    result.assumptions.push(
      'Current Aetna final-expense Rx matrix is not fully verified in this build — medication history must be confirmed in the carrier eApp/Rx check.'
    );
  }

  // Build chart.
  let buildClass: Outcome | null = null;
  const build = product.uw.build;
  if (build && build.rows?.length) {
    const applies = build.applies_ages;
    if (!(applies && (age < applies[0] || age > applies[1]))) {
      if (applicant.heightIn && applicant.weightLb) {
        const height = Math.round(applicant.heightIn);
        const weight = applicant.weightLb;
        const row = build.rows.find(r => r.height_in === height);
        const heights = build.rows.map(r => r.height_in);
        let outcome: Outcome | null = null;
        let text = '';
        const order = [...product.classOrder];
        if (row)
          for (const cls of Object.keys(row.max_lb_by_class))
            if (!order.includes(cls)) order.push(cls);

        if (!row) {
          outcome = build.height_outside_chart_outcome ?? REFER;
          text = `Height ${heightLabel(height)} is outside the carrier build chart (${heightLabel(Math.min(...heights))}–${heightLabel(Math.max(...heights))})`;
        } else if (row.min_lb_by_class) {
          for (const cls of order) {
            const min = row.min_lb_by_class[cls] ?? row.min_lb ?? 0;
            const max = row.max_lb_by_class[cls];
            if (max != null && weight >= min && weight <= max) {
              outcome = cls;
              text = `Build ${heightLabel(height)} ${weight} lb within ${min}–${max} lb (${cls})`;
              break;
            }
          }
          if (!outcome) {
            const under =
              weight <
              Math.min(
                ...Object.values(row.min_lb_by_class).filter(
                  (v): v is number => typeof v == 'number'
                )
              );
            outcome = under
              ? (build.under_min_outcome ?? DECLINE)
              : (build.over_max_outcome ?? DECLINE);
            text = `Weight ${weight} lb is ${under ? 'under the minimum' : 'over the maximum'} on the build chart for ${heightLabel(height)}`;
          }
        } else if (row.min_lb && weight < row.min_lb) {
          outcome = build.under_min_outcome ?? DECLINE;
          text = `Weight ${weight} lb is under the ${row.min_lb} lb minimum for ${heightLabel(height)}`;
        } else {
          for (const cls of order) {
            const max = row.max_lb_by_class[cls];
            if (max != null && weight <= max) {
              outcome = cls;
              text = `Build ${heightLabel(height)} ${weight} lb ≤ ${max} lb (${cls} max)`;
              break;
            }
          }
          if (!outcome) {
            const top = Math.max(
              ...Object.values(row.max_lb_by_class).filter((v): v is number => typeof v == 'number')
            );
            outcome = build.over_max_outcome ?? DECLINE;
            text = `Weight ${weight} lb is over the ${top} lb maximum for ${heightLabel(height)}`;
          }
        }

        if (row?.outcome_override && outcome !== DECLINE) {
          hits.push({
            outcome: row.outcome_override,
            factorType: 'BUILD',
            reason: {
              kind: 'build',
              outcome: row.outcome_override,
              text: row.note ?? `Height ${heightLabel(height)}: ${row.outcome_override}`,
              page: build.source_page,
            },
          });
        }
        buildClass = outcome;
        if ((outcome && rank(product, outcome) > 0) || outcome === REFER || outcome === DECLINE) {
          hits.push({
            outcome: outcome!,
            factorType: 'BUILD',
            reason: {
              kind: 'build',
              outcome: outcome!,
              text,
              page: build.source_page,
              url: build.source_url,
            },
          });
        }
      } else {
        result.assumptions.push('Height/weight not entered — build chart not checked');
      }
    }
  } else if (
    applicant.heightIn &&
    applicant.weightLb &&
    product.uwLoaded &&
    product.type !== 'GIWL'
  ) {
    result.assumptions.push('No build chart loaded for this plan — height/weight not checked');
  }

  if (product.uw.combos.length || hits.some(h => h.rule?.acOutcome)) {
    applyCombos(product, applicant, age, hits, buildClass);
  }

  // The decided class: the worst hit.
  let decided: Outcome | null = null;
  if (product.uwLoaded) {
    decided = product.uw.noHits ?? product.classOrder[0] ?? null;
    for (const h of hits) {
      if (h.outcome === REFER) {
        result.refer = true;
        continue;
      }
      if (decided === null || rank(product, h.outcome) > rank(product, decided))
        decided = h.outcome;
    }
  } else {
    for (const h of hits) {
      if (h.outcome === REFER) result.refer = true;
      if (product.hardDeclinesLoadedWhileClassRoutingPending && h.outcome === DECLINE) {
        decided = DECLINE;
      }
    }
  }

  if (
    decided === 'PREFERRED' &&
    applicant.aetnaMedSupp &&
    product.superPreferredRequiresAetnaMedSupp &&
    product.classes.some(c => c.uwClass === 'SUPER_PREFERRED')
  ) {
    decided = 'SUPER_PREFERRED';
    hits.push({
      outcome: 'SUPER_PREFERRED',
      reason: {
        kind: 'rule',
        outcome: 'SUPER_PREFERRED',
        text:
          product.superPreferredText ??
          'Qualifying Aetna Medicare Supplement relationship — Super Preferred rate.',
        ref: 'Med Supp qualifier',
        src: 'guide',
      },
    });
  }

  if (product.ageOutcomeRules) {
    for (const rule of product.ageOutcomeRules) {
      if ((rule.gte == null || age >= rule.gte) && (rule.lte == null || age <= rule.lte)) {
        decided = rule.outcome;
        hits.push({
          outcome: rule.outcome,
          reason: {
            kind: 'rule',
            outcome: rule.outcome,
            text: rule.text ?? 'Age-specific carrier routing applies.',
            ref: 'Age rule',
            src: 'guide',
          },
        });
      }
    }
  }

  const remap = product.stateRules?.outcomeRemap?.[applicant.state]?.[decided ?? ''];
  if (remap) {
    hits.push({
      outcome: remap.to,
      reason: { kind: 'state', outcome: remap.to, text: remap.text },
    });
    decided = remap.to;
  }
  result.outcome = decided;
  if (tobaccoRxNote) result.assumptions.push(tobaccoRxNote);
  hits.sort((a, b) => rank(product, b.outcome) - rank(product, a.outcome));
  for (const h of hits) reasons.push(h.reason);
  result.assumptions.push(...Array.from(assumed));
  if (!product.uwLoaded) {
    result.assumptions.push(
      'Health questions for this product are not loaded — best class shown; underwriting not applied'
    );
  }

  if (decided === DECLINE) {
    result.outcomeLabel = 'Decline';
    result.ineligibleReason = hits.find(h => h.outcome === DECLINE)?.reason.text ?? 'Declined';
    return result;
  }

  // Classes this product writes, or the product the result is written on instead.
  const decidedRank = decided ? rank(product, decided) : 0;
  const routing = decided && product.routing ? product.routing[decided] : undefined;
  const writtenHere = decided
    ? product.classes.some(c => c.uwClass === decided || c.code === decided)
    : true;
  const routedElsewhere =
    Array.isArray(routing) && routing.length > 0 && !routing.some(r => r.product_id === product.id);
  if (
    decided &&
    (decidedRank >= product.classOrder.length ||
      routedElsewhere ||
      (!writtenHere && !product.classes.some(c => rank(product, c.uwClass) >= decidedRank)))
  ) {
    const target = Array.isArray(routing) && routing[0]?.product_id ? routing[0].product_id : null;
    result.routedTo = target;
    result.outcomeLabel = outcomeLabel(product, decided);
    const targetName = target
      ? (bundle.products.find(p => p.id === target)?.product ?? target)
      : null;
    result.ineligibleReason = targetName
      ? `Underwriting result ${decided.charAt(0) + decided.slice(1).toLowerCase()} is written on ${targetName}`
      : `Underwriting result ${decided} is not offered on this plan`;
    reasons.unshift({ kind: 'routing', outcome: decided, text: result.ineligibleReason });
    return result;
  }

  // Price every class at or below the decided one.
  const candidates = product.classes
    .map(c => ({ cls: c, r: rank(product, c.uwClass) }))
    .filter(x => x.r >= decidedRank)
    .sort((a, b) => a.r - b.r);
  const problems: string[] = [];
  const lines: QuoteLine[] = [];
  for (const { cls } of candidates) {
    const tooOld = ageProblem(product, cls, age, applicant.tobacco, applicant.state);
    if (tooOld) {
      problems.push(tooOld);
      continue;
    }
    const notHere = stateClassProblem(product, cls, applicant.state);
    if (notHere) {
      problems.push(notHere);
      continue;
    }
    const priced = priceClass(
      bundle,
      product,
      cls,
      tobaccoRxNote ? { ...applicant, tobacco: true } : applicant,
      age,
      mode
    );
    if (typeof priced === 'string') {
      problems.push(priced);
      continue;
    }
    lines.push(priced);
  }

  if (!lines.length) {
    result.outcomeLabel = decided ? outcomeLabel(product, decided) : 'Not determined';
    result.ineligibleReason = problems[0] ?? 'No class available';
    for (const p of problems) reasons.push({ kind: 'age', outcome: DECLINE, text: p });
    return result;
  }

  result.best = lines[0];
  result.others = lines.slice(1);
  result.eligible = true;
  result.outcomeLabel = decided
    ? outcomeLabel(product, decided)
    : 'Best class (health rules not loaded)';
  if (decided && lines[0].uwClass !== decided && rank(product, lines[0].uwClass) > decidedRank) {
    result.assumptions.push(
      `Qualifies for ${outcomeLabel(product, decided)} but it is not available here (${problems[0] ?? 'age/face/state'}); next class quoted`
    );
  }
  return result;
}

// ─── Every product ──────────────────────────────────────────────────────────

/**
 * Sort tier: 0 priced with health rules applied, 1.5 eligible but no modal
 * premium (single premium / factor not published), 2 price-only (health rules
 * not loaded), 3 not eligible.
 */
export function resultTier(r: ProductResult): number {
  if (!r.eligible) return 3;
  if (!r.uwLoaded) return 2;
  return r.best?.basis === 'SINGLE_PREMIUM_PER_1000' || r.best?.premium == null ? 1.5 : 0;
}

/**
 * Quote every quotable product and rank them: health-qualified and priced
 * first, cheapest first (or, on a budget quote, largest face first).
 */
export function quoteAll(
  bundle: FexBundle,
  applicant: Applicant,
  options: QuoteOptions = {},
  drugs?: DrugIndex
): ProductResult[] {
  const index = drugs ?? new DrugIndex(bundle);
  const results = bundle.products
    .filter(p => p.quotable || options.includeUnquotable)
    .map(p => quoteProduct(bundle, index, p, applicant, options));
  const premium = (r: ProductResult): number => r.best?.premium ?? Infinity;
  results.sort(
    (a, b) =>
      resultTier(a) - resultTier(b) ||
      (applicant.budget && !applicant.face
        ? (b.best?.face ?? 0) - (a.best?.face ?? 0)
        : premium(a) - premium(b))
  );
  return results;
}
