/**
 * The quoter's API, typed.
 *
 * The engine and the carrier data stay on the server
 * (`apps/api/src/routes/fex.ts`). Nothing here, and nothing the server sends
 * back, carries a rate table, a rule record or an Rx list: the browser gets
 * results, names and counts. The shapes below mirror
 * `apps/api/src/services/fex/present.ts`.
 */

import type {
  Applicant,
  FeeByFace,
  NeedsIndication,
  PaymentMode,
  QuoteLine,
  Reason,
} from '@hopwhistle/fex-engine/types';

import { apiClient, payload, type ApiResponse, type Envelope } from '@/lib/api';

export type Tone = 'good' | 'warn' | 'mod' | 'bad' | 'neutral';
export type QuoteSource = 'PAGE' | 'SOFTPHONE' | 'CALL_CENTER';

/** The applicant as the API takes it: the engine's, minus the quote date. */
export type FexApplicant = Omit<Applicant, 'quoteDate'> & { mode: PaymentMode };

export interface FexApplicationHint {
  /** The carrier name the application form logs this under. */
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
  /** NetEnroll staff only. */
  staff?: {
    notes: string[];
    stateNotes: string[];
    deathBenefitText: Record<string, string | null>;
    uwSources: unknown[];
  };
}

export interface FexResult {
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
  ageBasis: string;
  eligible: boolean;
  outcome: string | null;
  outcomeLabel: string;
  best: QuoteLine | null;
  others: QuoteLine[];
  reasons: Reason[];
  needsIndication: NeedsIndication[];
  assumptions: string[];
  refer: boolean;
  ineligibleReason?: string;
  routedTo?: string | null;
  appointed: boolean;
  application: FexApplicationHint | null;
  facts: FexFacts | null;
}

export interface FexQuoteResponse {
  results: FexResult[];
  summary: {
    eligible: number;
    declined: number;
    priceOnly: number;
    lowestLevelPremium: number | null;
    needsIndication: number;
  };
  /** null when the person is not state-restricted. */
  licensed: boolean | null;
  engineVersion: string;
  quotedAt: string;
  quoteDate: string;
}

export interface FexCatalogProduct {
  id: string;
  family: string;
  product: string;
  quotable: boolean;
  appointed: boolean;
  ratesStatus: { code: string; label: string; tone: Tone };
  uwStatus: { code: string; label: string };
  uwLoaded: boolean;
  sourceDate: string | null;
  classes: Array<{ code: string; label: string; benefit: string }>;
  stateUnavailable: string[];
  counts: { rules: number; rx: number; build: number };
  alerts: string[];
}

export interface FexCatalog {
  engineVersion: string;
  bundleSha256: string;
  conditions: Array<{ code: string; label: string; category: string }>;
  products: FexCatalogProduct[];
}

export interface FexDrugHit {
  id: string;
  /** The brand, generic or alias the query matched (lowercase). */
  matched?: string;
  generic: string;
  brands: string[];
  drugClass: string | null;
  multiUse: boolean;
  indications: Array<{ code: string; label: string }>;
}

export interface FexDrugRule {
  productId: string;
  family: string;
  product: string;
  printedAs: string;
  use: string;
  dependsOnUse: boolean;
  outcome: string;
  outcomeLabel: string;
  window: string | null;
  page: number | string | null;
  note?: string | null;
}

export interface FexDrugDetail {
  id: string;
  generic: string;
  brands: string[];
  drugClass: string | null;
  rules: FexDrugRule[];
}

/** What "Use this quote" hands on: enough to prefill an application. */
export interface FexSelection {
  fexQuoteId: string;
  productId: string;
  carrier: string;
  product: string;
  classCode: string;
  classLabel: string;
  benefit: string;
  face: number;
  premium: number | null;
  mode: PaymentMode;
  application: FexApplicationHint;
}

export interface FexSaveBody {
  applicant: FexApplicant;
  source: QuoteSource;
  callId?: string | null;
  insuranceLeadId?: string | null;
  prospectName?: string | null;
  selectedProductId?: string | null;
  selectedClassCode?: string | null;
}

export interface FexSaveResponse {
  id: string;
  createdAt: string;
  selected: Omit<FexSelection, 'fexQuoteId'> | null;
}

export interface FexQuoteSummary {
  id: string;
  source: QuoteSource;
  callId: string | null;
  insuranceLeadId: string | null;
  engineVersion: string;
  prospectName: string | null;
  state: string;
  age: number | null;
  sex: string;
  tobacco: boolean;
  faceAmount: number | null;
  budget: number | null;
  paymentMode: PaymentMode;
  eligibleCount: number;
  lowestPremium: number | null;
  selectedProductId: string | null;
  selectedCarrier: string | null;
  selectedProduct: string | null;
  selectedClass: string | null;
  selectedBenefit: string | null;
  selectedFace: number | null;
  selectedPremium: number | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  applicationId: string | null;
}

export interface FexQuoteDetail extends FexQuoteSummary {
  applicant: FexApplicant & { quoteDate: string };
  results: FexResult[];
}

