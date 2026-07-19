'use client';

import type { ProgressEvent, ResearchRunDetail, StageInfo } from '@hopwhistle/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useToast } from '@/components/ui/use-toast';

import { researchApi, type ReportResponse } from './api';
import { InstitutionalReport } from './InstitutionalReport';
import { computePhases, FRIENDLY_STAGE, RESEARCH_STREAMS, type PhaseState } from './phases';

const ACTIVE = new Set(['queued', 'planning', 'running', 'waiting']);
type StageWithOutput = StageInfo & { output?: unknown };

export function RunView({ runId }: { runId: string }) {
  const { toast } = useToast();
  const [run, setRun] = useState<ResearchRunDetail | null>(null);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [tab, setTab] = useState<'report' | 'progress'>('report');
  const [tech, setTech] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await researchApi.getRun(runId);
      setRun(detail);
      if (detail.hasReport && !report)
        researchApi
          .getReport(runId)
          .then(setReport)
          .catch(() => undefined);
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

  useEffect(() => {
    if (run) setTab(run.hasReport ? 'report' : 'progress');
  }, [run?.hasReport]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = async () => {
    try {
      await researchApi.cancel(runId);
      toast({ title: 'Investigation canceled' });
      void load();
    } catch (e) {
      toast({ title: 'Cancel failed', description: String(e), variant: 'destructive' });
    }
  };

  const doRerun = async (stageKey: string) => {
    try {
      await researchApi.rerunStage(runId, stageKey);
      toast({ title: 'Retrying', description: FRIENDLY_STAGE[stageKey] ?? stageKey });
      setReport(null);
      void load();
    } catch (e) {
      toast({ title: 'Retry failed', description: String(e), variant: 'destructive' });
    }
  };

  if (error && !run) return <FriendlyError message={error} />;
  if (!run) return <p className="ir-muted">Loading…</p>;

  const stages = run.stages as StageWithOutput[];
  const phases = computePhases(stages);
  const failedStage = stages.find(s => s.status === 'failed');
  const isActive = ACTIVE.has(run.status);

  return (
    <div>
      <Link
        href="/tools/industry-research"
        style={{ fontSize: 13, color: 'var(--ir-text-2)', textDecoration: 'none' }}
      >
        ← All investigations
      </Link>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          flexWrap: 'wrap',
          padding: '12px 0',
          borderBottom: '1px solid var(--ir-border)',
          marginTop: 6,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div className="ir-h2" style={{ lineHeight: 1.2 }}>
            {run.industry}
          </div>
          <div className="ir-muted" style={{ fontSize: 12 }}>
            {run.geography}
          </div>
        </div>
        <Meta label="Status" value={statusLabel(run.status)} />
        <Meta label="Elapsed" value={fmtDuration(elapsed)} />
        <Meta label="Cost" value={`$${run.accruedCostUsd.toFixed(2)} / $${run.maxBudgetUsd}`} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {isActive && (
            <button className="ir-btn" onClick={cancel}>
              Cancel
            </button>
          )}
        </div>
      </div>

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

      {run.status === 'failed' && (
        <RunFailedNote
          stage={failedStage}
          onRetry={failedStage ? () => doRerun(failedStage.key) : undefined}
        />
      )}

      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        <TabBtn active={tab === 'report'} disabled={!report} onClick={() => setTab('report')}>
          Report
        </TabBtn>
        <TabBtn active={tab === 'progress'} onClick={() => setTab('progress')}>
          Progress
        </TabBtn>
      </div>

      {tab === 'report' && report ? (
        <InstitutionalReport
          runId={runId}
          report={report}
          status={run.status}
          accruedCostUsd={run.accruedCostUsd}
          maxBudgetUsd={run.maxBudgetUsd}
        />
      ) : (
        <div className="ir-report-grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
          <div>
            {phases.map(p => (
              <PhaseRow key={p.key} phase={p} />
            ))}

            <div className="ir-panel" style={{ marginTop: 14 }}>
              <button
                onClick={() => setTech(t => !t)}
                aria-expanded={tech}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 0,
                  padding: '12px 14px',
                  cursor: 'pointer',
                  color: 'var(--ir-text-2)',
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                Technical details {tech ? '▾' : '▸'}
              </button>
              {tech && (
                <div style={{ borderTop: '1px solid var(--ir-border)', padding: 14 }}>
                  <table className="ir-table">
                    <tbody>
                      {stages.map(s => (
                        <tr key={s.key}>
                          <td>
                            {s.label}
                            {s.provider ? (
                              <span className="ir-muted" style={{ marginLeft: 8, fontSize: 11 }}>
                                {s.provider}
                                {s.model ? ` · ${s.model}` : ''}
                              </span>
                            ) : null}
                          </td>
                          <td className="ir-num ir-muted" style={{ width: 60 }}>
                            {s.durationMs != null ? `${(s.durationMs / 1000).toFixed(0)}s` : ''}
                          </td>
                          <td className="ir-num ir-muted" style={{ width: 60 }}>
                            {s.costUsd ? `$${s.costUsd.toFixed(2)}` : ''}
                          </td>
                          <td style={{ width: 90 }}>
                            <span className={`ir-status ${stageCls(s.status)}`}>
                              <span className={`ir-dot ${stageDot(s.status)}`} />
                              {s.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <aside className="ir-rail">
            <div className="ir-panel" style={{ padding: 14 }}>
              <div className="ir-eyebrow">Live activity</div>
              <ActivityFeed progress={run.progress} />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function PhaseRow({ phase }: { phase: PhaseState }) {
  const isResearch = phase.key === 'researching';
  const mark =
    phase.status === 'complete'
      ? { c: 'ir-pos', s: '✓' }
      : phase.status === 'active'
        ? { c: 'ir-info', s: '●' }
        : phase.status === 'failed'
          ? { c: 'ir-neg', s: '✕' }
          : { c: 'ir-muted', s: '○' };
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '14px 16px',
        border: '1px solid var(--ir-border)',
        borderRadius: 5,
        marginBottom: 8,
        background: phase.status === 'active' ? 'var(--ir-surface)' : 'transparent',
      }}
    >
      <span className={mark.c} style={{ fontWeight: 700, width: 16 }}>
        {mark.s}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{phase.label}</span>
          {phase.status === 'skipped' && (
            <span className="ir-muted" style={{ fontSize: 11 }}>
              skipped
            </span>
          )}
        </div>
        <div className="ir-muted" style={{ fontSize: 12 }}>
          {phase.blurb}
        </div>
        {isResearch && phase.status !== 'pending' && (
          <div style={{ marginTop: 8 }}>
            {phase.stages.map(s => (
              <div
                key={s.key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  padding: '2px 0',
                }}
              >
                <span className="ir-muted">{RESEARCH_STREAMS[s.key] ?? s.label}</span>
                <span className={stageCls(s.status)} style={{ fontWeight: 600, fontSize: 12 }}>
                  {s.status === 'completed' || s.status === 'fallback'
                    ? 'Complete'
                    : s.status === 'running'
                      ? 'Running'
                      : s.status === 'failed'
                        ? 'Failed'
                        : 'Waiting'}
                </span>
              </div>
            ))}
            {phase.status === 'active' && (
              <p className="ir-muted" style={{ fontSize: 12, marginTop: 4, fontStyle: 'italic' }}>
                All three investigations run at once — the report begins once they finish.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityFeed({ progress }: { progress: ProgressEvent[] }) {
  const recent = [...progress].slice(-14).reverse();
  if (recent.length === 0)
    return (
      <p className="ir-muted" style={{ fontSize: 13, marginTop: 8 }}>
        Getting started…
      </p>
    );
  return (
    <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
      {recent.map((p, i) => (
        <li key={i} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '2px 0' }}>
          <span className="ir-muted ir-num">{new Date(p.ts).toLocaleTimeString()}</span>
          <span style={{ color: 'var(--ir-text-2)' }}>{p.message}</span>
        </li>
      ))}
    </ul>
  );
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
  return (
    <div
      className="ir-panel"
      style={{
        borderColor: 'var(--ir-warning)',
        padding: 16,
        marginTop: 14,
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 220 }}>
        <div className="ir-h3">Investigation paused to protect your budget</div>
        <p className="ir-muted" style={{ fontSize: 13, marginTop: 4 }}>
          The report needs one improvement pass, but finishing it would exceed your $
          {maxBudgetUsd.toFixed(2)} maximum (${accruedCostUsd.toFixed(2)} spent). Approve a higher
          maximum to complete it — we never overspend.
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="ir-muted">$</span>
        <input
          className="ir-field"
          type="number"
          min={Math.ceil(accruedCostUsd) + 1}
          value={amount}
          onChange={e => setAmount(Number(e.target.value))}
          style={{ width: 90 }}
          aria-label="New maximum budget"
        />
        <button
          className="ir-btn ir-btn-primary"
          disabled={busy || amount <= accruedCostUsd}
          onClick={async () => {
            setBusy(true);
            try {
              await researchApi.raiseBudget(runId, amount);
              toast({ title: 'Budget approved', description: 'Finishing your investigation.' });
              onResumed();
            } catch (e) {
              toast({
                title: 'Could not update budget',
                description: String(e),
                variant: 'destructive',
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          Approve &amp; continue
        </button>
      </div>
    </div>
  );
}

function RunFailedNote({ stage, onRetry }: { stage?: StageInfo; onRetry?: () => void }) {
  const friendly = stage ? (FRIENDLY_STAGE[stage.key] ?? stage.label) : 'A step';
  return (
    <div
      className="ir-panel"
      style={{
        borderColor: 'var(--ir-negative)',
        padding: 16,
        marginTop: 14,
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 220 }}>
        <div className="ir-h3">{friendly} couldn’t complete</div>
        <p className="ir-muted" style={{ fontSize: 13, marginTop: 4 }}>
          No report was published and no substitute data was used.
        </p>
        {stage?.error && (
          <details style={{ marginTop: 6, fontSize: 12 }}>
            <summary className="ir-muted" style={{ cursor: 'pointer' }}>
              Error details
            </summary>
            <code
              style={{
                display: 'block',
                marginTop: 4,
                whiteSpace: 'pre-wrap',
                color: 'var(--ir-text-2)',
              }}
            >
              {stage.error}
            </code>
          </details>
        )}
      </div>
      {onRetry && (
        <button className="ir-btn" onClick={onRetry}>
          Retry this step
        </button>
      )}
    </div>
  );
}

function FriendlyError({ message }: { message: string }) {
  return (
    <div className="ir-panel" style={{ padding: 16, borderColor: 'var(--ir-negative)' }}>
      <div className="ir-h3 ir-neg">We couldn’t load this investigation</div>
      <details style={{ marginTop: 6, fontSize: 12 }}>
        <summary className="ir-muted" style={{ cursor: 'pointer' }}>
          Error details
        </summary>
        <code
          style={{
            display: 'block',
            marginTop: 4,
            whiteSpace: 'pre-wrap',
            color: 'var(--ir-text-2)',
          }}
        >
          {message}
        </code>
      </details>
    </div>
  );
}

function TabBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 34,
        padding: '0 14px',
        borderRadius: 4,
        border: '1px solid var(--ir-border)',
        background: active ? 'var(--ir-accent)' : 'var(--ir-surface)',
        color: active ? '#fff' : disabled ? 'var(--ir-text-3)' : 'var(--ir-text)',
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="ir-strip-label">{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function stageCls(s: string): string {
  if (s === 'completed' || s === 'fallback') return 'ir-pos';
  if (s === 'running') return 'ir-info';
  if (s === 'failed') return 'ir-neg';
  return 'ir-muted';
}
function stageDot(s: string): string {
  if (s === 'completed' || s === 'fallback') return 'ir-dot-pos';
  if (s === 'running') return 'ir-dot-warn';
  if (s === 'failed') return 'ir-dot-neg';
  return 'ir-dot-muted';
}
function statusLabel(s: string): string {
  const m: Record<string, string> = {
    completed: 'Completed',
    failed: 'Failed',
    budget_exceeded: 'Paused — budget',
    running: 'In progress',
    queued: 'Queued',
    planning: 'Planning',
    waiting: 'Waiting',
    canceled: 'Canceled',
  };
  return m[s] ?? s;
}
function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}
