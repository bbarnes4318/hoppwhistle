/**
 * The engine's results, shaped for the browser.
 *
 * ── What this adds ───────────────────────────────────────────────────────────
 *
 *   appointed    -- whether the agency writes this product (its settings)
 *   application  -- what the application form needs for the best line: the
 *                   carrier name the form logs it under, its plan type, and the
 *                   premium annualised
 *   facts        -- the product's published limits, from the BUNDLE, never
 *                   from anything the client sent
 *
 * ── What this takes away, for everyone but NetEnroll staff ───────────────────
 *
 * Research provenance. The bundle was built from carrier documents, and its
 * free-text fields say how ("guide p.5, WebFetch summary - not verbatim",
 * "Workbook…", "VERIFIED_FROM_CARRIER_GUIDE"). That is how the data team
 * checks its work; it is not something an agent or an agency owner should
 * ever read. So, for a non-staff caller:
 *
 *   - `reason.note` is removed (it only exists because the route asks the
 *     engine for `agentText`, which moves an Rx note out of the reason text)
 *   - a quote line's `db` (the class's death-benefit description) is blanked;
 *     the benefit itself is still `benefit`, and its label is in `facts`
 *   - `facts.staff` (notes, state notes, death-benefit text, UW sources) is
 *     not added at all
 */

import {
  applicationCarrierFor,
  applicationPlanTypeFor,
  PAYMENTS_PER_YEAR,
  type FeeByFace,
  type PaymentMode,
  type Product,
  type ProductResult,
  type QuoteLine,
  type Reason,
} from '@hopwhistle/fex-engine';
import {
  BENEFIT_LABEL,
  RATES_STATUS_LABEL,
  UW_STATUS_LABEL,
  type Tone,
} from '@hopwhistle/fex-engine/catalog';

export interface FexSettingsShape {
  appointedOnly: boolean;
  appointedProductIds: string[];
  defaultFace: number;
  defaultMode: string;
  showPriceOnly: boolean;
  autoOpenOnCall: boolean;
}

export const DEFAULT_FEX_SETTINGS: FexSettingsShape = {
  appointedOnly: false,
  appointedProductIds: [],
  defaultFace: 10000,
  defaultMode: 'monthly',
  showPriceOnly: true,
  autoOpenOnCall: true,
};

export interface PresentContext {
  settings: Pick<FexSettingsShape, 'appointedOnly' | 'appointedProductIds'>;
  isStaff: boolean;
  productsById: Map<string, Product>;
}

export interface FexApplicationHint {
  carrier: string;
  product: string;
  planType: 'LEVEL' | 'GRADED' | 'ROP' | 'GUARANTEED_ISSUE' | null;
  /** The modal premium times payments per year; null for a single-premium line. */
  annualizedPremium: number | null;
}

export interface FexFacts {
  issueAges: string[];
  faceLimits: Array<{
    classCode: string;
    label: string;
    min: number | null;
    max: number | null;
    byAge: Array<{ ages: [number, number]; min: number | null; max: number | null }>;
  }>;
  policyFeeAnnual: number | FeeByFace[] | null;
  monthlyFactor: number | null;
  monthlyLabel: string | null;
  ageBasis: string;
  ratesStatus: { label: string; tone: Tone };
  uwStatus: string;
  sourceDate: string | null;
  stateUnavailable: string[];
  benefitByClass: Record<string, string>;
  alerts: string[];
  staff?: {
    notes: string[];
    stateNotes: string[];
    deathBenefitText: Record<string, string | null>;
    uwSources: unknown[];
  };
}

export type PresentedResult = ProductResult & {
  appointed: boolean;
  application: FexApplicationHint | null;
  facts: FexFacts | null;
};

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export function ratesStatusOf(code: string): { label: string; tone: Tone } {
  const entry = RATES_STATUS_LABEL[code];
  return entry ? { label: entry[0], tone: entry[1] } : { label: code, tone: 'neutral' };
}

export function uwStatusOf(code: string): string {
  return UW_STATUS_LABEL[code] ?? code;
}