export interface FexInsights {
  period: { from: string; to: string };
  quotes: number;
  used: number;
  savedBy: Array<{
    agentId: string;
    name: string;
    quotes: number;
    used: number;
    applications: number;
  }>;
  topSelected: Array<{
    productId: string;
    carrier: string;
    product: string;
    count: number;
    avgPremium: number | null;
  }>;
  conversion: { quotes: number; applications: number; rate: number | null };
}

export interface FexAgencySettings {
  appointedOnly: boolean;
  appointedProductIds: string[];
  defaultFace: number;
  defaultMode: PaymentMode;
  showPriceOnly: boolean;
  autoOpenOnCall: boolean;
}

export interface FexSettings {
  agency: FexAgencySettings;
  me: { autoOpenOnCall: boolean | null };
  canEdit: boolean;
}

/** A result or an error message; never throws. */
export type FexResultOf<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

function unwrap<T>(response: ApiResponse<Envelope<T>>): FexResultOf<T> {
  if (response.error) {
    return { ok: false, code: response.error.code, message: response.error.message };
  }
  const data = payload(response);
  if (data === undefined) {
    return { ok: false, code: 'BAD_RESPONSE', message: 'The quoter sent an unexpected answer.' };
  }
  return { ok: true, data };
}

export const fexApi = {
  async catalog(): Promise<FexResultOf<FexCatalog>> {
    return unwrap(await apiClient.get<Envelope<FexCatalog>>('/api/v1/fex/catalog'));
  },

  async searchDrugs(
    q: string,
    limit = 10,
    signal?: AbortSignal
  ): Promise<FexResultOf<FexDrugHit[]>> {
    const query = new URLSearchParams({ q, limit: String(limit) });
    return unwrap(
      await apiClient.get<Envelope<FexDrugHit[]>>(`/api/v1/fex/drugs?${query.toString()}`, {
        signal,
      })
    );
  },

  async drug(id: string): Promise<FexResultOf<FexDrugDetail>> {
    return unwrap(
      await apiClient.get<Envelope<FexDrugDetail>>(`/api/v1/fex/drugs/${encodeURIComponent(id)}`)
    );
  },

  async quote(
    applicant: FexApplicant,
    signal?: AbortSignal
  ): Promise<FexResultOf<FexQuoteResponse>> {
    return unwrap(
      await apiClient.post<Envelope<FexQuoteResponse>>(
        '/api/v1/fex/quote',
        { applicant },
        { signal }
      )
    );
  },

  async save(body: FexSaveBody): Promise<FexResultOf<FexSaveResponse>> {
    return unwrap(await apiClient.post<Envelope<FexSaveResponse>>('/api/v1/fex/quotes', body));
  },

  async list(
    params: {
      period?: string;
      from?: string;
      to?: string;
      agentId?: string;
      productId?: string;
      cursor?: string;
      limit?: number;
    } = {}
  ): Promise<FexResultOf<FexQuoteSummary[]> & { nextCursor?: string | null }> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    const response = await apiClient.get<Envelope<FexQuoteSummary[]> & { nextCursor?: string }>(
      `/api/v1/fex/quotes${query.size ? `?${query.toString()}` : ''}`
    );
    const result = unwrap(response);
    return result.ok ? { ...result, nextCursor: response.data?.nextCursor ?? null } : result;
  },

  async read(id: string): Promise<FexResultOf<FexQuoteDetail>> {
    return unwrap(
      await apiClient.get<Envelope<FexQuoteDetail>>(`/api/v1/fex/quotes/${encodeURIComponent(id)}`)
    );
  },

  async insights(period: string, from?: string, to?: string): Promise<FexResultOf<FexInsights>> {
    const query = new URLSearchParams({ period });
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    return unwrap(
      await apiClient.get<Envelope<FexInsights>>(`/api/v1/fex/insights?${query.toString()}`)
    );
  },

  async settings(): Promise<FexResultOf<FexSettings>> {
    return unwrap(await apiClient.get<Envelope<FexSettings>>('/api/v1/fex/settings'));
  },

  async saveSettings(
    agency: FexAgencySettings
  ): Promise<FexResultOf<{ agency: FexAgencySettings }>> {
    return unwrap(
      await apiClient.put<Envelope<{ agency: FexAgencySettings }>>('/api/v1/fex/settings', agency)
    );
  },

  async saveMySettings(
    autoOpenOnCall: boolean | null
  ): Promise<FexResultOf<{ me: { autoOpenOnCall: boolean | null } }>> {
    return unwrap(
      await apiClient.put<Envelope<{ me: { autoOpenOnCall: boolean | null } }>>(
        '/api/v1/fex/settings/me',
        { autoOpenOnCall }
      )
    );
  },
};

// ─── Formatting shared by every quoter screen ────────────────────────────────

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** $1,234.56 */
export function money(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : usd.format(value);
}

/** $10,000 */
export function wholeDollars(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : usd0.format(value);
}

export const MODE_SHORT: Record<PaymentMode, string> = {
  monthly: 'mo',
  quarterly: 'qtr',
  semiannual: '6 mo',
  annual: 'yr',
};

export const MODE_WORD: Record<PaymentMode, string> = {
  monthly: 'monthly',
  quarterly: 'quarterly',
  semiannual: 'semi-annually',
  annual: 'annually',
};
