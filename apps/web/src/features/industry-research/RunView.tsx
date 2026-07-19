'use client';

import type { ProgressEvent, ResearchRunDetail, StageInfo } from '@hopwhistle/shared';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Check,
  ChevronDown,
  Loader2,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

import { researchApi, type ReportResponse } from './api';
import { CostSummary } from './CostSummary';
import { computePhases, FRIENDLY_STAGE, RESEARCH_STREAMS, type PhaseState } from './phases';
import { ReportViewer } from './ReportViewer';
import { SourcesWorkspace } from './SourcesWorkspace';
import { StatusBadge } from './StatusBadge';

const ACTIVE = new Set(['queued', 'planning', 'running', 'waiting']);
type StageWithOutput = StageInfo & { output?: unknown };

export function RunView({ runId }: { runId: string }) {
  const { toast } = useToast();
  const [run, setRun] = useState<ResearchRunDetail | null>(null);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [adminOpen, setAdminOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const status = await load();
      if (!stop && status && ACTIVE.has(status)) timerRef.current = setTimeout(tick, 2500);
    };
    void tick();
    return () => {
      stop = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useEffect(() => {
    if (!run?.startedAt) return;
    const started = new Date(run.startedAt).getTime();
    if (run.finishedAt) {
      setElapsed(Math.round((new Date(run.finishedAt).getTime() - started) / 1000));
      return;
    }
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [run?.startedAt, run?.finishedAt]);

  const cancel = async () => {
    try {
      await researchApi.cancel(runId);
      toast({ title: 'Investigation canceled' });
      void load();
    } catch (e) {
      toast({ title: 'Cancel failed', description: String(e), variant: 'destructive' });
    }
  };

  const rerun = async (stageKey: string) => {
    try {
      await researchApi.rerunStage(runId, stageKey);
      toast({ title: 'Retrying', description: FRIENDLY_STAGE[stageKey] ?? stageKey });
      setReport(null);
      void load();
    } catch (e) {
      toast({ title: 'Retry failed', description: String(e), variant: 'destructive' });
    }
  };

  if (error) {
    return <FriendlyError message={error} />;
  }
  if (!run) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const stages = run.stages as StageWithOutput[];
  const phases = computePhases(stages);
  const failedStage = stages.find(s => s.status === 'failed');
  const isActive = ACTIVE.has(run.status);

  return (
    <div className="space-y-6">
      <Link
        href="/tools/industry-research"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All investigations
      </Link>

      {/* Header */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{run.industry}</div>
            <div className="text-sm text-muted-foreground">{run.geography}</div>
          </div>
          <Meta label="Status" node={<StatusBadge status={run.status} />} />
          <Meta label="Elapsed" value={fmtDuration(elapsed)} />
          <div className="min-w-[130px]">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Cost
            </div>
            <div className="text-sm font-medium">
              <CostSummary
                runId={runId}
                status={run.status}
                accruedCostUsd={run.accruedCostUsd}
                maxBudgetUsd={run.maxBudgetUsd}
                variant="inline"
              />
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            {isActive && (
              <Button variant="outline" size="sm" onClick={cancel}>
                <Ban className="mr-1 h-4 w-4" /> Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Budget paused → approve more */}
      {run.status === 'budget_exceeded' && (
        <BudgetPaused
          runId={runId}
          maxBudgetUsd={run.maxBudgetUsd}
          accruedCostUsd={run.accruedCostUsd}
          onResumed={() => {
            setReport(null);
            void load();
          }}
        />
      )}

      {/* Verification rejected */}
      {run.status === 'failed' && /VERIFICATION_REJECTED/.test(String(error ?? '')) === false && (
        <RunFailedNote
          stage={failedStage}
          onRetry={failedStage ? () => rerun(failedStage.key) : undefined}
        />
      )}

      <Tabs defaultValue={run.hasReport ? 'report' : 'progress'}>
        <TabsList>
          <TabsTrigger value="progress">Progress</TabsTrigger>
          <TabsTrigger value="report" disabled={!run.hasReport}>
            Report
          </TabsTrigger>
          <TabsTrigger value="sources" disabled={!report}>
            Sources
          </TabsTrigger>
        </TabsList>

        {/* PROGRESS — high-level phases */}
        <TabsContent value="progress" className="space-y-4">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-2.5">
              {phases.map(p => (
                <PhaseRow key={p.key} phase={p} />
              ))}
            </div>
            <ActivityFeed progress={run.progress} active={isActive} />
          </div>

          {/* Admin / technical area — collapsed by default */}
          <div className="rounded-xl border border-border">
            <button
              type="button"
              aria-expanded={adminOpen}
              onClick={() => setAdminOpen(o => !o)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Technical details
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', adminOpen && 'rotate-180')}
              />
            </button>
            {adminOpen && (
              <div className="space-y-6 border-t border-border p-4">
                <AdminStages stages={stages} onRerun={rerun} />
                <AdminFindings stages={stages} />
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Cost audit
                  </h4>
                  <CostSummary
                    runId={runId}
                    status={run.status}
                    accruedCostUsd={run.accruedCostUsd}
                    maxBudgetUsd={run.maxBudgetUsd}
                    estimateLowUsd={run.costEstimate?.lowUsd}
                    estimateHighUsd={run.costEstimate?.highUsd}
                  />
                </div>
                <AdminLogs progress={run.progress} />
              </div>
            )}
          </div>
        </TabsContent>

        {/* REPORT */}
        <TabsContent value="report">
          {report ? (
            <ReportViewer
              runId={runId}
              report={report}
              status={run.status}
              accruedCostUsd={run.accruedCostUsd}
              maxBudgetUsd={run.maxBudgetUsd}
            />
          ) : (
            <Empty>
              {run.hasReport
                ? 'Loading report…'
                : 'Your report appears here once the investigation finishes.'}
            </Empty>
          )}
        </TabsContent>

        {/* SOURCES */}
        <TabsContent value="sources">
          {report ? (
            <SourcesWorkspace sources={report.sources} evidence={report.evidence} />
          ) : (
            <Empty>Sources and evidence appear here once the report is ready.</Empty>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PhaseRow({ phase }: { phase: PhaseState }) {
  const isResearch = phase.key === 'researching';
  const icon =
    phase.status === 'complete' ? (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
        <Check className="h-3.5 w-3.5" />
      </span>
    ) : phase.status === 'active' ? (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </span>
    ) : phase.status === 'failed' ? (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" />
      </span>
    ) : (
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border text-muted-foreground/50">
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      </span>
    );

  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        phase.status === 'active' ? 'border-primary/40 bg-primary/5' : 'border-border'
      )}
    >
      <div className="flex items-center gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{phase.label}</span>
            {phase.status === 'skipped' && (
              <Badge variant="outline" className="text-[10px]">
                skipped
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{phase.blurb}</div>
        </div>
      </div>

      {/* Concurrent research streams */}
      {isResearch && phase.status !== 'pending' && (
        <div className="mt-3 space-y-1.5 pl-9">
          {phase.stages.map(s => (
            <div key={s.key} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">{RESEARCH_STREAMS[s.key] ?? s.label}</span>
              <StreamStatus status={s.status} />
            </div>
          ))}
          {phase.status === 'active' && (
            <p className="pt-1 text-xs italic text-muted-foreground">
              All three investigations run at once — the report begins once they finish.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StreamStatus({ status }: { status: string }) {
  if (status === 'completed' || status === 'fallback')
    return <span className="text-xs font-medium text-emerald-500">Complete</span>;
  if (status === 'running')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
        <Loader2 className="h-3 w-3 animate-spin" /> Running
      </span>
    );
  if (status === 'failed')
    return <span className="text-xs font-medium text-destructive">Failed</span>;
  return <span className="text-xs text-muted-foreground">Waiting</span>;
}

function BudgetPaused({
  runId,
  maxBudgetUsd,
  accruedCostUsd,
  onResumed,
}: {
  runId: string;
  maxBudgetUsd: number;
  accruedCostUsd: number;
  onResumed: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(Math.ceil(maxBudgetUsd + 3));
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    setBusy(true);
    try {
      await researchApi.raiseBudget(runId, amount);
      toast({ title: 'Budget approved', description: 'Finishing your investigation.' });
      onResumed();
    } catch (e) {
      toast({ title: 'Could not update budget', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
        <Wallet className="h-6 w-6 flex-shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">Investigation paused to protect your budget</div>
          <p className="text-sm text-muted-foreground">
            The report needs one more improvement pass, but finishing it would exceed your $
            {maxBudgetUsd.toFixed(2)} maximum (${accruedCostUsd.toFixed(2)} spent so far). Approve a
            higher maximum to complete it — we still never overspend.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">$</span>
          <Input
            type="number"
            min={Math.ceil(accruedCostUsd) + 1}
            value={amount}
            onChange={e => setAmount(Number(e.target.value))}
            className="w-24"
            aria-label="New maximum budget"
          />
          <Button onClick={approve} disabled={busy || amount <= accruedCostUsd}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Approve & continue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RunFailedNote({ stage, onRetry }: { stage?: StageInfo; onRetry?: () => void }) {
  const friendly = stage ? (FRIENDLY_STAGE[stage.key] ?? stage.label) : 'A step';
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
        <AlertTriangle className="h-6 w-6 flex-shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{friendly} couldn’t complete</div>
          <p className="text-sm text-muted-foreground">
            No report was published and no substitute data was used. You can retry this step.
          </p>
          {stage?.error && (
            <details className="mt-1 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Error details</summary>
              <code className="mt-1 block whitespace-pre-wrap break-words">{stage.error}</code>
            </details>
          )}
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-1 h-4 w-4" /> Retry this step
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function FriendlyError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
      <div className="font-medium text-destructive">We couldn’t load this investigation</div>
      <details className="mt-1 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Error details</summary>
        <code className="mt-1 block whitespace-pre-wrap break-words">{message}</code>
      </details>
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
          <p className="text-sm text-muted-foreground">Getting started…</p>
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

function AdminStages({
  stages,
  onRerun,
}: {
  stages: StageWithOutput[];
  onRerun: (k: string) => void;
}) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Stages & controls
      </h4>
      <div className="space-y-1.5">
        {stages.map(s => (
          <div
            key={s.key}
            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"
          >
            <span className="min-w-0 flex-1 truncate">
              {s.label}
              {s.provider && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {s.provider}
                  {s.model ? ` · ${s.model}` : ''}
                </span>
              )}
            </span>
            {s.durationMs != null && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {(s.durationMs / 1000).toFixed(0)}s
              </span>
            )}
            {s.costUsd ? (
              <span className="text-xs tabular-nums text-muted-foreground">
                ${s.costUsd.toFixed(2)}
              </span>
            ) : null}
            <StatusBadge status={s.status} />
            {s.status === 'failed' && (
              <Button variant="ghost" size="sm" onClick={() => onRerun(s.key)}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminFindings({ stages }: { stages: StageWithOutput[] }) {
  const items = ['primary', 'independent', 'social']
    .map(k => stages.find(s => s.key === k))
    .filter(s => (s?.output as { markdown?: string })?.markdown) as StageWithOutput[];
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Raw provider findings
      </h4>
      <div className="space-y-2">
        {items.map(s => {
          const md = (s.output as { markdown?: string }).markdown ?? '';
          return (
            <details key={s.key} className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {s.label}
                {s.provider && (
                  <span className="ml-2 text-xs text-muted-foreground">{s.provider}</span>
                )}
              </summary>
              <div className="prose prose-sm mt-2 max-w-none dark:prose-invert prose-p:text-muted-foreground">
                <ReactMarkdown>{md.slice(0, 8000)}</ReactMarkdown>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function AdminLogs({ progress }: { progress: ProgressEvent[] }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Technical log
      </h4>
      <div className="max-h-64 overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs">
        {progress.length === 0 ? (
          <span className="text-muted-foreground">No log events yet.</span>
        ) : (
          progress.map((p, i) => (
            <div key={i} className="text-muted-foreground">
              <span className="text-foreground/60">{new Date(p.ts).toLocaleTimeString()}</span> [
              {p.stage}] {p.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Meta({ label, value, node }: { label: string; value?: string; node?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
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
  return `${m}m ${sec % 60}s`;
}
