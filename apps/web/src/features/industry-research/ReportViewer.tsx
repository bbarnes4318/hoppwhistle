'use client';

import type { Claim, EvidenceSource, StructuredReport } from '@hopwhistle/shared';
import {
  ArrowUp,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Download,
  FileJson,
  FileText,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { researchApi, type ReportResponse } from './api';
import { CostSummary } from './CostSummary';
import { ExecutiveDashboard } from './ExecutiveDashboard';
import { VerdictBadge } from './StatusBadge';

async function download(runId: string, format: 'markdown' | 'json') {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const res = await fetch(researchApi.reportDownloadUrl(runId, format), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `research-${runId}.${format === 'markdown' ? 'md' : 'json'}`;
  a.click();
  URL.revokeObjectURL(url);
}

function evidenceToCsv(claims: Claim[]): string {
  const header = [
    'claimId',
    'classification',
    'category',
    'confidence',
    'materiality',
    'provider',
    'text',
  ];
  const rows = claims.map(c =>
    [
      c.claimId,
      c.classification,
      c.category,
      c.confidence,
      c.materiality,
      c.provider,
      csvCell(c.text),
    ].join(',')
  );
  return [header.join(','), ...rows].join('\n');
}

function competitorsToCsv(r: StructuredReport): string {
  const header = [
    'name',
    'targetCustomer',
    'offer',
    'pricing',
    'strengths',
    'weaknesses',
    'vulnerability',
  ];
  const rows = r.competitors.map(c =>
    [c.name, c.targetCustomer, c.offer, c.pricing, c.strengths, c.weaknesses, c.vulnerability]
      .map(x => csvCell(x ?? ''))
      .join(',')
  );
  return [header.join(','), ...rows].join('\n');
}

function csvCell(s: string): string {
  const needsQuote = /[",\n]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportViewer({
  runId,
  report,
  status = 'completed',
  accruedCostUsd = 0,
  maxBudgetUsd = 0,
}: {
  runId: string;
  report: ReportResponse;
  status?: string;
  accruedCostUsd?: number;
  maxBudgetUsd?: number;
}) {
  const r = report.structured;
  const v = r.executiveVerdict;
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToFull = () =>
    document.getElementById('full-report')?.scrollIntoView({ behavior: 'smooth' });

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return r.sections;
    return r.sections.filter(
      s => s.title.toLowerCase().includes(q) || s.markdown.toLowerCase().includes(q)
    );
  }, [r.sections, query]);

  const allCollapsed = collapsed.size >= r.sections.length && r.sections.length > 0;
  const toggleSection = (key: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const setAll = (collapse: boolean) =>
    setCollapsed(collapse ? new Set(r.sections.map(s => s.key)) : new Set());

  const evidence = useMemo(() => {
    if (classFilter === 'all') return report.evidence;
    return report.evidence.filter(c => c.classification === classFilter);
  }, [report.evidence, classFilter]);

  const classifications = useMemo(
    () => Array.from(new Set(report.evidence.map(c => c.classification))),
    [report.evidence]
  );

  return (
    <div className="space-y-6">
      {/* Executive decision dashboard — the report opens here */}
      <ExecutiveDashboard report={r} onViewFull={scrollToFull} />

      {/* Mobile contents navigator (desktop has the sticky TOC below) */}
      <details className="rounded-lg border border-border p-3 lg:hidden">
        <summary className="cursor-pointer text-sm font-medium">Jump to a section</summary>
        <ul className="mt-2 grid grid-cols-2 gap-1 text-sm">
          {r.sections.map(s => (
            <li key={s.key}>
              <a href={`#${s.key}`} className="text-primary hover:underline">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </details>

      {showTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          className="fixed bottom-6 right-6 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg hover:bg-muted"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}

      <div id="full-report" className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Sticky TOC */}
        <nav className="hidden lg:block lg:sticky lg:top-4 lg:self-start">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Contents
          </div>
          <ul className="space-y-1 text-sm">
            <li>
              <a href="#verdict" className="text-muted-foreground hover:text-foreground">
                Executive verdict
              </a>
            </li>
            {r.sections.map(s => (
              <li key={s.key}>
                <a href={`#${s.key}`} className="text-muted-foreground hover:text-foreground">
                  {s.title}
                </a>
              </li>
            ))}
            <li>
              <a href="#opportunities" className="text-muted-foreground hover:text-foreground">
                Ranked opportunities
              </a>
            </li>
            <li>
              <a href="#competitors" className="text-muted-foreground hover:text-foreground">
                Competitors
              </a>
            </li>
            <li>
              <a href="#evidence" className="text-muted-foreground hover:text-foreground">
                Evidence ledger
              </a>
            </li>
            <li>
              <a href="#sources" className="text-muted-foreground hover:text-foreground">
                Sources
              </a>
            </li>
            <li>
              <a href="#cost" className="text-muted-foreground hover:text-foreground">
                Cost &amp; provenance
              </a>
            </li>
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          {/* Export bar */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => download(runId, 'markdown')}>
              <FileText className="mr-1 h-4 w-4" /> Markdown
            </Button>
            <Button variant="outline" size="sm" onClick={() => download(runId, 'json')}>
              <FileJson className="mr-1 h-4 w-4" /> JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadText(`evidence-${runId}.csv`, evidenceToCsv(report.evidence), 'text/csv')
              }
            >
              <Download className="mr-1 h-4 w-4" /> Evidence CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadText(`competitors-${runId}.csv`, competitorsToCsv(r), 'text/csv')
              }
            >
              <Download className="mr-1 h-4 w-4" /> Competitors CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAll(!allCollapsed)}>
              {allCollapsed ? (
                <>
                  <ChevronsUpDown className="mr-1 h-4 w-4" /> Expand all
                </>
              ) : (
                <>
                  <ChevronsDownUp className="mr-1 h-4 w-4" /> Collapse all
                </>
              )}
            </Button>
            <div className="relative ml-auto">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search report…"
                className="h-9 w-48 pl-8"
              />
            </div>
          </div>

          {report.provenance && report.provenance.executionType !== 'fresh' && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <strong className="uppercase tracking-wide text-amber-600 dark:text-amber-400">
                Replay benchmark
              </strong>{' '}
              — research evidence reused from an earlier run
              {report.provenance.reusedFromRunId
                ? ` (${report.provenance.reusedFromRunId.slice(0, 8)})`
                : ''}
              . Synthesis and verification were re-run; no new Gemini/Perplexity/xAI research
              charges were incurred. This is not a fresh Full Due Diligence run.
            </div>
          )}
          <div
            className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground"
            title={
              report.synthesisModel
                ? `${report.synthesisProvider ?? ''} ${report.synthesisModel}`
                : undefined
            }
          >
            Independently researched, synthesized, and fact-checked from real, cited sources.
          </div>

          {/* Verdict card */}
          <Card id="verdict" className="scroll-mt-4 border-primary/30">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-3">
                <VerdictBadge verdict={v.verdict} />
                <CardTitle className="text-xl">
                  {r.reportMetadata.industry} — {r.reportMetadata.geography}
                </CardTitle>
                <div className="ml-auto flex items-center gap-4">
                  <ScoreRing score={v.overallScore} />
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Confidence</div>
                    <div className="font-semibold">{Math.round(v.confidence * 100)}%</div>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-base font-medium">{v.oneSentenceConclusion}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Stat label="Best segment" value={v.bestSegment} />
                <Stat label="Best customer" value={v.bestCustomer} />
                <Stat label="Best model" value={v.bestBusinessModel} />
                <Stat label="Time to revenue" value={v.timeToFirstRevenue} />
                <Stat label="Initial capital" value={v.initialCapital} />
                <Stat label="Biggest risk" value={v.biggestRisk} />
              </div>
            </CardContent>
          </Card>

          {/* Independent verification (Perplexity factual + xAI adversarial + Gemini adjudication) */}
          {report.verification && (
            <Card className="scroll-mt-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldAlert className="h-4 w-4 text-amber-500" /> Independent verification
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {report.verification.factual && (
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-medium">Factual (Perplexity)</span>
                      <VerdictChip verdict={report.verification.factual.verdict} />
                      <span className="text-xs text-muted-foreground">
                        {report.verification.factual.claimsChecked} claims checked
                      </span>
                    </div>
                    {report.verification.factual.unsupportedClaims.length > 0 && (
                      <ConcernList
                        title="Unsupported claims"
                        items={report.verification.factual.unsupportedClaims}
                        tone="warning"
                      />
                    )}
                    {report.verification.factual.blockingDefects.length > 0 && (
                      <ConcernList
                        title="Blocking defects"
                        items={report.verification.factual.blockingDefects}
                        tone="destructive"
                      />
                    )}
                  </div>
                )}
                {report.verification.adversarial && (
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-medium">Adversarial (xAI Web + X)</span>
                      <VerdictChip verdict={report.verification.adversarial.verdict} />
                      <span className="text-xs text-muted-foreground">
                        web {report.verification.adversarial.webSearchUsed ? '✓' : '✗'} · X{' '}
                        {report.verification.adversarial.xSearchUsed ? '✓' : '✗'}
                      </span>
                    </div>
                    {report.verification.adversarial.missingRisks.length > 0 && (
                      <ConcernList
                        title="Missing risks"
                        items={report.verification.adversarial.missingRisks}
                        tone="warning"
                      />
                    )}
                    {report.verification.adversarial.blockingDefects.length > 0 && (
                      <ConcernList
                        title="Blocking defects"
                        items={report.verification.adversarial.blockingDefects}
                        tone="destructive"
                      />
                    )}
                  </div>
                )}
                {report.verification.adjudication && (
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-medium">Adjudication (Gemini)</span>
                      <VerdictChip verdict={report.verification.adjudication.verdict} />
                    </div>
                    {report.verification.adjudication.resolvedFindings.length > 0 && (
                      <ConcernList
                        title="Resolved findings"
                        items={report.verification.adjudication.resolvedFindings}
                        tone="muted"
                      />
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Sections — collapsible */}
          {sections.map(s => (
            <CollapsibleSection
              key={s.key}
              id={s.key}
              title={s.title}
              markdown={s.markdown}
              collapsed={collapsed.has(s.key)}
              onToggle={() => toggleSection(s.key)}
            />
          ))}

          {/* Ranked opportunities */}
          {r.rankedOpportunities.length > 0 && (
            <section id="opportunities" className="scroll-mt-4">
              <h2 className="mb-2 text-lg font-semibold tracking-tight">
                Ranked entry opportunities
              </h2>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Opportunity</th>
                      <th className="px-3 py-2 font-medium">Customer</th>
                      <th className="px-3 py-2 font-medium">Model</th>
                      <th className="px-3 py-2 font-medium">Margin</th>
                      <th className="px-3 py-2 font-medium">To revenue</th>
                      <th className="px-3 py-2 text-right font-medium">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.rankedOpportunities.map(o => (
                      <tr key={o.rank} className="border-t border-border/60">
                        <td className="px-3 py-2 tabular-nums">{o.rank}</td>
                        <td className="px-3 py-2 font-medium">{o.opportunity}</td>
                        <td className="px-3 py-2 text-muted-foreground">{o.customer ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{o.revenueModel ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {o.grossMarginRange ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {o.timeToFirstRevenue ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {o.opportunityScore}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Unit economics */}
          {r.unitEconomicsScenarios.length > 0 && (
            <section className="scroll-mt-4">
              <h2 className="mb-2 text-lg font-semibold tracking-tight">
                Unit economics scenarios
              </h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {r.unitEconomicsScenarios.map(u => (
                  <Card key={u.name}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm capitalize">{u.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 text-xs text-muted-foreground">
                      <div>ASP: {u.asp ?? '—'}</div>
                      <div>Gross margin: {u.grossMargin ?? '—'}</div>
                      <div>CAC: {u.cac ?? '—'}</div>
                      <div>Payback: {u.paybackPeriod ?? '—'}</div>
                      {u.notes && <div className="pt-1 italic">{u.notes}</div>}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Competitors */}
          {r.competitors.length > 0 && (
            <section id="competitors" className="scroll-mt-4">
              <h2 className="mb-2 text-lg font-semibold tracking-tight">Competitors</h2>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Target</th>
                      <th className="px-3 py-2 font-medium">Pricing</th>
                      <th className="px-3 py-2 font-medium">Weaknesses</th>
                      <th className="px-3 py-2 font-medium">Vulnerability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.competitors.map(c => (
                      <tr key={c.name} className="border-t border-border/60">
                        <td className="px-3 py-2 font-medium">{c.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {c.targetCustomer ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{c.pricing ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{c.weaknesses ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {c.vulnerability ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Kill criteria */}
          {r.killCriteria.length > 0 && (
            <section className="scroll-mt-4">
              <h2 className="mb-2 text-lg font-semibold tracking-tight">Kill criteria</h2>
              <ul className="space-y-1 rounded-lg border border-border p-4 text-sm text-muted-foreground">
                {r.killCriteria.map((k, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-destructive">✕</span> {k}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Contradictions & unknowns */}
          {(r.contradictions.length > 0 || r.unknowns.length > 0) && (
            <section className="grid gap-4 sm:grid-cols-2 scroll-mt-4">
              {r.contradictions.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Contradictions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs text-muted-foreground">
                    {r.contradictions.map((c, i) => (
                      <div key={i} className="rounded border border-border p-2">
                        <div className="font-medium text-foreground">{c.topic}</div>
                        <div>A: {c.positionA}</div>
                        <div>B: {c.positionB}</div>
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          cause: {c.cause}
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              {r.unknowns.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Unknowns / gaps</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs text-muted-foreground">
                    {r.unknowns.map((u, i) => (
                      <div key={i} className="rounded border border-border p-2">
                        <div className="font-medium text-foreground">{u.topic}</div>
                        <div>{u.whyItMatters}</div>
                        <div className="italic">How to obtain: {u.howToObtain}</div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </section>
          )}

          {/* Evidence ledger */}
          <section id="evidence" className="scroll-mt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold tracking-tight">
                Evidence ledger ({report.evidence.length})
              </h2>
              <select
                value={classFilter}
                onChange={e => setClassFilter(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                aria-label="Filter by classification"
              >
                <option value="all">All classifications</option>
                {classifications.map(c => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            {evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground">No claims match this filter.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Claim</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 text-right font-medium">Conf.</th>
                      <th className="px-3 py-2 font-medium">Provider</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evidence.map((c: Claim) => (
                      <tr key={c.claimId} className="border-t border-border/60 align-top">
                        <td className="px-3 py-2">{c.text}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[10px]">
                            {c.classification.replace(/_/g, ' ')}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {Math.round(c.confidence * 100)}%
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{c.provider}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Sources */}
          <section id="sources" className="scroll-mt-4">
            <h2 className="mb-2 text-lg font-semibold tracking-tight">
              Sources ({report.sources.length})
            </h2>
            <ul className="space-y-1.5 text-sm">
              {report.sources.map((s: EvidenceSource) => (
                <li key={s.sourceId} className="flex items-start gap-2">
                  <Badge
                    variant={s.validated ? 'success' : 'outline'}
                    className="mt-0.5 flex-shrink-0 text-[10px]"
                  >
                    {s.validated ? 'validated' : 'unverified'}
                  </Badge>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="break-all text-primary hover:underline"
                  >
                    {s.title ?? s.url}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">{r.confidenceAssessment}</p>
          </section>

          {/* Cost & provenance — unified */}
          <section id="cost" className="scroll-mt-4">
            <h2 className="mb-2 text-lg font-semibold tracking-tight">Cost &amp; provenance</h2>
            <CostSummary
              runId={runId}
              status={status}
              accruedCostUsd={accruedCostUsd}
              maxBudgetUsd={maxBudgetUsd}
            />
          </section>
        </div>
      </div>
    </div>
  );
}

function CollapsibleSection({
  id,
  title,
  markdown,
  collapsed,
  onToggle,
}: {
  id: string;
  title: string;
  markdown: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`## ${title}\n\n${markdown}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <section id={id} className="scroll-mt-4">
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowUp
            className={cn(
              'h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform',
              collapsed ? 'rotate-180' : ''
            )}
          />
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        </button>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${title}`}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {copied ? <span className="text-xs">Copied</span> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      {!collapsed && (
        <div className="prose prose-sm max-w-none dark:prose-invert prose-p:text-muted-foreground prose-li:text-muted-foreground">
          <ReactMarkdown>{markdown}</ReactMarkdown>
        </div>
      )}
    </section>
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

function ScoreRing({ score }: { score: number }) {
  const tone =
    score >= 70 ? 'text-emerald-500' : score >= 45 ? 'text-amber-500' : 'text-destructive';
  return (
    <div className="text-right">
      <div className="text-xs text-muted-foreground">Score</div>
      <div className={`text-2xl font-bold tabular-nums ${tone}`}>{score}</div>
    </div>
  );
}

function VerdictChip({
  verdict,
}: {
  verdict: 'pass' | 'pass_with_caveats' | 'repair_required' | 'reject';
}) {
  const variant = verdict === 'pass' ? 'success' : verdict === 'reject' ? 'destructive' : 'warning';
  return (
    <Badge variant={variant} className="text-[10px]">
      {verdict.replace(/_/g, ' ')}
    </Badge>
  );
}

function ConcernList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'destructive' | 'warning' | 'muted';
}) {
  const color =
    tone === 'destructive'
      ? 'text-destructive'
      : tone === 'warning'
        ? 'text-amber-500'
        : 'text-muted-foreground';
  return (
    <div>
      <div className={`text-xs font-semibold uppercase tracking-wider ${color}`}>{title}</div>
      <ul className="mt-1 space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className="text-muted-foreground">
            • {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
