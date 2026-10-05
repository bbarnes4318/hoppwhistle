'use client';

/**
 * One carrier's answer, on one line -- and, opened, why.
 *
 * The line carries what decides a sale: carrier and plan, the class and its
 * benefit, the face, and the premium, large. Opened (click, Enter or Space),
 * it shows the reasons in the order the carrier would apply them with the page
 * each comes from, the other classes the applicant qualifies for, and the
 * plan's published limits.
 */

import { BENEFIT_LABEL } from '@hopwhistle/fex-engine/catalog';
import type { QuoteLine } from '@hopwhistle/fex-engine/types';
import { ChevronDown, Copy, ExternalLink, Info, MoreHorizontal, Save } from 'lucide-react';
import * as React from 'react';

import { StatusChip } from '@/components/domain';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip } from '@/components/ui/tooltip';
import { MODE_SHORT, money, wholeDollars, type FexResult, type FexSelection } from '@/lib/fex/api';
import { cn } from '@/lib/utils';

import { benefitTone, dataTone, FOCUS, outcomeTone } from './parts';

export interface ResultRowProps {
  result: FexResult;
  expanded: boolean;
  onToggle: () => void;
  /** Absent in read-only views (history). */
  onUse?: (result: FexResult, line: QuoteLine) => void;
  onCopy?: (result: FexResult) => void;
  onSave?: (result: FexResult) => void;
  /** The line being saved right now, to disable its button. */
  busy?: boolean;
  isStaff?: boolean;
  /** Tagged "Price only" (health questions not loaded). */
  priceOnly?: boolean;
}

function feeText(fee: NonNullable<FexResult['facts']>['policyFeeAnnual']): string {
  if (fee == null) return 'Not published';
  if (typeof fee === 'number') return `${money(fee)} a year`;
  return fee
    .map(band => {
      const range =
        band.face_lt != null
          ? `under ${wholeDollars(band.face_lt)}`
          : band.face_gte != null
            ? `${wholeDollars(band.face_gte)}+`
            : 'all faces';
      return `${money(band.fee_annual)} (${range})`;
    })
    .join(' · ');
}

