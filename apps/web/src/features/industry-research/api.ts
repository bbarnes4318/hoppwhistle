import type {
  AdjudicationResult,
  AdversarialVerification,
  CapabilityCategory,
  CostEstimate,
  FactualVerification,
  ModeDefinition,
  ProviderAssignments,
  ProviderRole,
  ResearchBriefInput,
  ResearchRunDetail,
  ResearchRunSummary,
  StructuredReport,
  TeamProfileSummary,
} from '@hopwhistle/shared';

export interface ReportVerification {
  factual: FactualVerification | null;
  adversarial: AdversarialVerification | null;
  adjudication: AdjudicationResult | null;
}

import { apiClient } from '@/lib/api';

const BASE = '/api/v1/industry-research';

// The API wraps success payloads in { data: ... }; apiClient also wraps in { data }.
async function unwrap<T>(
  p: Promise<{ data?: { data?: T }; error?: { message: string } }>
): Promise<T> {
  const res = await p;
  if (res.error) throw new Error(res.error.message);
  if (!res.data || res.data.data === undefined) throw new Error('Empty response');
  return res.data.data;
}

export interface ResearchConfig {
  pricingAsOf: string;
  providers: Array<{
    id: string;
    label: string;
    enabled: boolean;
    hasKey: boolean;
    model: string;
    fallbackModel?: string;
    roles: ProviderRole[];
    apiKeyEnv: string;
  }>;
  roleLabels: Record<ProviderRole, string>;
  modes: ModeDefinition[];
  capabilities: CapabilityCategory[];
}

export interface CostAuditLine {
  stage: string;
  provider: string | null;
  model: string | null;
  costUsd: number;
  costBasis: string;
  providerReportedCostUsd: number | null;
  calculatedCostUsd: number | null;
  estimatedCostUsd: number | null;
  costLowUsd: number;
  costHighUsd: number;
  pricingAsOf: string;
}

export interface CostAudit {
  runId: string;
  confirmedCostUsd: number;
  calculatedCostUsd: number;
  estimatedCostLowUsd: number;
  estimatedCostHighUsd: number;
  totalLowUsd: number;
  totalHighUsd: number;
  maxBudgetUsd: number;
  budgetRemainingUsd: number;
  stages: CostAuditLine[];
}

export interface ReportResponse {
  version: number;
  verdict: string | null;
  overallScore: number | null;
  markdown: string;
  structured: StructuredReport;
  evidence: StructuredReport['evidenceLedger'];
  sources: StructuredReport['sources'];
  verification: ReportVerification | null;
  synthesisProvider: string | null;
  synthesisModel: string | null;
  createdAt: string;
}

export const researchApi = {
  getConfig: () => unwrap<ResearchConfig>(apiClient.get(`${BASE}/config`)),

  estimate: (mode: string, providerOverrides?: Partial<Record<ProviderRole, string>>) =>
    unwrap<{ estimate: CostEstimate; assignments: ProviderAssignments; mode: string }>(
      apiClient.post(`${BASE}/estimate`, { mode, providerOverrides })
    ),

  createRun: (brief: ResearchBriefInput) =>
    unwrap<{
      id: string;
      estimate: CostEstimate;
      assignments: ProviderAssignments;
      budgetWarning: boolean;
    }>(apiClient.post(`${BASE}/runs`, brief)),

  listRuns: () => unwrap<ResearchRunSummary[]>(apiClient.get(`${BASE}/runs`)),

  getRun: (id: string) => unwrap<ResearchRunDetail>(apiClient.get(`${BASE}/runs/${id}`)),

  getReport: (id: string) => unwrap<ReportResponse>(apiClient.get(`${BASE}/runs/${id}/report`)),

  getCosts: (id: string) => unwrap<CostAudit>(apiClient.get(`${BASE}/runs/${id}/costs`)),

  cancel: (id: string) => unwrap<{ status: string }>(apiClient.post(`${BASE}/runs/${id}/cancel`)),

  rerunStage: (id: string, stageKey: string) =>
    unwrap<{ status: string }>(apiClient.post(`${BASE}/runs/${id}/rerun-stage`, { stageKey })),

  listProfiles: () => unwrap<TeamProfileSummary[]>(apiClient.get(`${BASE}/team-profiles`)),

  saveProfile: (name: string, capabilities: string[]) =>
    unwrap<TeamProfileSummary>(apiClient.post(`${BASE}/team-profiles`, { name, capabilities })),

  deleteProfile: (id: string) =>
    unwrap<{ deleted: boolean }>(apiClient.delete(`${BASE}/team-profiles/${id}`)),

  reportDownloadUrl: (id: string, format: 'markdown' | 'json') =>
    `${BASE}/runs/${id}/report?format=${format}`,
};
