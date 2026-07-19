'use client';

import type { Claim, EvidenceSource, StructuredReport } from '@hopwhistle/shared';
import { Download, FileJson, FileText, Receipt, Search, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

import type { CostAudit, ReportResponse } from './api';
import { researchApi } from './api';
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

export function ReportViewer({ runId, report }: { runId: string; report: ReportResponse }) {
  const r = report.structured;
  const v = r.executiveVerdict;
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState<string>('all');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return r.sections;
    return r.sections.filter(
      s => s.title.toLowerCase().includes(q) || s.markdown.toLowerCase().includes(q)
    );
  }, [r.sections, query]);

  const evidence = useMemo(() => {
    if (classFilter === 'all') return report.evidence;
    return report.evidence.filter(c => c.classification === classFilter);
  }, [report.evidence, classFilter]);

  const classifications = useMemo(
    () => Array.from(new Set(report.evidence.map(c => c.classification))),
    [report.evidence]
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
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

        {(report.synthesisProvider || report.synthesisModel) && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            Synthesized by <strong>{report.synthesisProvider}</strong>
            {report.synthesisModel ? ` (${report.synthesisModel})` : ''} from real provider
            research.
          </div>
        )}

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

        {/* Sections */}
        {sections.map(s => (
          <section key={s.key} id={s.key} className="scroll-mt-4">
            <h2 className="mb-2 text-lg font-semibold tracking-tight">{s.title}</h2>
            <div className="prose prose-sm max-w-none dark:prose-invert prose-p:text-muted-foreground prose-li:text-muted-foreground">
              <ReactMarkdown>{s.markdown}</ReactMarkdown>
            </div>
          </section>
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
            <h2 className="mb-2 text-lg font-semibold tracking-tight">Unit economics scenarios</h2>
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
                      <td className="px-3 py-2 text-muted-foreground">{c.targetCustomer ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.pricing ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.weaknesses ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.vulnerability ?? '—'}</td>
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

        {/* Cost & provenance */}
        <CostPanel runId={runId} />
      </div>
    </div>
  );
}

const BASIS_LABEL: Record<string, string> = {
  provider_reported: 'Confirmed by provider',
  calculated_complete: 'Calculated from token usage',
  calculated_partial: 'Calculated (partial usage)',
  estimated: 'Estimated (no usage reported)',
  reused: 'Reused (no new spend)',
};

function BasisChip({ basis }: { basis: string }) {
  const variant =
    basis === 'provider_reported'
      ? 'success'
      : basis.startsWith('calculated')
        ? 'default'
        : basis === 'reused'
          ? 'outline'
          : 'warning';
  return (
    <Badge variant={variant} className="text-[10px]">
      {BASIS_LABEL[basis] ?? basis}
    </Badge>
  );
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function CostPanel({ runId }: { runId: string }) {
  const [cost, setCost] = useState<CostAudit | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    researchApi
      .getCosts(runId)
      .then(setCost)
      .catch(e => setError(String(e?.message ?? e)));
  }, [runId]);

  return (
    <section id="cost" className="scroll-mt-4">
      <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Receipt className="h-4 w-4 text-muted-foreground" /> Cost &amp; provenance
      </h2>
      {error ? (
        <p className="text-sm text-muted-foreground">Cost audit unavailable. {error}</p>
      ) : !cost ? (
        <div className="h-24 animate-pulse rounded-lg border border-border bg-muted/40" />
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-6">
            {/* Honest totals — confirmed/calculated separated from estimates */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Confirmed (provider)" value={money(cost.confirmedCostUsd)} />
              <Stat label="Calculated (tokens)" value={money(cost.calculatedCostUsd)} />
              <Stat
                label="Estimated range"
                value={`${money(cost.estimatedCostLowUsd)} – ${money(cost.estimatedCostHighUsd)}`}
              />
              <Stat
                label="Total range"
                value={`${money(cost.totalLowUsd)} – ${money(cost.totalHighUsd)}`}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Confirmed and calculated figures are actual spend. Estimates are shown only as a range
              and are never presented as actual charges. Budget cap {money(cost.maxBudgetUsd)} ·
              remaining {money(cost.budgetRemainingUsd)}.
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Stage</th>
                    <th className="px-3 py-2 font-medium">Provider</th>
                    <th className="px-3 py-2 font-medium">Basis</th>
                    <th className="px-3 py-2 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {cost.stages.map(l => (
                    <tr key={l.stage} className="border-t border-border/60">
                      <td className="px-3 py-2 font-medium">{l.stage.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.provider ?? '—'}</td>
                      <td className="px-3 py-2">
                        <BasisChip basis={l.costBasis} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.costBasis === 'estimated'
                          ? `${money(l.costLowUsd)} – ${money(l.costHighUsd)}`
                          : money(l.costUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
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
  const variant =
    verdict === 'pass' ? 'success' : verdict === 'reject' ? 'destructive' : 'warning';
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
