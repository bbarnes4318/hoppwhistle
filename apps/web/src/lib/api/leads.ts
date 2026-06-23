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

  // CRM fields
  assignedToId: string | null;
  assignedAt: string | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  priority: string | null;
  leadStage: string | null;
  doNotCall: boolean;
  duplicateOfId: string | null;

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
