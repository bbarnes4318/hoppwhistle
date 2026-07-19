'use client';

import type { StructuredReport } from '@hopwhistle/shared';
import { ArrowDown, Ban, Clock, DollarSign, ThumbsDown, ThumbsUp, Trophy } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { VerdictBadge } from './StatusBadge';

/**
 * A highly visual, at-a-glance decision dashboard shown ABOVE the full forensic
 * report. Everything here is derived from the structured report — no new data.
 */
export function ExecutiveDashboard({
  report,
  onViewFull,
}: {
  report: StructuredReport;
  onViewFull: () => void;
}) {
  const v = report.executiveVerdict;
  const top = report.rankedOpportunities[0];
  const base = report.unitEconomicsScenarios.find(s => s.name === 'base');

  const reasonsFor = [
    v.biggestOpportunity,
    ...report.rankedOpportunities.slice(0, 2).map(o => o.opportunity),
  ]
    .filter(Boolean)
    .slice(0, 3);
  const reasonsAgainst = [v.biggestRisk, ...report.killCriteria.slice(0, 2)]
    .filter(Boolean)
    .slice(0, 3);

  const scoreTone =
    v.overallScore >= 70
      ? 'text-emerald-500'
      : v.overallScore >= 45
        ? 'text-amber-500'
        : 'text-destructive';

  return (
    <div className="space-y-5">
      {/* Verdict hero */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 via-background to-background p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-4">
          <VerdictBadge verdict={v.verdict} />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight">
              {report.reportMetadata.industry}
            </h1>
            <p className="text-sm text-muted-foreground">{report.reportMetadata.geography}</p>
          </div>
          <div className="ml-auto text-right">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Score</div>
            <div className={cn('text-4xl font-bold tabular-nums', scoreTone)}>
              {v.overallScore}
              <span className="text-lg text-muted-foreground">/100</span>
            </div>
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-base font-medium">{v.oneSentenceConclusion}</p>
      </div>

      {/* Best opportunity + reasons */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border p-5 lg:col-span-1">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Trophy className="h-4 w-4 text-primary" /> Best entry opportunity
          </div>
          <div className="text-base font-semibold">{top?.opportunity ?? v.biggestOpportunity}</div>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="Target customer" value={top?.customer ?? v.bestCustomer} />
            <Row label="Offer" value={top?.offer ?? v.bestBusinessModel} />
            <Row label="Price" value={top?.price} />
            <Row
              label="Time to first revenue"
              value={top?.timeToFirstRevenue ?? v.timeToFirstRevenue}
            />
          </dl>
        </div>

        <div className="rounded-xl border border-border p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            <ThumbsUp className="h-4 w-4" /> Strongest reasons to enter
          </div>
          <ol className="space-y-2">
            {reasonsFor.map((r, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="font-semibold text-emerald-500">{i + 1}</span>
                <span>{r}</span>
              </li>
            ))}
            {reasonsFor.length === 0 && <li className="text-sm text-muted-foreground">—</li>}
          </ol>
        </div>

        <div className="rounded-xl border border-border p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-destructive">
            <ThumbsDown className="h-4 w-4" /> Strongest reasons not to
          </div>
          <ol className="space-y-2">
            {reasonsAgainst.map((r, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="font-semibold text-destructive">{i + 1}</span>
                <span>{r}</span>
              </li>
            ))}
            {reasonsAgainst.length === 0 && <li className="text-sm text-muted-foreground">—</li>}
          </ol>
        </div>
      </div>

      {/* Economics snapshot */}
      <div className="rounded-xl border border-border p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <DollarSign className="h-4 w-4 text-primary" /> Economics snapshot
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Econ label="Startup capital" value={v.initialCapital} />
          <Econ label="Gross margin" value={base?.grossMargin} />
          <Econ label="CAC" value={base?.cac} />
          <Econ label="Payback" value={base?.paybackPeriod} />
          <Econ label="To first revenue" value={v.timeToFirstRevenue} />
        </div>
      </div>

      {/* First move + 30/60/90 */}
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Clock className="h-4 w-4 text-primary" /> Recommended first move
          </div>
          <p className="text-sm">
            {top
              ? `Start with ${v.bestSegment}: ${top.opportunity}.`
              : `Focus on ${v.bestSegment} — ${v.biggestOpportunity}.`}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['Days 1–30', 'Days 31–60', 'Days 61–90'].map((t, i) => (
            <div key={t} className="rounded-lg border border-border p-3 text-center">
              <div className="text-xs font-semibold">{t}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {['Validate & first customers', 'Build repeatable sales', 'Scale what works'][i]}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Kill criteria — highly visible */}
      {report.killCriteria.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-destructive">
            <Ban className="h-4 w-4" /> Kill criteria — walk away if
          </div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {report.killCriteria.map((k, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="text-destructive">✕</span>
                {k}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-center">
        <Button variant="outline" onClick={onViewFull}>
          View complete forensic report <ArrowDown className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function Econ({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value ?? '—'}</div>
    </div>
  );
}
