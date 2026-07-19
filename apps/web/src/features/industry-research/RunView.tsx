'use client';

import type { ProgressEvent, ResearchRunDetail, StageInfo } from '@hopwhistle/shared';
import { ArrowLeft, Ban, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';

import { researchApi, type ReportResponse } from './api';
import { ReportViewer } from './ReportViewer';
import { StatusBadge } from './StatusBadge';

const ACTIVE = new Set(['queued', 'planning', 'running', 'waiting']);

type StageWithOutput = StageInfo & { output?: unknown };

export function RunView({ runId }: { runId: string }) {
  const { toast } = useToast();
  const [run, setRun] = useState<ResearchRunDetail | null>(null);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await researchApi.getRun(runId);
      setRun(detail);
      if (detail.hasReport && !report) {
        researchApi
          .getReport(runId)
          .then(setReport)
          .catch(() => undefined);
      }
      return detail.status;
    } catch (e) {
      setError(String(e));
      return 'failed';
    }
  }, [runId, report]);

  // Poll while active.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const status = await load();
      if (!stop && status && ACTIVE.has(status)) {
        timerRef.current = setTimeout(tick, 2500);
      }
    };
    void tick();
    return () => {
      stop = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Elapsed clock.
  useEffect(() => {
    if (!run?.startedAt) return;
    const started = new Date(run.startedAt).getTime();
    const end = run.finishedAt ? new Date(run.finishedAt).getTime() : null;
    if (end) {
      setElapsed(Math.round((end - started) / 1000));
      return;
    }
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [run?.startedAt, run?.finishedAt]);

  const cancel = async () => {
    try {
      await researchApi.cancel(runId);
      toast({ title: 'Run canceled' });
      void load();
    } catch (e) {
      toast({ title: 'Cancel failed', description: String(e), variant: 'destructive' });
    }
  };

  const rerun = async (stageKey: string) => {
    try {
      await researchApi.rerunStage(runId, stageKey);
      toast({ title: 'Re-running from stage', description: stageKey });
      setReport(null);
      void load();
    } catch (e) {
      toast({ title: 'Rerun failed', description: String(e), variant: 'destructive' });
    }
  };

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!run) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading run…
      </div>
    );
  }

  const stages = run.stages as StageWithOutput[];
  const failedStage = stages.find(s => s.status === 'failed');
  const isActive = ACTIVE.has(run.status);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/tools/industry-research"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All research
        </Link>
        {/* Header */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
            <div>
              <div className="text-lg font-semibold">{run.industry}</div>
              <div className="text-sm text-muted-foreground">{run.geography}</div>
            </div>
            <Meta label="Mode" value={run.mode.replace(/_/g, ' ')} />
            <Meta label="Status" node={<StatusBadge status={run.status} />} />
            <Meta label="Elapsed" value={fmtDuration(elapsed)} />
            <Meta
              label="Cost accrued"
              value={`$${run.accruedCostUsd.toFixed(2)} / $${run.maxBudgetUsd}`}
            />
            {run.insufficientEvidence && (
              <Badge variant="warning" className="text-[10px]">
                Insufficient evidence
              </Badge>
            )}
            <div className="ml-auto flex gap-2">
              {isActive && (
                <Button variant="outline" size="sm" onClick={cancel}>
                  <Ban className="mr-1 h-4 w-4" /> Cancel
                </Button>
              )}
              {failedStage && (
                <Button variant="outline" size="sm" onClick={() => rerun(failedStage.key)}>
                  <RefreshCw className="mr-1 h-4 w-4" /> Retry failed stage
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue={run.hasReport ? 'report' : 'pipeline'}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="costs">Costs</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="report" disabled={!run.hasReport}>
            Report
          </TabsTrigger>
        </TabsList>

        {/* Pipeline timeline */}
        <TabsContent value="pipeline" className="space-y-4">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-2">
              {stages.map(s => (
                <StageRow key={s.key} stage={s} onRerun={() => rerun(s.key)} />
              ))}
            </div>
            <ActivityFeed progress={run.progress} active={isActive} />
          </div>
        </TabsContent>

        {/* Plan */}
        <TabsContent value="plan">
          {run.plan ? (
            <PlanView plan={run.plan} />
          ) : (
            <Empty>Research plan will appear once the planning stage completes.</Empty>
          )}
        </TabsContent>

        {/* Findings (provider reports) */}
        <TabsContent value="findings" className="space-y-4">
          {['primary', 'independent', 'social'].map(key => {
            const stage = stages.find(s => s.key === key);
            const output = stage?.output as { markdown?: string; sources?: unknown[] } | undefined;
            if (!output?.markdown) return null;
            return (
              <Card key={key}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm capitalize">
                    {stage?.label}
                    {stage?.provider && (
                      <Badge variant="secondary" className="text-[10px]">
                        {stage.provider}
                      </Badge>
                    )}
                    {stage?.usedFallback && (
                      <Badge variant="warning" className="text-[10px]">
                        fallback
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-p:text-muted-foreground prose-li:text-muted-foreground">
                    <ReactMarkdown>{output.markdown}</ReactMarkdown>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {!stages.some(
            s =>
              ['primary', 'independent', 'social'].includes(s.key) &&
              (s.output as { markdown?: string })?.markdown
          ) && <Empty>Provider findings will appear as investigation stages complete.</Empty>}
        </TabsContent>

        {/* Evidence */}
        <TabsContent value="evidence">
          <EvidenceTab stages={stages} />
        </TabsContent>

        {/* Costs */}
        <TabsContent value="costs">
          <CostsTab run={run} stages={stages} />
        </TabsContent>

        {/* Logs */}
        <TabsContent value="logs">
          <div className="rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs">
            {run.progress.length === 0 ? (
              <span className="text-muted-foreground">No log events yet.</span>
            ) : (
              run.progress.map((p, i) => (
                <div key={i} className="text-muted-foreground">
                  <span className="text-foreground/60">{new Date(p.ts).toLocaleTimeString()}</span>{' '}
                  [{p.stage}] {p.message}
                </div>
              ))
            )}
          </div>
        </TabsContent>

        {/* Report */}
        <TabsContent value="report">
          {report ? (
            <ReportViewer runId={runId} report={report} />
          ) : (
            <Empty>
              {run.hasReport
                ? 'Loading report…'
                : 'The final report will appear here once synthesis completes.'}
            </Empty>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StageRow({ stage, onRerun }: { stage: StageWithOutput; onRerun: () => void }) {
  const dot =
    stage.status === 'completed'
      ? 'bg-emerald-500'
      : stage.status === 'running'
        ? 'bg-primary animate-pulse'
        : stage.status === 'failed'
          ? 'bg-destructive'
          : stage.status === 'fallback'
            ? 'bg-amber-500'
            : stage.status === 'skipped'
              ? 'bg-muted-foreground/30'
              : 'bg-muted-foreground/40';
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{stage.label}</span>
          {stage.provider && (
            <Badge variant="outline" className="text-[10px]">
              {stage.provider}
              {stage.model ? ` · ${stage.model}` : ''}
            </Badge>
          )}
          {stage.usedFallback && (
            <Badge variant="warning" className="text-[10px]">
              fallback
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {stage.durationMs != null && <span>{(stage.durationMs / 1000).toFixed(1)}s</span>}
          {stage.sourcesFound != null && <span>{stage.sourcesFound} sources</span>}
          {stage.costUsd ? <span>${stage.costUsd.toFixed(2)}</span> : null}
          {stage.error && <span className="text-destructive">{stage.error}</span>}
        </div>
      </div>
      <StatusBadge status={stage.status} />
      {stage.status === 'failed' && (
        <Button variant="ghost" size="sm" onClick={onRerun}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function ActivityFeed({ progress, active }: { progress: ProgressEvent[]; active: boolean }) {
  const recent = [...progress].slice(-12).reverse();
  return (
    <Card className="lg:sticky lg:top-4 lg:self-start">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {active && <Loader2 className="h-4 w-4 animate-spin text-primary" />} Live activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Waiting for the pipeline to start…</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {recent.map((p, i) => (
              <li key={i} className="flex gap-2 text-muted-foreground">
                <span className="text-foreground/50">{new Date(p.ts).toLocaleTimeString()}</span>
                <span>{p.message}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PlanView({ plan }: { plan: NonNullable<ResearchRunDetail['plan']> }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{plan.summary}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {plan.workstreams.map(w => (
          <Card key={w.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{w.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-muted-foreground">
              <p>{w.objective}</p>
              <p className="italic">Stops when: {w.stoppingCriteria}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function EvidenceTab({ stages }: { stages: StageWithOutput[] }) {
  const evidence = stages.find(s => s.key === 'evidence')?.output as
    | { claims?: unknown[]; sources?: unknown[] }
    | undefined;
  const validation = stages.find(s => s.key === 'validation')?.output as
    | { validatedCount?: number; flagged?: number; sources?: unknown[] }
    | undefined;
  if (!evidence) return <Empty>Evidence will appear after the normalization stage.</Empty>;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Stat label="Claims" value={String(evidence.claims?.length ?? 0)} />
      <Stat label="Sources" value={String(evidence.sources?.length ?? 0)} />
      <Stat
        label="Validated"
        value={`${validation?.validatedCount ?? 0} (${validation?.flagged ?? 0} flagged)`}
      />
    </div>
  );
}

function CostsTab({ run, stages }: { run: ResearchRunDetail; stages: StageWithOutput[] }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Estimated"
          value={`$${run.costEstimate.lowUsd.toFixed(2)}–$${run.costEstimate.highUsd.toFixed(2)}`}
        />
        <Stat label="Accrued" value={`$${run.accruedCostUsd.toFixed(2)}`} />
        <Stat label="Budget cap" value={`$${run.maxBudgetUsd}`} />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {stages
              .filter(s => s.role)
              .map(s => (
                <tr key={s.key} className="border-t border-border/60">
                  <td className="px-3 py-2">{s.label}</td>
                  <td className="px-3 py-2 text-muted-foreground">{s.provider ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    ${(s.costUsd ?? 0).toFixed(2)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}

function Meta({ label, value, node }: { label: string; value?: string; node?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium capitalize">{node ?? value}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}
