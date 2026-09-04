/**
 * Insurance Lead CRM — Frontend API Client
 */

import { apiClient } from '../api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InsuranceLeadSummary {
  id: string;
  vertical: 'ACA' | 'FE' | 'B2B';
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  phone: string;
  email: string | null;
  state: string | null;
  zipCode: string | null;
  source: string | null;
  status: string;
  leadStage: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  latestSubmission: {
    id: string;
    receivedAt: string;
    validationStatus: 'VALID' | 'INVALID';
    postStatus: string;
    postMode: 'TEST' | 'LIVE';
    ameriquoteResponseStatus: string | null;
    source: string | null;
  } | null;
}

export interface InsuranceActivity {
  id: string;
  tenantId: string;
  insuranceLeadId: string;
  type:
    | 'NOTE'
    | 'CALL'
    | 'STATUS_CHANGE'
    | 'SUBMISSION'
    | 'VALIDATION'
    | 'SYSTEM'
    | 'TASK'
    | 'COMPLIANCE';
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  createdById: string | null;
  createdAt: string;
}

export interface InsuranceTask {
  id: string;
  tenantId: string;
  insuranceLeadId: string;
  assignedToId: string | null;
  title: string;
  description: string | null;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InsuranceLeadDetail {
  id: string;
  tenantId: string;
  vertical: 'ACA' | 'FE' | 'B2B';
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  phone: string;
  address: string | null;
  address2: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zipCode: string | null;
  birthDate: string | null;
  age: number | null;
  gender: string | null;
  source: string | null;
  status: string;
  notes: string | null;
  customFields: Record<string, unknown> | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  submissions: InsuranceLeadSubmission[];

  // CRM fields
  assignedToId: string | null;
  assignedAt: string | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  priority: string | null;
  leadStage: string | null;
  doNotCall: boolean;
  duplicateOfId: string | null;

  // B2B specific CRM fields
  company: string | null;
  repName: string | null;
  industry: string | null;
  revenue: string | null;
  yearEstablished: string | null;

  // Final Expense specific CRM fields
  smoker: string | null;
  faceAmount: string | null;
  lifeType: string | null;
  riskType: string | null;
  carrier: string | null;
  product: string | null;
  monthlyPremium: string | null;
  coverageAmount: string | null;
  trustedFormUrl: string | null;
  leadidToken: string | null;
  consentLanguage: string | null;
  recordingUrl: string | null;

  // Timeline & Tasks
  activities: InsuranceActivity[];
  tasks: InsuranceTask[];
}

export interface InsuranceLeadSubmission {
  id: string;
  vertical: string;
  source: string | null;
  receivedAt: string;
  rawPayload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown> | null;
  mappedOutboundPayload: Record<string, unknown> | null;
  validationStatus: 'VALID' | 'INVALID';
  validationErrors: Array<{ path: string; message: string }> | null;
  postStatus: string;
  postMode: 'TEST' | 'LIVE';
  ameriquoteResponseRaw: string | null;
  ameriquoteResponseStatus: string | null;
  ameriquoteLeadId: string | null;
  ameriquotePrice: string | null;
  ameriquoteErrorMessage: string | null;
  postedAt: string | null;
  lastAttemptAt: string | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface InsuranceLeadStats {
  totalLeads: number;
  acaLeads: number;
  feLeads: number;
  totalSubmissions: number;
  validSubmissions: number;
  invalidSubmissions: number;
  matchedSubmissions: number;
  unmatchedSubmissions: number;
  errorSubmissions: number;
  testSubmissions: number;
  liveSubmissions: number;
}

export interface LeadListResponse {
  data: InsuranceLeadSummary[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

export async function fetchInsuranceLeads(params: {
  page?: number;
  limit?: number;
  vertical?: string;
  validationStatus?: string;
  postStatus?: string;
  postMode?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  leadStage?: string;
  followUp?: string;
  listId?: string;
}): Promise<LeadListResponse> {
  const queryParts: string[] = [];
  if (params.page) queryParts.push(`page=${params.page}`);
  if (params.limit) queryParts.push(`limit=${params.limit}`);
  if (params.vertical) queryParts.push(`vertical=${params.vertical}`);
  if (params.validationStatus) queryParts.push(`validationStatus=${params.validationStatus}`);
  if (params.postStatus) queryParts.push(`postStatus=${params.postStatus}`);
  if (params.postMode) queryParts.push(`postMode=${params.postMode}`);
  if (params.search) queryParts.push(`search=${encodeURIComponent(params.search)}`);
  if (params.startDate) queryParts.push(`startDate=${params.startDate}`);
  if (params.endDate) queryParts.push(`endDate=${params.endDate}`);
  if (params.status) queryParts.push(`status=${params.status}`);
  if (params.leadStage) queryParts.push(`leadStage=${params.leadStage}`);
  if (params.followUp) queryParts.push(`followUp=${params.followUp}`);
  if (params.listId) queryParts.push(`listId=${params.listId}`);

  const qs = queryParts.length ? `?${queryParts.join('&')}` : '';
  const res = await apiClient.get<LeadListResponse>(`/api/v1/insurance-leads${qs}`);
  return res.data as unknown as LeadListResponse;
}

export async function fetchInsuranceLead(id: string): Promise<InsuranceLeadDetail> {
  const res = await apiClient.get<InsuranceLeadDetail>(`/api/v1/insurance-leads/${id}`);
  return res.data as unknown as InsuranceLeadDetail;
}

export async function updateInsuranceLead(
  id: string,
  data: Record<string, unknown>
): Promise<{ success: boolean }> {
  const res = await apiClient.patch<{ success: boolean }>(`/api/v1/insurance-leads/${id}`, data);
  return res.data as unknown as { success: boolean };
}

export async function retryInsuranceSubmission(
  leadId: string,
  submissionId: string
): Promise<{ success?: boolean; error?: string }> {
  const res = await apiClient.post<{ success?: boolean; error?: { message: string } }>(
    `/api/v1/insurance-leads/${leadId}/submissions/${submissionId}/retry`
  );
  if (res.error) return { error: res.error.message };
  return { success: true };
}

export async function fetchInsuranceLeadStats(): Promise<InsuranceLeadStats> {
  const res = await apiClient.get<InsuranceLeadStats>('/api/v1/insurance-leads/stats');
  return res.data as unknown as InsuranceLeadStats;
}

export async function fetchInsuranceLeadTasks(leadId: string): Promise<{ tasks: InsuranceTask[] }> {
  const res = await apiClient.get<{ tasks: InsuranceTask[] }>(
    `/api/v1/insurance-leads/${leadId}/tasks`
  );
  return res.data as unknown as { tasks: InsuranceTask[] };
}

export async function createInsuranceLeadTask(
  leadId: string,
  data: { title: string; description?: string; priority?: string; dueAt?: string }
): Promise<{ success: boolean; task: InsuranceTask }> {
  const res = await apiClient.post<{ success: boolean; task: InsuranceTask }>(
    `/api/v1/insurance-leads/${leadId}/tasks`,
    data
  );
  return res.data as unknown as { success: boolean; task: InsuranceTask };
}

export async function completeInsuranceLeadTask(
  leadId: string,
  taskId: string
): Promise<{ success: boolean; task: InsuranceTask }> {
  const res = await apiClient.post<{ success: boolean; task: InsuranceTask }>(
    `/api/v1/insurance-leads/${leadId}/tasks/${taskId}/complete`
  );
  return res.data as unknown as { success: boolean; task: InsuranceTask };
}

export async function cancelInsuranceLeadTask(
  leadId: string,
  taskId: string
): Promise<{ success: boolean; task: InsuranceTask }> {
  const res = await apiClient.post<{ success: boolean; task: InsuranceTask }>(
    `/api/v1/insurance-leads/${leadId}/tasks/${taskId}/cancel`
  );
  return res.data as unknown as { success: boolean; task: InsuranceTask };
}

export interface UserSummary {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export async function fetchUsers(): Promise<{ data: UserSummary[] }> {
  const res = await apiClient.get<{ data: UserSummary[] }>('/api/v1/users');
  return res.data as unknown as { data: UserSummary[] };
}

export interface CustomerLookupResponse {
  customer: Record<string, any> | null;
  recentCalls: any[];
  activities: any[];
  tasks: any[];
  submissions: any[];
  duplicates: any[];
}

export async function fetchCustomerLookup(phone: string): Promise<CustomerLookupResponse> {
  const res = await apiClient.get<CustomerLookupResponse>(
    `/api/v1/call-center/customer-lookup?phone=${encodeURIComponent(phone)}`
  );
  return res.data as unknown as CustomerLookupResponse;
}

export async function deleteInsuranceLeads(ids: string[]): Promise<{ success: boolean; count: number }> {
  const res = await apiClient.delete<{ success: boolean; count: number }>('/api/v1/insurance-leads', { ids });
  if (res.error) throw new Error(res.error.message);
  return res.data as unknown as { success: boolean; count: number };
}

export async function bulkImportInsuranceLeads(
  leads: Array<Record<string, unknown>>
): Promise<{ success: boolean; count: number }> {
  const res = await apiClient.post<{ success: boolean; count: number }>(
    '/api/v1/insurance-leads/bulk',
    { leads }
  );
  return res.data as unknown as { success: boolean; count: number };
}

export async function deleteLeadList(id: string): Promise<{ success: boolean }> {
  const res = await apiClient.delete<{ success: boolean }>(`/api/v1/lead-lists/${id}`);
  if (res.error) throw new Error(res.error.message);
  return res.data as unknown as { success: boolean };
}
// ---------------------------------------------------------------------------
// CRM Reports — Ameriquote delivery outcomes
// ---------------------------------------------------------------------------

export type DeliveryOutcome = 'ACCEPTED' | 'NOT_ACCEPTED' | 'NOT_SENT';

export interface DeliveryReportRow {
  submissionId: string;
  insuranceLeadId: string;
  leadName: string;
  phone: string;
  email: string | null;
  state: string | null;
  zipCode: string | null;
  vertical: string;
  listName: string | null;
  source: string | null;
  sentAt: string | null;
  receivedAt: string;
  lastAttemptAt: string | null;
  attemptCount: number;
  postMode: string;
  postStatus: string;
  validationStatus: string;
  outcome: DeliveryOutcome;
  outcomeLabel: string;
  ameriquoteStatus: string | null;
  ameriquoteLeadId: string | null;
  ameriquotePrice: string | null;
  reason: string;
}

export interface DeliveryReportSummary {
  totalSubmissions: number;
  accepted: number;
  notAccepted: number;
  notSent: number;
  matched: number;
  manualReview: number;
  unmatched: number;
  errored: number;
  acceptedRevenue: string;
  acceptanceRate: number | null;
}

export interface DeliveryReportReason {
  outcome: DeliveryOutcome;
  postStatus: string;
  reason: string;
  count: number;
  examples: Array<{ name: string; phone: string; submissionId: string }>;
}

export interface DeliveryReport {
  summary: DeliveryReportSummary;
  reasons: DeliveryReportReason[];
  rows: DeliveryReportRow[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface DeliveryReportParams {
  startDate?: string;
  endDate?: string;
  vertical?: string;
  listId?: string;
  postStatus?: string;
  postMode?: string;
  outcome?: string;
  search?: string;
  page?: number;
  limit?: number;
}

function deliveryReportQuery(params: DeliveryReportParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.vertical) query.set('vertical', params.vertical);
  if (params.listId) query.set('listId', params.listId);
  if (params.postStatus) query.set('postStatus', params.postStatus);
  if (params.postMode) query.set('postMode', params.postMode);
  if (params.outcome) query.set('outcome', params.outcome);
  if (params.search) query.set('search', params.search);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  return query;
}

export async function fetchDeliveryReport(params: DeliveryReportParams): Promise<DeliveryReport> {
  const query = deliveryReportQuery(params);
  const res = await apiClient.get<DeliveryReport>(
    `/api/v1/insurance-leads/delivery-report?${query.toString()}`
  );
  if (res.error) throw new Error(res.error.message);
  return res.data as unknown as DeliveryReport;
}

/**
 * Hand the browser a file. The CSV is built server-side from the same rows the
 * screen renders, so this only has to move bytes — it never re-derives a
 * column, and an export can never disagree with the report above it.
 */
function downloadCsvText(csv: string, filename: string): void {
  // A BOM is what makes Excel read the é in a buyer's rejection text.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoking synchronously can cancel the download in Safari.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvRangeSuffix(startDate?: string, endDate?: string): string {
  const range = [startDate, endDate].filter(Boolean).join('_to_');
  return range || new Date().toISOString().slice(0, 10);
}

export async function exportDeliveryReportCsv(params: DeliveryReportParams): Promise<void> {
  const query = deliveryReportQuery(params);
  query.set('format', 'csv');
  const res = await apiClient.get<string>(
    `/api/v1/insurance-leads/delivery-report?${query.toString()}`,
    { responseType: 'text' }
  );
  if (res.error) throw new Error(res.error.message);
  if (!res.data) throw new Error('The export came back empty');
  downloadCsvText(
    res.data,
    `ameriquote_delivery_report_${csvRangeSuffix(params.startDate, params.endDate)}.csv`
  );
}

export async function exportInsuranceLeadsCsv(params: {
  vertical?: string;
  validationStatus?: string;
  postStatus?: string;
  postMode?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  leadStage?: string;
  followUp?: string;
  listId?: string;
}): Promise<void> {
  const query = new URLSearchParams({ format: 'csv' });
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, String(value));
  }
  const res = await apiClient.get<string>(`/api/v1/insurance-leads?${query.toString()}`, {
    responseType: 'text',
  });
  if (res.error) throw new Error(res.error.message);
  if (!res.data) throw new Error('The export came back empty');
  downloadCsvText(res.data, `crm_leads_${csvRangeSuffix(params.startDate, params.endDate)}.csv`);
}
