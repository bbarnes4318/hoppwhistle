'use client';

import * as React from 'react';
import type { RecordingAnalysisItem, Vertical } from './types';
import { FIELDS_BY_VERTICAL, VERTICALS } from './types';
import {
  createAnalysisBatch,
  fetchBatch,
  presignUpload,
  putToSignedUrl,
  rerunAnalysisForItem,
  downloadBatchCsv,
} from './api';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/alert';

function cn(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ');
}

function splitUrls(raw: string): string[] {
  return raw
    .split(/\r?\n|,|\s+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => /^https?:\/\//i.test(s));
}

/** 0..1 -> bar width */
function clamp01(n: number) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function toPct(n: number) {
  const v = Math.round(clamp01(n) * 100);
  return `${v}%`;
}

/**
 * Heuristic confidence extractor:
 * Supports:
 *  - extracted._confidence: { key: number }
 *  - extracted.confidence: { key: number }
 *  - extracted[key + "_confidence"]
 */
function getFieldConfidence(extracted: any, key: string): number | null {
  if (!extracted) return null;

  const k = String(key);
  const lower = k.toLowerCase();

  const c1 = extracted?._confidence?.[k];
  if (typeof c1 === 'number') return clamp01(c1);

  const c2 = extracted?.confidence?.[k];
  if (typeof c2 === 'number') return clamp01(c2);

  const c3 = extracted?.[`${k}_confidence`];
  if (typeof c3 === 'number') return clamp01(c3);

  const c4 = extracted?.[`${lower}_confidence`];
  if (typeof c4 === 'number') return clamp01(c4);

  return null;
}

function StatusPill({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  const variant =
    s === 'done'
      ? 'default'
      : s === 'failed'
      ? 'destructive'
      : s === 'analyzing' || s === 'transcribing'
      ? 'secondary'
      : 'outline';

  return <Badge variant={variant as any}>{status}</Badge>;
}

function BillableBadge({ extracted }: { extracted: any }) {
  const billable =
    extracted?.['Billable'] ??
    extracted?.['Billable (Y/N)'] ??
    extracted?.['billable'] ??
    extracted?.['isBillable'];

  const val = typeof billable === 'string' ? billable.trim().toUpperCase() : billable;

  if (val === 'Y' || val === true) return <Badge className="bg-emerald-600 text-white">Billable</Badge>;
  if (val === 'N' || val === false) return <Badge variant="destructive">Non-billable</Badge>;

  return <Badge variant="outline">Billable: —</Badge>;
}

function ConfidenceBar({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <div className="h-2 w-full rounded-full bg-muted">
        <div className="h-2 rounded-full bg-muted" style={{ width: '0%' }} />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div className="h-2 bg-foreground/70" style={{ width: toPct(value) }} />
      </div>
      <div className="text-[11px] text-muted-foreground">{toPct(value)} confidence</div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function RecordingAnalyzer() {
  const [vertical, setVertical] = React.useState<Vertical>('ACA');
  const fieldDefs = React.useMemo(() => FIELDS_BY_VERTICAL[vertical], [vertical]);

  const defaultSelected = React.useMemo(() => new Set(fieldDefs.filter((f) => f.defaultChecked).map((f) => f.key)), [
    fieldDefs,
  ]);

  const [selected, setSelected] = React.useState<Set<string>>(defaultSelected);
  const [urlText, setUrlText] = React.useState('');
  const [files, setFiles] = React.useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const [batchId, setBatchId] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<RecordingAnalysisItem[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [polling, setPolling] = React.useState(false);

  const [activeItem, setActiveItem] = React.useState<RecordingAnalysisItem | null>(null);

  // Re-run dialog state
  const [rerunOpen, setRerunOpen] = React.useState(false);
  const [rerunItem, setRerunItem] = React.useState<RecordingAnalysisItem | null>(null);
  const [rerunSelected, setRerunSelected] = React.useState<Set<string>>(new Set());
  const [rerunBusy, setRerunBusy] = React.useState(false);

  React.useEffect(() => {
    setSelected(new Set(defaultSelected));
    setError(null);
    setFiles([]);
    setUrlText('');
    setItems([]);
    setBatchId(null);
    setActiveItem(null);
  }, [vertical, defaultSelected]);

  function toggleField(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(fieldDefs.map((f) => f.key)));
  }

  function selectDefaults() {
    setSelected(new Set(fieldDefs.filter((f) => f.defaultChecked).map((f) => f.key)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function onPickFiles(list: FileList | null) {
    if (!list) return;
    const next: File[] = [];
    for (const f of Array.from(list)) {
      const ok =
        /audio\/(wav|mpeg|mp3|x-wav|ogg|opus)/i.test(f.type) || /\.(wav|mp3|ogg|opus)$/i.test(f.name);
      if (ok) next.push(f);
    }
    setFiles((prev) => [...prev, ...next].slice(0, 20));
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function refresh(bId: string) {
    const data = await fetchBatch(bId);
    setItems(data.items);

    const done =
      data.items.length > 0 &&
      data.items.every((i) => {
        const s = (i.status || '').toLowerCase();
        return s === 'done' || s === 'failed';
      });

    return done;
  }

  async function startPolling(bId: string) {
    setPolling(true);

    try {
      const doneNow = await refresh(bId);
      if (doneNow) {
        setPolling(false);
        return;
      }
    } catch (e: any) {
      setPolling(false);
      setError(e?.message || 'Failed to fetch batch');
      return;
    }

    const interval = setInterval(async () => {
      try {
        const done = await refresh(bId);
        if (done) {
          clearInterval(interval);
          setPolling(false);
        }
      } catch (e: any) {
        clearInterval(interval);
        setPolling(false);
        setError(e?.message || 'Failed to fetch batch');
      }
    }, 1500);
  }

  async function handleSubmit() {
    setError(null);

    const urls = splitUrls(urlText);
    if (urls.length === 0 && files.length === 0) {
      setError('Add at least one recording URL or upload at least one audio file.');
      return;
    }

    const selectedFields = Array.from(selected);
    if (selectedFields.length === 0) {
      setError('Select at least one stat/field to extract.');
      return;
    }

    setIsSubmitting(true);

    try {
      const uploads: Array<{ storageKey: string; filename: string }> = [];

      for (const file of files) {
        const { storageKey, url } = await presignUpload(file.name, file.type || 'application/octet-stream');
        await putToSignedUrl(url, file);
        uploads.push({ storageKey, filename: file.name });
      }

      const resp = await createAnalysisBatch({
        vertical,
        selectedFields,
        urls,
        uploads,
      });

      setBatchId(resp.batchId);
      setItems([]);
      await startPolling(resp.batchId);
    } catch (e: any) {
      setError(e?.message || 'Failed to start analysis');
    } finally {
      setIsSubmitting(false);
    }
  }

  function openRerun(it: RecordingAnalysisItem) {
    setRerunItem(it);

    // Default rerun selection:
    // - use whatever was selected previously if present
    // - else use defaults for current vertical
    const prev = Array.isArray(it.selectedFields) ? (it.selectedFields as any as string[]) : [];
    const nextSet = new Set<string>(prev.length ? prev : Array.from(defaultSelected));
    setRerunSelected(nextSet);
    setRerunOpen(true);
  }

  async function submitRerun() {
    if (!rerunItem) return;
    const selectedFields = Array.from(rerunSelected);
    if (!selectedFields.length) {
      setError('Select at least one field for re-run.');
      return;
    }

    setRerunBusy(true);
    setError(null);

    try {
      // This assumes your API provides a rerun endpoint.
      // If your API doesn’t yet, we’ll add it server-side.
      const newBatch = await rerunAnalysisForItem(rerunItem.id, {
        selectedFields,
      });

      setRerunOpen(false);
      setRerunItem(null);

      setBatchId(newBatch.batchId);
      setItems([]);
      await startPolling(newBatch.batchId);
    } catch (e: any) {
      setError(e?.message || 'Failed to re-run');
    } finally {
      setRerunBusy(false);
    }
  }

  async function exportCsv() {
    if (!batchId) {
      setError('No batch to export yet.');
      return;
    }
    try {
      const csv = await downloadBatchCsv(batchId);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recording-analysis-${batchId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || 'CSV export failed');
    }
  }

  const verticalMeta = VERTICALS.find((v) => v.key === vertical);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Recording Analyzer</h1>
          <p className="text-sm text-muted-foreground">
            Paste recording URLs or upload audio, select a vertical and fields, and get structured results per recording.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {batchId && (
            <Badge variant="outline" className="font-mono">
              Batch: {batchId.slice(0, 8)}…
            </Badge>
          )}
          {polling && <Badge variant="secondary">Live updating…</Badge>}

          <Button variant="outline" onClick={exportCsv} disabled={!batchId}>
            Export CSV
          </Button>
        </div>
      </div>

      {error && (
        <Alert className="border-destructive/50">
          <div className="text-sm text-destructive">{error}</div>
        </Alert>
      )}

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">1) Select Vertical</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={vertical} onValueChange={(v) => setVertical(v as Vertical)}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="ACA">ACA Health</TabsTrigger>
              <TabsTrigger value="FINAL_EXPENSE">Final Expense</TabsTrigger>
              <TabsTrigger value="MEDICARE">Medicare</TabsTrigger>
            </TabsList>

            <TabsContent value={vertical} className="pt-4">
              <div className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{verticalMeta?.label}:</span> {verticalMeta?.description}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">2) Add Recordings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Recording URLs</Label>
              <textarea
                value={urlText}
                onChange={(e) => setUrlText(e.target.value)}
                placeholder="Paste one URL per line (or space/comma separated)…"
                className={cn(
                  'min-h-[140px] w-full rounded-md border bg-background px-3 py-2 text-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                )}
              />
              <div className="text-xs text-muted-foreground">
                Supports multiple URLs. We’ll process each URL as a separate recording.
              </div>
            </div>

            <div className="space-y-2">
              <Label>Upload audio (mp3/wav)</Label>
              <Input type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" multiple onChange={(e) => onPickFiles(e.target.files)} />
              <div className="text-xs text-muted-foreground">
                Upload uses a presigned PUT URL (S3/Spaces). If presign isn’t wired up yet, URL paste still works.
              </div>

              {files.length > 0 && (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>File</TableHead>
                        <TableHead className="text-right">Size</TableHead>
                        <TableHead className="text-right">Remove</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {files.map((f, idx) => (
                        <TableRow key={`${f.name}-${idx}`}>
                          <TableCell className="font-medium">{f.name}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{formatBytes(f.size)}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => removeFile(idx)}>
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">3) Choose Stats To Extract</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={selectDefaults}>
                Defaults
              </Button>
              <Button variant="outline" size="sm" onClick={selectAll}>
                All
              </Button>
              <Button variant="outline" size="sm" onClick={clearSelection}>
                None
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fieldDefs.map((f) => (
                <label
                  key={f.key}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 cursor-pointer',
                    selected.has(f.key) ? 'bg-muted/50' : 'bg-background'
                  )}
                >
                  <Checkbox checked={selected.has(f.key)} onCheckedChange={() => toggleField(f.key)} className="mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">{f.label}</div>
                    <div className="text-xs text-muted-foreground">{f.key}</div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between gap-4 border-t pt-4">
              <div className="text-xs text-muted-foreground">
                Selected: <span className="font-mono">{selected.size}</span>
              </div>

              <Button onClick={handleSubmit} disabled={isSubmitting} className="min-w-[180px]">
                {isSubmitting ? 'Starting…' : 'Analyze Recordings'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Results</CardTitle>
          <div className="text-xs text-muted-foreground">
            Click <span className="font-medium">View</span> for details, audio playback, confidences, and re-run.
          </div>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-sm text-muted-foreground">No results yet. Start an analysis to see per-recording results here.</div>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Billable</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Vertical</TableHead>
                    <TableHead>Extracted</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell>
                        <StatusPill status={it.status} />
                      </TableCell>

                      <TableCell>
                        <BillableBadge extracted={it.extracted} />
                      </TableCell>

                      <TableCell className="max-w-[420px] truncate">
                        {it.sourceType === 'url' ? (
                          <span className="font-mono text-xs">{it.sourceUrl}</span>
                        ) : (
                          <span className="text-sm">{it.filename || it.storageKey}</span>
                        )}
                      </TableCell>

                      <TableCell>
                        <Badge variant="outline">{it.vertical}</Badge>
                      </TableCell>

                      <TableCell className="text-muted-foreground text-sm">
                        {it.extracted ? `${Object.keys(it.extracted).length} fields` : '—'}
                        {it.error ? <span className="text-destructive"> • {it.error}</span> : null}
                      </TableCell>

                      <TableCell className="text-right space-x-2">
                        <Button variant="outline" size="sm" onClick={() => setActiveItem(it)}>
                          View
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openRerun(it)}>
                          Re-run
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Details dialog (includes inline audio + confidence bars) */}
      <Dialog open={!!activeItem} onOpenChange={(o) => !o && setActiveItem(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Recording Result</DialogTitle>
          </DialogHeader>

          {activeItem && (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">ID</div>
                  <div className="font-mono text-xs">{activeItem.id}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={activeItem.status} />
                  <BillableBadge extracted={activeItem.extracted} />
                </div>
              </div>

              {/* Inline audio playback */}
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Audio</div>

                {activeItem.sourceType === 'url' && activeItem.sourceUrl ? (
                  <audio controls className="w-full">
                    <source src={activeItem.sourceUrl} />
                  </audio>
                ) : activeItem.playbackUrl ? (
                  <audio controls className="w-full">
                    <source src={activeItem.playbackUrl} />
                  </audio>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No playback URL available yet for uploads. (If you want, we can add an API endpoint that returns a signed GET URL for storageKey.)
                  </div>
                )}
              </div>

              {/* Extracted fields with confidence bars */}
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Extracted Fields</div>

                {activeItem.extracted ? (
                  <div className="border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Field</TableHead>
                          <TableHead>Value</TableHead>
                          <TableHead className="w-[220px]">Confidence</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.keys(activeItem.extracted).map((k) => {
                          const v = activeItem.extracted?.[k];
                          const conf = getFieldConfidence(activeItem.extracted, k);
                          return (
                            <TableRow key={k}>
                              <TableCell className="font-medium">{k}</TableCell>
                              <TableCell className="text-sm">
                                {typeof v === 'object' ? (
                                  <pre className="text-xs bg-muted/30 border rounded p-2 overflow-auto max-h-[160px]">
                                    {JSON.stringify(v, null, 2)}
                                  </pre>
                                ) : (
                                  String(v ?? '—')
                                )}
                              </TableCell>
                              <TableCell>
                                <ConfidenceBar value={conf} />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No extracted JSON yet.</div>
                )}
              </div>

              {activeItem.transcript && (
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Transcript</div>
                  <pre className="max-h-[360px] overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
                    {activeItem.transcript}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Re-run dialog */}
      <Dialog open={rerunOpen} onOpenChange={(o) => !o && setRerunOpen(false)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Re-run extraction with different fields</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              This will create a new batch using the same recording but different selected fields.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fieldDefs.map((f) => (
                <label
                  key={`rerun-${f.key}`}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 cursor-pointer',
                    rerunSelected.has(f.key) ? 'bg-muted/50' : 'bg-background'
                  )}
                >
                  <Checkbox
                    checked={rerunSelected.has(f.key)}
                    onCheckedChange={() =>
                      setRerunSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(f.key)) next.delete(f.key);
                        else next.add(f.key);
                        return next;
                      })
                    }
                    className="mt-0.5"
                  />
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">{f.label}</div>
                    <div className="text-xs text-muted-foreground">{f.key}</div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setRerunOpen(false)} disabled={rerunBusy}>
                Cancel
              </Button>
              <Button onClick={submitRerun} disabled={rerunBusy}>
                {rerunBusy ? 'Re-running…' : 'Re-run'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
