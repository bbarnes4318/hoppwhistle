/**
 * Insurance Lead CRM — Frontend API Client
 */

import { apiClient } from '../api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InsuranceLeadSummary {
  id: string;
  vertical: 'ACA' | 'FE';
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  phone: string;
  email: string | null;
  state: string | null;
  zipCode: string | null;
  source: string | null;
  status: string;
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

export interface InsuranceLeadDetail {
  id: string;
  tenantId: string;
  vertical: 'ACA' | 'FE';
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
  data: Record<string, unknown>,
): Promise<{ success: boolean }> {
  const res = await apiClient.patch<{ success: boolean }>(`/api/v1/insurance-leads/${id}`, data);
  return res.data as unknown as { success: boolean };
}

export async function retryInsuranceSubmission(
  leadId: string,
  submissionId: string,
): Promise<{ success?: boolean; error?: string }> {
  const res = await apiClient.post<{ success?: boolean; error?: { message: string } }>(
    `/api/v1/insurance-leads/${leadId}/submissions/${submissionId}/retry`,
  );
  if (res.error) return { error: res.error.message };
  return { success: true };
}

export async function fetchInsuranceLeadStats(): Promise<InsuranceLeadStats> {
  const res = await apiClient.get<InsuranceLeadStats>('/api/v1/insurance-leads/stats');
  return res.data as unknown as InsuranceLeadStats;
}
