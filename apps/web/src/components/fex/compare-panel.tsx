'use client';

/**
 * Two to four carriers, side by side.
 *
 * Every cell is read off the results already on screen -- the best line, the
 * appointment, the rate book, the carrier's own reasons. Nothing is inferred:
 * reasons are listed as the engine gave them, per carrier, rather than lined
 * up by condition, because the engine does not say which condition a reason
 * belongs to and guessing would put words in a carrier's mouth.
 */

import type { QuoteLine } from '@hopwhistle/fex-engine/types';
import { Check, X } from 'lucide-react';
import * as React from 'react';

import { CarrierLogo, SheetDrawer } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { MODE_SHORT, money, wholeDollars, type FexResult } from '@/lib/fex/api';
import { cn } from '@/lib/utils';

import { outcomeTone } from './parts';
import { BenefitBadge } from './result-row';

export function CompareTray({
  count,
  onOpen,
  onClear,
}: {
  count: number;
  onOpen: () => void;
  onClear: () => void;
}): JSX.Element {
  return (
    <div
      role="region"
      aria-label="Comparison"
      className="flex items-center gap-2 rounded-card border border-rule-strong bg-surface px-3 py-1.5 shadow-raised"
    >
      <p className="flex-1 text-[13px] text-ink">
        <span className="font-semibold tabular-nums">{count}</span> selected to compare
        {count < 2 ? <span className="text-ink-3"> · pick at least 2</span> : null}
      </p>
      <Button size="sm" variant="ghost" className="h-8" onClick={onClear}>
        Clear
      </Button>
      <Button size="sm" className="h-8" disabled={count < 2} onClick={onOpen}>
        Compare
      </Button>
    </div>
  );
}

export function ComparePanel({
  open,
  onOpenChange,
  results,
  selectedId,
  onUse,
  busyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: FexResult[];
  selectedId?: string | null;
  onUse?: (result: FexResult, line: QuoteLine) => void;
  busyId?: string | null;
}): JSX.Element {
  const rows: Array<{ label: string; cell: (r: FexResult) => React.ReactNode }> = [
    {
      label: 'Premium',
      cell: r =>
        r.best?.premium != null ? (
          <span className="text-[17px] font-semibold tabular-nums text-ink">
            {money(r.best.premium)}
            <span className="text-[11px] font-normal text-ink-3">/{MODE_SHORT[r.best.mode]}</span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      label: 'Annual',
      cell: r => (r.best?.annual != null ? money(r.best.annual) : '—'),
    },
    { label: 'Benefit', cell: r => (r.best ? <BenefitBadge line={r.best} /> : '—') },
    {
      label: 'Face amount',
      cell: r =>
        r.best ? (
          <span>
            {wholeDollars(r.best.face)}
            {r.best.faceAdjusted ? (
              <span className="t-meta block text-ringing-ink">{r.best.faceAdjusted}</span>
            ) : null}
          </span>
        ) : (
          '—'
        ),
    },
    { label: 'Appointed', cell: r => (r.appointed ? 'Yes' : 'No') },
    {
      label: 'Rates',
      cell: r =>
        r.facts ? (
          <span
            className={cn(
              (r.facts.ratesStatus.tone === 'warn' || r.facts.ratesStatus.tone === 'mod') &&
                'font-medium text-ringing-ink'
            )}
          >
            {r.facts.ratesStatus.label}
            {r.facts.sourceDate ? (
              <span className="t-meta block text-ink-3">{r.facts.sourceDate}</span>
            ) : null}
          </span>
        ) : (
          '—'
        ),
    },
    {
      label: 'Health questions',
      cell: r => (r.uwLoaded ? 'Underwritten' : 'Price only'),
    },
    { label: 'Refer', cell: r => (r.refer ? 'Yes' : 'No') },
    { label: 'Age basis', cell: r => `${r.ageBasis} · ${r.age}` },
    {
      label: 'Other classes',
      cell: r =>
        r.others.length
          ? r.others
              .map(o => `${o.classLabel}${o.premium != null ? ` ${money(o.premium)}` : ''}`)
              .join(' · ')
          : 'None',
    },
    {
      label: 'Why',
      cell: r =>
        r.reasons.length ? (
          <ul className="space-y-1">
            {r.reasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[12.5px] leading-[18px]">
                {reason.outcome === 'DECLINE' ? (
                  <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-dropped-ink" aria-hidden />
                ) : (
                  <Check
                    className={cn(
                      'mt-0.5 h-3.5 w-3.5 shrink-0',
                      outcomeTone(reason.outcome) === 'ringing'
                        ? 'text-ringing-ink'
                        : 'text-live-ink'
                    )}
                    aria-hidden
                  />
                )}
                <span>
                  {reason.text}
                  {reason.page != null ? (
                    <span className="text-ink-3"> · p. {reason.page}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : r.uwLoaded ? (
          <span className="text-[12.5px] text-ink-2">No rule triggered — best class.</span>
        ) : (
          <span className="text-[12.5px] text-ink-2">Health questions not loaded.</span>
        ),
    },
  ];

  return (
    <SheetDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={`Compare ${results.length} carriers`}
      description="Every figure is from the current quote."
      size="quote"
    >
      <div className="overflow-x-auto p-3">
        <table className="w-full min-w-[560px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="w-[120px]">
                <span className="sr-only">Field</span>
              </th>
              {results.map(r => (
                <th
                  key={r.productId}
                  scope="col"
                  className="border-b border-rule px-2 pb-2 text-left align-bottom font-normal"
                >
                  <CarrierLogo names={[r.family, r.productId]} size="sm" className="mb-1.5" />
                  <span className="block text-[13.5px] font-semibold leading-tight text-ink">
                    {r.product}
                  </span>
                  <span className="block text-[12px] text-ink-2">{r.family}</span>
                  {onUse && r.best ? (
                    <Button
                      size="sm"
                      className="mt-2 h-8"
                      variant={selectedId === r.productId ? 'outline' : 'default'}
                      disabled={busyId === r.productId}
                      onClick={() => onUse(r, r.best!)}
                    >
                      {selectedId === r.productId ? (
                        <>
                          <Check className="mr-1 h-3.5 w-3.5" aria-hidden /> Selected
                        </>
                      ) : (
                        'Use Quote'
                      )}
                    </Button>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.label} className="border-b border-rule last:border-0">
                <th
                  scope="row"
                  className="py-2 pr-2 text-left align-top text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-3"
                >
                  {row.label}
                </th>
                {results.map(r => (
                  <td key={r.productId} className="px-2 py-2 align-top tabular-nums text-ink">
                    {row.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SheetDrawer>
  );
}
