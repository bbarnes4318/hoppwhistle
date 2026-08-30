/**
 * Every read the buyer pages make, in one place.
 *
 * Each function is a plain async call with a typed result, invoked directly
 * from the server component that needs it. There is no client cache to warm, no
 * effect to re-run and no loading flag to thread through props — the panel's
 * Suspense boundary is the loading state.
 *
 * Money note: the API returns currency as decimal strings ("12.3400") and whole
 * currency units, not minor units. `toMajor` is the single place that is
 * decided, so MoneyCell is always passed unit="major" from these types.
 */

import { apiGet } from './api';

export const CALL_PAGE_SIZE = 25;

/** Ceiling on the sampled call scan behind the hour profile and the volume readout. */
export const SCAN_PAGE_SIZE = 200;
export const SCAN_MAX_PAGES = 5;

export function toMajor(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------------ types */

export interface BuyerProfile {
  id: string;
  name: string;
  code: string;
  status: string;
  billingType: 'TERMS' | 'UPFRONT';
  leadsRemaining: number;
  walletBalance: number;
  /** Seconds a call must connect for before it is billable. The threshold. */
  billableDuration: number;
  canPauseTargets: boolean;
  canSetCaps: boolean;
  canDisputeConversions: boolean;
}

export interface BuyerCall {
  id: string;
  createdAt: string;
  callerId: string | null;
  toNumber: string | null;
  targetNumber: string | null;
  targetId: string | null;
  targetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  status: string;
  duration: number | null;
  connectedDuration: number | null;
  billable: boolean;
  billableDurationThreshold: number | null;
  billableReason: string | null;
  buyerBillableAmount: number | null;
  buyerChargeStatus: string | null;
  disputeStatus: string | null;
  disposition: string | null;
  recordingUrl: string | null;
  absoluteRecordingUrl: string | null;
  recordingStatus: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CallPage {
  rows: BuyerCall[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CostTotals {
  totalCalls: number;
  billableCalls: number;
  nonBillableCalls: number;
  averageDuration: number;
  billableRate: number;
  buyerCost: string;
  walletDebits: string;
  invoiced: string;
  pendingInvoice: string;
  disputes: string;
}

export interface CostRow {
  campaignId: string;
  campaignName: string;
  destinationNumber: string;
  totalCalls: number;
  billableCalls: number;
  nonBillableCalls: number;
  billableRate: number;
  averageDuration: number;
  pricePerBillableCall: string;
  buyerCost: string;
  disputes: string;
}

export interface CostReport {
  totals: CostTotals;
  rows: CostRow[];
}

export interface PricingRule {
  field: string;
  op: string;
  val: unknown;
  adjustment: string;
}

export interface BuyerTarget {
  id: string;
  buyerId: string;
  name: string;
  type: 'SIP' | 'PSTN' | 'WEBRTC';
  destination: string;
  priority: number;
  status: 'ACTIVE' | 'INACTIVE' | 'FAILED';
  maxCap: number;
  capPeriod: 'HOUR' | 'DAY' | 'MONTH';
  maxConcurrency: number;
  weight: number;
  acceptedStates: string[];
  isNational: boolean;
  hoursOfOperation: Record<string, Array<{ start: string; end: string }>> | null;
  timezone: string | null;
  basePrice: number;
  pricingRules: PricingRule[] | null;
}

export interface BuyerTransaction {
  id: string;
  amount: number;
  type: string;
  description: string | null;
  callId: string | null;
  createdAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  period?: { start: string; end: string } | null;
  total: string;
  dueDate: string | null;
}

export interface LiveBuyerMetrics {
  callsInFlight: number | null;
  spendToday: string | null;
  callsTowardCapToday: number | null;
  callCapToday: number | null;
  billableRate: number | null;
  unavailable?: Record<string, string> | null;
}

/* --------------------------------------------------------------- fetchers */

export function fetchBuyerProfile(token: string, buyerId: string): Promise<BuyerProfile> {
  return apiGet<BuyerProfile>(`/api/v1/buyers/${buyerId}`, token);
}

export interface CallQuery {
  buyerId: string;
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
  search?: string;
  campaignId?: string;
  disputeStatus?: string;
}

function callQueryString(q: CallQuery): string {
  const params = new URLSearchParams({
    buyerId: q.buyerId,
    page: String(q.page ?? 1),
    limit: String(q.pageSize ?? CALL_PAGE_SIZE),
  });
  if (q.startDate) params.set('startDate', q.startDate);
  if (q.endDate) params.set('endDate', q.endDate);
  if (q.search) params.set('search', q.search);
  if (q.campaignId) params.set('campaignId', q.campaignId);
  if (q.disputeStatus) params.set('disputeStatus', q.disputeStatus);
  return params.toString();
}

export async function fetchBuyerCalls(token: string, q: CallQuery): Promise<CallPage> {
  const res = await apiGet<{ data?: BuyerCall[]; meta?: { total?: number; totalPages?: number } }>(
    `/api/v1/calls?${callQueryString(q)}`,
    token
  );
  const pageSize = q.pageSize ?? CALL_PAGE_SIZE;
  return {
    rows: res.data ?? [],
    page: q.page ?? 1,
    pageSize,
    total: res.meta?.total ?? res.data?.length ?? 0,
    totalPages: res.meta?.totalPages ?? 1,
  };
}

export interface CallScan {
  rows: BuyerCall[];
  /** Rows the API says match the range, which may exceed what we scanned. */
  total: number;
  /** True when the range is larger than the scan ceiling, so the sample is partial. */
  truncated: boolean;
}

/**
 * Walk the call list up to a bounded number of pages.
 *
 * The hour profile on Spend and the volume readout on Targeting both need
 * per-call rows, and there is no aggregate endpoint that groups by hour or by
 * target. Scanning is honest about its limit: `truncated` is surfaced in the UI
 * rather than quietly presenting a partial window as the whole one.
 */
export async function scanBuyerCalls(token: string, q: CallQuery): Promise<CallScan> {
  const rows: BuyerCall[] = [];
  let total = 0;
  let page = 1;

  for (; page <= SCAN_MAX_PAGES; page += 1) {
    const res = await fetchBuyerCalls(token, { ...q, page, pageSize: SCAN_PAGE_SIZE });
    total = res.total;
    rows.push(...res.rows);
    if (res.rows.length < SCAN_PAGE_SIZE || page >= res.totalPages) break;
  }

  return { rows, total, truncated: rows.length < total };
}

export interface CostQuery {
  buyerId: string;
  startDate: string;
  endDate: string;
  campaignId?: string;
}

export async function fetchCostReport(token: string, q: CostQuery): Promise<CostReport> {
  const params = new URLSearchParams({
    buyerId: q.buyerId,
    startDate: q.startDate,
    endDate: q.endDate,
  });
  if (q.campaignId) params.set('campaignId', q.campaignId);
  const res = await apiGet<CostReport>(`/api/v1/reports/buyer-costs?${params.toString()}`, token);
  return { totals: res.totals, rows: res.rows ?? [] };
}

export async function fetchBuyerTargets(token: string, buyerId: string): Promise<BuyerTarget[]> {
  const res = await apiGet<{ data?: BuyerTarget[] }>(`/api/v1/buyers/${buyerId}/targets`, token);
  return res.data ?? [];
}

export async function fetchBuyerTransactions(
  token: string,
  buyerId: string,
  limit = 25
): Promise<BuyerTransaction[]> {
  const res = await apiGet<{ data?: BuyerTransaction[] }>(
    `/api/v1/buyers/${buyerId}/transactions?limit=${limit}`,
    token
  );
  return res.data ?? [];
}

export async function fetchInvoices(token: string, limit = 10): Promise<Invoice[]> {
  const res = await apiGet<{ data?: Invoice[] }>(`/api/v1/billing/invoices?limit=${limit}`, token);
  return res.data ?? [];
}

export async function fetchCampaigns(token: string): Promise<Array<{ id: string; name: string }>> {
  const res = await apiGet<unknown>('/api/v1/campaigns', token);
  const list = Array.isArray(res) ? res : ((res as { data?: unknown })?.data ?? []);
  if (!Array.isArray(list)) return [];
  return (list as Array<{ id?: string; name?: string }>)
    .filter(c => typeof c.id === 'string')
    .map(c => ({ id: c.id as string, name: c.name ?? 'Untitled campaign' }));
}

export function fetchLiveMetrics(token: string): Promise<LiveBuyerMetrics> {
  return apiGet<LiveBuyerMetrics>('/api/v1/live/metrics', token);
}