export function ageBasisLabel(basis: string): string {
  if (basis === 'ALB') return 'Last birthday';
  if (basis === 'ANB') return 'Nearest birthday';
  return 'Not published';
}

export function isAppointed(
  settings: Pick<FexSettingsShape, 'appointedOnly' | 'appointedProductIds'>,
  productId: string
): boolean {
  return !settings.appointedOnly || settings.appointedProductIds.includes(productId);
}

/** The application-form fields for one quoted line of a product. */
export function applicationFor(
  result: Pick<ProductResult, 'productId' | 'family' | 'product'>,
  line: QuoteLine
): FexApplicationHint {
  return {
    carrier: applicationCarrierFor(result.productId, result.family),
    product: result.product,
    planType: applicationPlanTypeFor(line.benefit) ?? null,
    annualizedPremium:
      line.basis === 'SINGLE_PREMIUM_PER_1000' || line.premium == null
        ? null
        : round2(line.premium * PAYMENTS_PER_YEAR[line.mode as PaymentMode]),
  };
}

const range = (r: [number, number] | undefined): string | null => (r ? `${r[0]}–${r[1]}` : null);

export function factsFor(product: Product, isStaff: boolean): FexFacts {
  const facts: FexFacts = {
    issueAges: product.classes.map(cls => {
      const n = range(cls.ages.N);
      const t = range(cls.ages.T);
      const parts = [cls.label, n ?? 'not published'];
      return t ? `${parts.join(' ')} (tobacco ${t})` : parts.join(' ');
    }),
    faceLimits: product.classes.map(cls => ({
      classCode: cls.code,
      label: cls.label,
      min: cls.faceMin,
      max: cls.faceMax,
      byAge: (cls.faceByAge ?? []).map(band => ({
        ages: band.ages,
        min: band.min ?? null,
        max: band.max ?? null,
      })),
    })),
    policyFeeAnnual: product.fee ?? product.feeByFace ?? null,
    monthlyFactor: product.modal?.monthly ?? null,
    monthlyLabel: product.monthlyLabel,
    ageBasis: ageBasisLabel(product.ageBasis),
    ratesStatus: ratesStatusOf(product.ratesStatus),
    uwStatus: uwStatusOf(product.uwStatus),
    sourceDate: product.source?.effective_or_doc_date ?? null,
    stateUnavailable: [...product.stateUnavailable],
    benefitByClass: Object.fromEntries(
      product.classes.map(cls => [cls.code, BENEFIT_LABEL[cls.benefit] ?? cls.benefit])
    ),
    alerts: [...product.alerts],
  };
  if (isStaff) {
    facts.staff = {
      notes: [...product.notes],
      stateNotes: [...product.stateNotes],
      deathBenefitText: Object.fromEntries(product.classes.map(cls => [cls.code, cls.db])),
      uwSources: [...(product.uw?.sources ?? [])],
    };
  }
  return facts;
}

function presentReason(reason: Reason, isStaff: boolean): Reason {
  if (isStaff) return reason;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- removed on purpose
  const { note, ...rest } = reason;
  return rest;
}

function presentLine(line: QuoteLine | null, isStaff: boolean): QuoteLine | null {
  if (!line || isStaff) return line;
  return { ...line, db: null };
}

export function presentResult(result: ProductResult, ctx: PresentContext): PresentedResult {
  const product = ctx.productsById.get(result.productId);
  return {
    ...result,
    best: presentLine(result.best, ctx.isStaff),
    others: result.others.map(line => presentLine(line, ctx.isStaff)!),
    reasons: result.reasons.map(reason => presentReason(reason, ctx.isStaff)),
    appointed: isAppointed(ctx.settings, result.productId),
    application: result.eligible && result.best ? applicationFor(result, result.best) : null,
    facts: product ? factsFor(product, ctx.isStaff) : null,
  };
}

export function presentResults(results: ProductResult[], ctx: PresentContext): PresentedResult[] {
  return results.map(result => presentResult(result, ctx));
}
