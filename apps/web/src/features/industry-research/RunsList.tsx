'use client';

import type { ResearchRunSummary } from '@hopwhistle/shared';
import { Loader2, Plus, Telescope } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import { researchApi } from './api';
import { StatusBadge, VerdictBadge } from './StatusBadge';

export function RunsList() {
  const [runs, setRuns] = useState<ResearchRunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    researchApi
      .listRuns()
      .then(setRuns)
      .catch(e => setError(String(e)));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Telescope className="h-6 w-6 text-primary" /> Industry Research
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Forensic, multi-provider industry-entry research. Each run launches an independent
            primary investigation, a second opinion, social/practitioner intelligence, a synthesis
            model, and an adversarial verifier — then produces a cited GO / CONDITIONAL GO / DO NOT
            ENTER report.
          </p>
        </div>
        <Button asChild>
          <Link href="/tools/industry-research/new">
            <Plus className="mr-1 h-4 w-4" /> New research
          </Link>
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {runs === null && !error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading runs…
        </div>
      )}

      {runs && runs.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Telescope className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="font-medium">No research yet</p>
              <p className="text-sm text-muted-foreground">
                Start your first industry-entry investigation.
              </p>
            </div>
            <Button asChild>
              <Link href="/tools/industry-research/new">
                <Plus className="mr-1 h-4 w-4" /> New research
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {runs && runs.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Industry</th>
                  <th className="px-4 py-3 font-medium">Market</th>
                  <th className="px-4 py-3 font-medium">Mode</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Verdict</th>
                  <th className="px-4 py-3 text-right font-medium">Score</th>
                  <th className="px-4 py-3 text-right font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr
                    key={r.id}
                    className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/tools/industry-research/${r.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.industry}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.geography}</td>
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
                    <td className="px-4 py-3 text-right tabular-nums">{r.overallScore ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      ${r.accruedCostUsd.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function modeLabel(mode: string): string {
  return mode === 'rapid_scan'
    ? 'Rapid Scan'
    : mode === 'forensic_max'
      ? 'Forensic Max'
      : 'Full DD';
}
