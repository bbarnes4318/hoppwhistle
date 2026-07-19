'use client';

import type { ResearchRunSummary } from '@hopwhistle/shared';
import {
  ArrowRight,
  FileSearch,
  Gauge,
  Loader2,
  Lock,
  Plus,
  ScanSearch,
  ShieldCheck,
  Telescope,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { researchApi } from './api';
import { StatusBadge, VerdictBadge } from './StatusBadge';

const STEPS = [
  {
    icon: FileSearch,
    title: 'Deep primary research',
    body: 'An exhaustive investigation of the market, economics, competitors, and regulation — with real citations.',
  },
  {
    icon: ScanSearch,
    title: 'Independent second opinion',
    body: 'A separate investigation that never sees the first — surfacing conflicting data, gaps, and overstated claims.',
  },
  {
    icon: Users,
    title: 'Operator & customer intelligence',
    body: 'What operators, customers, and employees actually say across the web and X — the uncomfortable realities.',
  },
  {
    icon: ShieldCheck,
    title: 'Cross-examined & verified',
    body: 'Findings are synthesized, then independently fact-checked and adversarially stress-tested before any verdict.',
  },
];

export function RunsList() {
  const [runs, setRuns] = useState<ResearchRunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    researchApi
      .listRuns()
      .then(setRuns)
      .catch(e => setError(String(e?.message ?? e)));
  }, []);

  const forbidden = !!error && /forbidden|admin access|not enabled|401|403/i.test(error);

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-muted/50 via-background to-background">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative p-8 sm:p-10">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
            <Telescope className="h-3.5 w-3.5" /> Market-entry due diligence
          </div>
          <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Should you enter this market?
            <br className="hidden sm:block" />
            <span className="text-muted-foreground"> Decide with evidence, not guesswork.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Four independent research engines investigate an industry, cross-check one another, and
            deliver a cited{' '}
            <span className="font-medium text-foreground">
              GO&nbsp;/&nbsp;CONDITIONAL&nbsp;GO&nbsp;/&nbsp;DO&nbsp;NOT&nbsp;ENTER
            </span>{' '}
            verdict — with the real economics, competitors, risks, entry wedge, and a 90-day plan.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/tools/industry-research/new">
                <Plus className="mr-1.5 h-4 w-4" /> Start a new investigation
              </Link>
            </Button>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" /> Three independent research streams run in parallel ·
              live progress · source-level evidence
            </span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          How every investigation works
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div
              key={s.title}
              className="group relative rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
            >
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <s.icon className="h-4 w-4" />
                </div>
                <span className="text-[11px] font-semibold tabular-nums text-muted-foreground/60">
                  0{i + 1}
                </span>
              </div>
              <h3 className="text-sm font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Recent investigations */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Your investigations
          </h2>
          {runs && runs.length > 0 && (
            <Button asChild variant="outline" size="sm">
              <Link href="/tools/industry-research/new">
                <Plus className="mr-1 h-4 w-4" /> New
              </Link>
            </Button>
          )}
        </div>

        {forbidden ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Lock className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">Owner or Admin access required</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  If you have an Owner or Admin role and still see this, sign out and back in to
                  refresh your session.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-destructive">
              Couldn&apos;t load your investigations. {error}
            </CardContent>
          </Card>
        ) : runs === null ? (
          <div className="grid gap-3">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg border border-border bg-muted/40"
              />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <Telescope className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-base font-semibold">No investigations yet</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  Pick an industry and market, choose a depth, and we&apos;ll build the evidence and
                  the verdict for you.
                </p>
              </div>
              <Button asChild>
                <Link href="/tools/industry-research/new">
                  Start your first investigation <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Industry</th>
                    <th className="hidden px-4 py-3 font-medium sm:table-cell">Market</th>
                    <th className="px-4 py-3 font-medium">Depth</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Verdict</th>
                    <th className="px-4 py-3 text-right font-medium">Score</th>
                    <th className="hidden px-4 py-3 text-right font-medium md:table-cell">Cost</th>
                    <th className="hidden px-4 py-3 font-medium lg:table-cell">Created</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {runs.map(r => (
                    <tr
                      key={r.id}
                      className="group border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/tools/industry-research/${r.id}`}
                            className="font-medium text-foreground hover:text-primary"
                          >
                            {r.industry}
                          </Link>
                          {r.provenance && r.provenance.executionType !== 'fresh' && (
                            <Badge
                              variant="outline"
                              className="text-[10px] uppercase tracking-wide"
                              title={
                                r.provenance.reusedFromRunId
                                  ? `Reused research from run ${r.provenance.reusedFromRunId.slice(0, 8)} — no new research charges`
                                  : 'Reused research — no new research charges'
                              }
                            >
                              {r.provenance.executionType === 'replay'
                                ? 'Replay'
                                : r.provenance.executionType.replace(/_/g, ' ')}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground sm:hidden">{r.geography}</div>
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                        {r.geography}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-[10px]">
                          {modeLabel(r.mode)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3">
                        {r.verdict ? (
                          <VerdictBadge verdict={r.verdict} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.overallScore != null ? (
                          <span
                            className={cn('font-semibold tabular-nums', scoreColor(r.overallScore))}
                          >
                            {r.overallScore}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground md:table-cell">
                        ${r.accruedCostUsd.toFixed(2)}
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                        {new Date(r.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/tools/industry-research/${r.id}`}
                          className="inline-flex items-center text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                          aria-label="Open"
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      {(runs === null || (runs && !error)) && (
        <p className="flex items-center justify-center gap-2 pb-2 text-center text-xs text-muted-foreground">
          {runs === null && <Loader2 className="h-3 w-3 animate-spin" />}
          Every claim in a report is traceable to a real source. Multiple models agreeing raises
          confidence only when their evidence is independent.
        </p>
      )}
    </div>
  );
}

function modeLabel(mode: string): string {
  return mode === 'rapid_scan' ? 'Rapid Scan' : mode === 'forensic_max' ? 'Forensic' : 'Full DD';
}

function scoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-500';
  if (score >= 45) return 'text-amber-500';
  return 'text-destructive';
}
