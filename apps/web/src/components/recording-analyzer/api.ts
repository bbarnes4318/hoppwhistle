import type { RecordingAnalysisItem, Vertical } from './types';

export async function presignUpload(filename: string, contentType: string) {
  const r = await fetch('/api/recording-analysis/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, contentType }),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as { storageKey: string; url: string };
}

export async function putToSignedUrl(url: string, file: File) {
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
  const r = await fetch('/api/recording-analysis/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as { batchId: string; jobIds: string[] };
}

export async function fetchBatch(batchId: string) {
  const r = await fetch(`/api/recording-analysis/batch/${batchId}`);
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as { batchId: string; items: RecordingAnalysisItem[] };
}