export function ResultRow({
  result,
  expanded,
  onToggle,
  onUse,
  onCopy,
  onSave,
  busy = false,
  isStaff = false,
  priceOnly = false,
}: ResultRowProps): JSX.Element {
  const best = result.best;
  const declined = !result.eligible;
  const detailId = `fex-detail-${result.productId}`;
  const ratesTone = result.facts?.ratesStatus.tone;
  const showRatesDot = ratesTone === 'warn' || ratesTone === 'mod';

  return (
    <li
      className={cn(
        'border-b border-rule last:border-0',
        expanded && 'bg-sunken/50',
        declined && 'text-ink-2'
      )}
      data-product={result.productId}
    >
      <div className="flex min-h-[56px] items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-controls={detailId}
          onClick={onToggle}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle();
            }
          }}
          className={cn(
            'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-control sm:gap-3',
            FOCUS
          )}
        >
          <ChevronDown
            aria-hidden
            className={cn(
              'h-4 w-4 shrink-0 text-ink-3 transition-transform duration-150 ne-motion motion-reduce:transition-none',
              expanded && 'rotate-180'
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">
              {result.family}
              <span className="font-normal text-ink-2"> · {result.product}</span>
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {declined ? (
                <StatusChip
                  value="DECLINED"
                  tone="dropped"
                  size="sm"
                  label={result.outcome === 'DECLINE' ? 'Decline' : 'Not available'}
                />
              ) : best ? (
                <StatusChip
                  value={best.benefit}
                  tone={benefitTone(best.benefit)}
                  size="sm"
                  label={`${best.classLabel} · ${BENEFIT_LABEL[best.benefit] ?? best.benefit}`}
                />
              ) : null}
              {result.refer ? (
                <StatusChip value="REFER" tone="ringing" size="sm" label="Refer" />
              ) : null}
              {priceOnly ? (
                <StatusChip
                  value="PRICE_ONLY"
                  tone="neutral"
                  size="sm"
                  dot={false}
                  label="Price only"
                />
              ) : null}
              {declined && result.ineligibleReason ? (
                <span className="t-meta min-w-0 truncate text-ink-2">
                  {result.ineligibleReason}
                </span>
              ) : null}
            </div>
          </div>

          {!declined && best ? (
            <div className="hidden shrink-0 text-right sm:block">
              <p className="t-meta text-ink-3">Face</p>
              <p className="t-num flex items-center justify-end gap-1 text-sm tabular-nums text-ink">
                {wholeDollars(best.face)}
                {best.faceAdjusted ? (
                  <Tooltip content={best.faceAdjusted} side="top" align="end">
                    <Info className="h-3.5 w-3.5 text-ink-3" aria-label={best.faceAdjusted} />
                  </Tooltip>
                ) : null}
              </p>
            </div>
          ) : null}

          {!declined && best ? (
            <div className="w-[92px] shrink-0 text-right sm:w-[104px]">
              <p className="t-num text-lg font-semibold leading-tight tabular-nums text-ink">
                {best.premium == null ? '—' : money(best.premium)}
              </p>
              <p className="t-meta flex items-center justify-end gap-1 text-ink-3">
                {showRatesDot && result.facts ? (
                  <Tooltip
                    content={`${result.facts.ratesStatus.label}${result.facts.sourceDate ? ` · ${result.facts.sourceDate}` : ''}`}
                    side="top"
                    align="end"
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full bg-ringing"
                      aria-label={result.facts.ratesStatus.label}
                      role="img"
                    />
                  </Tooltip>
                ) : null}
                {best.premium == null ? (best.premiumNote ?? 'Single premium') : best.modeLabel}
              </p>
            </div>
          ) : null}
        </div>

        {!declined && best && (onUse || onCopy || onSave) ? (
          <div className="flex shrink-0 items-center gap-1">
            {onUse ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => onUse(result, best)}
                className="hidden min-[480px]:inline-flex"
              >
                {busy ? 'Saving…' : 'Use this quote'}
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`More for ${result.family} ${result.product}`}
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onUse ? (
                  <DropdownMenuItem
                    className="min-[480px]:hidden"
                    onSelect={() => onUse(result, best)}
                  >
                    Use this quote
                  </DropdownMenuItem>
                ) : null}
                {onCopy ? (
                  <DropdownMenuItem onSelect={() => onCopy(result)}>
                    <Copy className="mr-2 h-4 w-4" aria-hidden /> Copy quote summary
                  </DropdownMenuItem>
                ) : null}
                {onSave ? (
                  <DropdownMenuItem onSelect={() => onSave(result)}>
                    <Save className="mr-2 h-4 w-4" aria-hidden /> Save quote
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>

      {expanded ? (
        <ResultDetail id={detailId} result={result} onUse={onUse} busy={busy} isStaff={isStaff} />
      ) : null}
    </li>
  );
}

function ResultDetail({
  id,
  result,
  onUse,
  busy,
  isStaff,
}: {
  id: string;
  result: FexResult;
  onUse?: ResultRowProps['onUse'];
  busy: boolean;
  isStaff: boolean;
}): JSX.Element {
  const facts = result.facts;
  return (
    <div
      id={id}
      className="grid gap-5 border-t border-rule px-4 pb-5 pt-4 animate-in fade-in-0 duration-150 motion-reduce:animate-none lg:grid-cols-3"
    >
      <section aria-label="Why this result" className="min-w-0">
        <h4 className="t-label mb-2 text-ink-3">Why this result</h4>
        {!result.uwLoaded ? (
          <p className="text-sm text-ink-2">
            This carrier&apos;s health questions are not loaded yet; the best class is shown for
            price only.
          </p>
        ) : null}
        {result.reasons.length ? (
          <ol className="space-y-2">
            {result.reasons.map((reason, i) => (
              <li key={i} className="text-sm text-ink">
                <div className="flex items-start gap-2">
                  <StatusChip
                    value={reason.outcome}
                    tone={outcomeTone(reason.outcome)}
                    size="sm"
                    dot={false}
                    label={
                      reason.outcome === 'DECLINE'
                        ? 'Decline'
                        : reason.outcome === 'REFER'
                          ? 'Refer'
                          : undefined
                    }
                    className="mt-0.5 shrink-0"
                  />
                  <span className="min-w-0">
                    {reason.text}
                    {reason.page != null ? (
                      reason.url ? (
                        <a
                          href={reason.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            't-meta ml-1.5 inline-flex items-center gap-0.5 text-brand-ink hover:underline',
                            FOCUS
                          )}
                        >
                          p.{reason.page}
                          <ExternalLink className="h-3 w-3" aria-hidden />
                          <span className="sr-only"> (opens the carrier document)</span>
                        </a>
                      ) : (
                        <span className="t-meta ml-1.5 text-ink-3">p.{reason.page}</span>
                      )
                    ) : null}
                    {isStaff && reason.note ? (
                      <span className="t-meta mt-0.5 block text-ink-3">
                        Source note: {reason.note}
                      </span>
                    ) : null}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        ) : result.eligible && result.uwLoaded ? (
          <p className="text-sm text-ink-2">
            No health question, guide rule, medication or build limit triggered — best class.
          </p>
        ) : null}
        {result.assumptions.length ? (
          <div className="mt-3">
            <h5 className="t-label mb-1 text-ink-3">Assumed</h5>
            <ul className="list-disc space-y-0.5 pl-4 text-sm text-ink-2">
              {result.assumptions.map(a => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-label="Other options" className="min-w-0">
        <h4 className="t-label mb-2 text-ink-3">Other options</h4>
        {result.others.length ? (
          <table className="w-full text-sm">
            <thead className="sr-only">
              <tr>
                <th>Class</th>
                <th>Face</th>
                <th>Premium</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {result.others.map(line => (
                <tr
                  key={`${line.classCode}-${line.payPeriod ?? ''}`}
                  className="border-b border-rule last:border-0"
                >
                  <td className="py-1.5 pr-2">
                    <span className="text-ink">{line.classLabel}</span>
                    <span className="t-meta block text-ink-3">
                      {BENEFIT_LABEL[line.benefit] ?? line.benefit}
                    </span>
                  </td>
                  <td className="t-num py-1.5 pr-2 text-right tabular-nums">
                    {wholeDollars(line.face)}
                  </td>
                  <td className="t-num py-1.5 pr-2 text-right tabular-nums">
                    {line.premium == null ? '—' : money(line.premium)}
                    <span className="t-meta text-ink-3">/{MODE_SHORT[line.mode]}</span>
                  </td>
                  <td className="py-1.5 text-right">
                    {onUse ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => onUse(result, line)}
                      >
                        Use
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-ink-2">No other class for this applicant.</p>
        )}
      </section>

      <section aria-label="Plan facts" className="min-w-0">
        <h4 className="t-label mb-2 text-ink-3">Plan facts</h4>
        {facts ? (
          <dl className="space-y-1.5 text-sm">
            <Fact label="Issue ages">{facts.issueAges.join('; ')}</Fact>
            <Fact label="Face limits">
              {facts.faceLimits
                .map(l => `${l.label} ${wholeDollars(l.min)}–${wholeDollars(l.max)}`)
                .join('; ')}
            </Fact>
            <Fact label="Policy fee">{feeText(facts.policyFeeAnnual)}</Fact>
            <Fact label="Monthly factor">
              {facts.monthlyFactor != null
                ? `${facts.monthlyFactor} (${facts.monthlyLabel ?? 'Monthly'})`
                : 'Not published'}
            </Fact>
            <Fact label="Age basis">{facts.ageBasis}</Fact>
            <Fact label="Rates">
              <StatusChip
                value="RATES"
                tone={dataTone(facts.ratesStatus.tone)}
                size="sm"
                label={facts.ratesStatus.label}
              />
              {facts.sourceDate ? (
                <span className="t-meta ml-1.5 text-ink-3">{facts.sourceDate}</span>
              ) : null}
            </Fact>
            {facts.stateUnavailable.length ? (
              <Fact label="Not sold in">{facts.stateUnavailable.join(', ')}</Fact>
            ) : null}
          </dl>
        ) : null}
        {facts?.alerts.length ? (
          <div className="mt-3">
            <h5 className="t-label mb-1 text-ink-3">Carrier notes</h5>
            <ul className="list-disc space-y-0.5 pl-4 text-sm text-ink-2">
              {facts.alerts.map(a => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {isStaff && facts?.staff ? (
          <details className="mt-3 rounded-control border border-rule p-2">
            <summary className={cn('t-label cursor-pointer text-ink-2', FOCUS)}>
              Source notes
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink-2">
              {[...facts.staff.notes, ...facts.staff.stateNotes].map(n => (
                <li key={n}>{n}</li>
              ))}
              {Object.entries(facts.staff.deathBenefitText).map(([code, text]) =>
                text ? (
                  <li key={code}>
                    {code}: {text}
                  </li>
                ) : null
              )}
            </ul>
          </details>
        ) : null}
      </section>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-[108px_1fr] gap-2">
      <dt className="t-meta pt-0.5 text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

/** The quote the agent chose, pinned under the results until it is cleared. */
export function SelectedQuoteBar({
  selection,
  onStart,
  startLabel = 'Start application',
  note,
  onClear,
}: {
  selection: FexSelection;
  onStart?: () => void;
  startLabel?: string;
  /** Shown instead of a Start button (the softphone: it prefills at disposition). */
  note?: string;
  onClear: () => void;
}): JSX.Element {
  return (
    <div
      role="status"
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule bg-surface px-4 py-3 shadow-raised"
    >
      <div className="min-w-0 flex-1">
        <p className="t-label text-ink-3">Selected</p>
        <p className="truncate text-sm text-ink">
          <span className="font-medium">{selection.carrier}</span> · {selection.product} ·{' '}
          {selection.classLabel} ·{' '}
          <span className="t-num tabular-nums">{wholeDollars(selection.face)}</span> ·{' '}
          <span className="t-num font-semibold tabular-nums">
            {money(selection.premium)}/{MODE_SHORT[selection.mode]}
          </span>
        </p>
        {note ? <p className="t-meta text-ink-2">{note}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {onStart ? (
          <Button size="sm" onClick={onStart}>
            {startLabel}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}
