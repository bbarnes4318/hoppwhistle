'use client';

import { ChevronDown, Receipt } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { researchApi, type CostAudit } from './api';

function money(n: number): string {
  return `$${(n ?? 0).toFixed(2)}`;
}

const BASIS_LABEL: Record<string, string> = {
  provider_reported: 'Provider-confirmed',
  calculated_complete: 'Calculated (complete)',
  calculated_partial: 'Calculated (partial)',
  estimated: 'Estimated',
  reused: 'Reused',
};

/**
 * The ONE cost component used in the run header, the run list, the live page, and
 * the report. Active runs show confirmed-so-far vs estimated-remaining vs the hard
 * maximum; completed runs show a single total with an expandable honest breakdown.
 */
export function CostSummary({
  runId,
  status,
  accruedCostUsd,
  maxBudgetUsd,
  estimateLowUsd,
  estimateHighUsd,
  variant = 'panel',
}: {
  runId: string;
  status: string;
  accruedCostUsd: number;
  maxBudgetUsd: number;
  estimateLowUsd?: number;
  estimateHighUsd?: number;
  variant?: 'panel' | 'inline';
}) {
  const active = ['queued', 'planning', 'running', 'waiting'].includes(status);
  const [audit, setAudit] = useState<CostAudit | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Only the completed/expandable breakdown needs the full audit.
    if (active) return;
    researchApi
      .getCosts(runId)
      .then(setAudit)
      .catch(() => undefined);
  }, [runId, active]);

  // Estimated remaining band for active runs (never below zero, never over cap).
  const remainingLow = Math.max(0, (estimateLowUsd ?? accruedCostUsd) - accruedCostUsd);
  const remainingHigh = Math.max(
    remainingLow,
    Math.min(maxBudgetUsd, estimateHighUsd ?? maxBudgetUsd) - accruedCostUsd
  );

  if (variant === 'inline') {
    return (
      <span className="tabular-nums">
        {active
          ? `${money(accruedCostUsd)} spent · ${money(maxBudgetUsd)} max`
          : money(audit ? audit.totalHighUsd : accruedCostUsd)}
      </span>
    );
  }

  return (
    <div className="rounded-xl border border-border">
      <div className="grid gap-3 p-4 sm:grid-cols-3">
        {active ? (
          <>
            <Stat label="Confirmed so far" value={money(accruedCostUsd)} />
            <Stat
              label="Estimated remaining"
              value={`${money(remainingLow)}–${money(remainingHigh)}`}
            />
            <Stat label="Maximum authorized" value={money(maxBudgetUsd)} strong />
          </>
        ) : (
          <>
            <Stat label="Total" value={money(audit ? audit.totalHighUsd : accruedCostUsd)} strong />
            <Stat label="Provider-confirmed" value={money(audit?.confirmedCostUsd ?? 0)} />
            <Stat label="Maximum authorized" value={money(maxBudgetUsd)} />
          </>
        )}
      </div>

      {!active && audit && (
        <div className="border-t border-border">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="inline-flex items-center gap-1.5">
              <Receipt className="h-3.5 w-3.5" /> Cost breakdown & provenance
            </span>
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </button>
          {open && (
            <div className="space-y-3 px-4 pb-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Mini label="Provider-confirmed" value={money(audit.confirmedCostUsd)} />
                <Mini label="Calculated (complete)" value={money(audit.calculatedCostUsd)} />
                <Mini
                  label="Estimated range"
                  value={`${money(audit.estimatedCostLowUsd)}–${money(audit.estimatedCostHighUsd)}`}
                />
                {audit.reusedStageCount > 0 && (
                  <Mini label="Reused" value={`${audit.reusedStageCount} stages · $0`} />
                )}
                {audit.repairOutcome && (
                  <Mini label="Repair" value={money(audit.repairOutcome.repairCostUsd)} />
                )}
                {audit.cacheSavingsUsd > 0 && (
                  <Mini label="Cache saved" value={money(audit.cacheSavingsUsd)} />
                )}
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Provider-confirmed charges are authoritative. Calculated charges are based on the
                usage and pricing available to the app; partial calculations are labeled separately.
                Estimates are shown only as a range and never as actual spend.
              </p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <tbody>
                    {audit.stages.map(l => (
                      <tr key={l.stage} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-1.5 font-medium">{l.stage.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant="outline" className="text-[10px]">
                            {BASIS_LABEL[l.costBasis] ?? l.costBasis}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {l.costBasis === 'estimated'
                            ? `${money(l.costLowUsd)}–${money(l.costHighUsd)}`
                            : money(l.costUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn('tabular-nums', strong ? 'text-lg font-semibold' : 'text-base font-medium')}
      >
        {value}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xs font-medium tabular-nums">{value}</div>
    </div>
  );
}
