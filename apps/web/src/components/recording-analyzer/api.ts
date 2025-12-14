import { apiClient } from '../../lib/api';
import type { ApiResponse } from '../../lib/api';

import type { RecordingAnalysisItem, Vertical } from './types';

export async function presignUpload(filename: string, contentType: string) {
  const response: ApiResponse<{ storageKey: string; url: string }> = await apiClient.post(
    '/api/v1/recording-analysis/presign',
    { filename, contentType }
  );
  if (response.error) throw new Error(response.error.message);
  if (!response.data) throw new Error('No data returned from presign');
  return response.data;
}

export async function putToSignedUrl(url: string, file: File) {
  // Direct upload to signed URL (no auth needed for presigned URLs)
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
}

export async function createAnalysisBatch(params: {
  vertical: Vertical;
  selectedFields: string[];
  urls: string[];
  uploads: Array<{ storageKey: string; filename: string }>;
}) {
  const response: ApiResponse<{ batchId: string; jobIds: string[] }> = await apiClient.post(
    '/api/v1/recording-analysis/analyze',
    params
  );
  if (response.error) throw new Error(response.error.message);
  if (!response.data) throw new Error('No data returned from analyze');
  return response.data;
}

export async function fetchBatch(batchId: string) {
  const response: ApiResponse<{ batchId: string; items: RecordingAnalysisItem[] }> =
    await apiClient.get(`/api/v1/recording-analysis/batch/${batchId}`);
  if (response.error) throw new Error(response.error.message);
  if (!response.data) throw new Error('No data returned from batch');
  return response.data;
}

export async function rerunAnalysisForItem(itemId: string, params: { selectedFields: string[] }) {
  const response: ApiResponse<{ batchId: string; jobIds: string[] }> = await apiClient.post(
    `/api/v1/recording-analysis/${itemId}/rerun`,
    params
  );
  if (response.error) throw new Error(response.error.message);
  if (!response.data) throw new Error('No data returned from rerun');
  return response.data;
}

export async function downloadBatchCsv(batchId: string) {
  // For CSV download, we need to use fetch directly since apiClient returns JSON
  // But we still need to include auth headers
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const apiKey = process.env.NEXT_PUBLIC_API_KEY;

  const headers: HeadersInit = {};
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  // Check for demo mode
  if (typeof window !== 'undefined') {
    const demoMode = localStorage.getItem('demoMode') === 'true';
    const demoTenantId = localStorage.getItem('demoTenantId');
    if (demoMode && demoTenantId) {
      headers['X-Demo-Tenant-Id'] = demoTenantId;
    }
  }

  const r = await fetch(`${API_URL}/api/v1/recording-analysis/batch/${batchId}/csv`, {
    headers,
  });
  if (!r.ok) throw new Error(await r.text());
  return await r.text();
}
