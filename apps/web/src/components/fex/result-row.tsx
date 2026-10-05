'use client';

/**
 * One carrier's answer -- as a row in the list, as a top-pick card, and as the
 * selected-quote bar.
 *
 * ── What a row carries ───────────────────────────────────────────────────────
 *
 * Read left to right the way an agent decides: who (logo, carrier, plan), what
 * they qualify for (class chip, Refer, Price only), how much cover, and what it
 * costs -- the premium is the largest thing on the line, with the annual
 * figure under it. "Use this quote" is the one primary action; everything else
 * is behind Details or the overflow menu.
 *
 * Opened, a row explains itself: the carrier's reasons in the order they
 * apply, each with the page it is printed on; the other classes on offer; and
 * the plan's published limits.
 */

import { BENEFIT_LABEL } from '@hopwhistle/fex-engine/catalog';
import type { QuoteLine } from '@hopwhistle/fex-engine/types';
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Info,
  Layers,
  MoreHorizontal,
  Save,
  ShieldCheck,
  X,
} from 'lucide-react';
import * as React from 'react';

import { CarrierLogo, StatusChip } from '@/components/domain';
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
  /** This row is the quote in use. */
  selected?: boolean;
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

/** The class a line is written in, as one chip. */
function ClassChip({ line }: { line: QuoteLine }): JSX.Element {
  const benefit = BENEFIT_LABEL[line.benefit] ?? line.benefit;
  // "Graded Benefit · Graded" says it twice; the class name often carries the benefit.
  const label = line.classLabel.toLowerCase().includes(benefit.toLowerCase())
    ? line.classLabel
    : `${line.classLabel} · ${benefit}`;
  return (
    <StatusChip
      value={line.benefit}
      tone={benefitTone(line.benefit)}
      size="sm"
      label={label}
      title={label}
      className="max-w-full justify-start overflow-hidden whitespace-nowrap"
    />
  );
}

function Flags({ result, priceOnly }: { result: FexResult; priceOnly: boolean }): JSX.Element {
  const tone = result.facts?.ratesStatus.tone;
  return (
    <>
      {result.refer ? <StatusChip value="REFER" tone="ringing" size="sm" label="Refer" /> : null}
      {priceOnly ? (
        <StatusChip value="PRICE_ONLY" tone="neutral" size="sm" dot={false} label="Price only" />
      ) : null}
      {(tone === 'warn' || tone === 'mod') && result.facts ? (
        <Tooltip
          content={`${result.facts.ratesStatus.label}${result.facts.sourceDate ? ` · ${result.facts.sourceDate}` : ''}`}
          side="top"
        >
          <span className="t-meta inline-flex items-center gap-1 text-ringing-ink">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            <span className="sr-only">Rates: </span>
            {result.facts.ratesStatus.label}
          </span>
        </Tooltip>
      ) : null}
    </>
  );
}

/** The premium, large, with its mode and the annual figure under it. */
function Price({ line, size = 'md' }: { line: QuoteLine; size?: 'md' | 'lg' }): JSX.Element {
  if (line.premium == null) {
    return (
      <div className={size === 'lg' ? 'text-left' : 'text-right'}>
        <p className="t-num text-base font-semibold text-ink">—</p>
        <p className="t-meta text-ink-3">{line.premiumNote ?? 'Single premium'}</p>
      </div>
    );
  }
  const annual = line.annual;
  return (
    <div className={size === 'lg' ? 'text-left' : 'text-right'}>
      <p className="whitespace-nowrap tabular-nums text-ink">
        <span
          className={cn(
            't-num font-semibold tracking-tight',
            size === 'lg' ? 'text-[34px] leading-none' : 'text-xl leading-tight'
          )}
        >
          {money(line.premium)}
        </span>
        <span className={cn('ml-0.5 text-ink-3', size === 'lg' ? 'text-base' : 'text-xs')}>
          /{MODE_SHORT[line.mode]}
        </span>
      </p>
      {annual != null && line.mode !== 'annual' ? (
        <p className="t-meta tabular-nums text-ink-3">{money(annual)} a year</p>
      ) : null}
    </div>
  );
}

function FaceValue({ line }: { line: QuoteLine }): JSX.Element {
  return (
    <p className="t-num flex items-center gap-1 text-sm font-medium tabular-nums text-ink">
      {wholeDollars(line.face)}
      {line.faceAdjusted ? (
        <Tooltip content={line.faceAdjusted} side="top" align="end">
          <Info className="h-3.5 w-3.5 text-ringing-ink" aria-label={line.faceAdjusted} />
        </Tooltip>
      ) : null}
    </p>
  );
}

function MoreMenu({
  result,
  line,
  onUse,
  onCopy,
  onSave,
  compactUse,
}: {
  result: FexResult;
  line: QuoteLine;
  onUse?: ResultRowProps['onUse'];
  onCopy?: ResultRowProps['onCopy'];
  onSave?: ResultRowProps['onSave'];
  compactUse: boolean;
}): JSX.Element | null {
  if (!onCopy && !onSave && !(onUse && compactUse)) return null;
  return (
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
        {onUse && compactUse ? (
          <DropdownMenuItem className="min-[560px]:hidden" onSelect={() => onUse(result, line)}>
            <Check className="mr-2 h-4 w-4" aria-hidden /> Use this quote
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
  );
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
  selected = false,
}: ResultRowProps): JSX.Element {
  const best = result.best;
  const declined = !result.eligible;
  const detailId = `fex-detail-${result.productId}`;

  return (
    <li
      className={cn(
        'group/row border-b border-rule transition-colors duration-150 ne-motion last:border-0',
        expanded ? 'bg-sunken/60' : 'hover:bg-sunken/40',
        selected && 'bg-brand-tint/50'
      )}
      data-product={result.productId}
    >
      <div className="flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailId}
          onClick={onToggle}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3 rounded-control text-left sm:gap-4',
            FOCUS
          )}
        >
          <CarrierLogo
            names={[result.family, result.productId]}
            size="md"
            className={cn('hidden min-[420px]:inline-flex', declined && 'opacity-50 grayscale')}
          />
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                'line-clamp-2 block text-[15px] font-semibold leading-snug',
                declined ? 'text-ink-2' : 'text-ink'
              )}
            >
              {result.family}
            </span>
            <span className="block truncate text-sm text-ink-2" title={result.product}>
              {result.product}
            </span>
            <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
              {declined ? (
                <>
                  <StatusChip
                    value="DECLINED"
                    tone="dropped"
                    size="sm"
                    label={result.outcome === 'DECLINE' ? 'Decline' : 'Not available'}
                  />
                  {result.ineligibleReason ? (
                    <span className="t-meta min-w-0 truncate text-ink-2">
                      {result.ineligibleReason}
                    </span>
                  ) : null}
                </>
              ) : best ? (
                <ClassChip line={best} />
              ) : null}
              <Flags result={result} priceOnly={priceOnly} />
              {selected ? (
                <StatusChip value="SELECTED" tone="live" size="sm" label="In use" />
              ) : null}
            </span>
          </span>

          {!declined && best ? (
            <span className="hidden w-[96px] shrink-0 text-right 2xl:block">
              <span className="t-meta block text-ink-3">Coverage</span>
              <span className="flex justify-end">
                <FaceValue line={best} />
              </span>
            </span>
          ) : null}

          {!declined && best ? (
            <span className="block w-[104px] shrink-0">
              <Price line={best} />
              <span className="t-meta block text-right text-ink-3 2xl:hidden">
                {wholeDollars(best.face)} coverage
              </span>
            </span>
          ) : null}

          <ChevronDown
            aria-hidden
            className={cn(
              'hidden h-4 w-4 shrink-0 text-ink-3 transition-transform duration-150 ne-motion motion-reduce:transition-none sm:block',
              expanded && 'rotate-180'
            )}
          />
          <span className="sr-only">{expanded ? 'Hide details' : 'Show details'}</span>
        </button>

        {!declined && best && (onUse || onCopy || onSave) ? (
          <div className="flex shrink-0 items-center gap-1">
            {onUse ? (
              <Button
                size="sm"
                disabled={busy}
                variant={selected ? 'outline' : 'default'}
                onClick={() => onUse(result, best)}
                className="hidden min-[560px]:inline-flex"
              >
                {busy ? 'Saving…' : 'Use this quote'}
              </Button>
            ) : null}
            <MoreMenu
              result={result}
              line={best}
              onUse={onUse}
              onCopy={onCopy}
              onSave={onSave}
              compactUse
            />
          </div>
        ) : null}
      </div>

      {expanded ? (
        <ResultDetail id={detailId} result={result} onUse={onUse} busy={busy} isStaff={isStaff} />
      ) : null}
    </li>
  );
}

/**
 * A top pick: the same answer as a row, laid out as a card for the three
 * options an agent will present first.
 */
export function TopPickCard({
  result,
  label,
  highlight = false,
  onUse,
  onDetails,
  busy = false,
  selected = false,
}: {
  result: FexResult;
  label: string;
  highlight?: boolean;
  onUse?: (result: FexResult, line: QuoteLine) => void;
  onDetails?: (result: FexResult) => void;
  busy?: boolean;
  selected?: boolean;
}): JSX.Element | null {
  const best = result.best;
  if (!best) return null;
  return (
    <article
      aria-label={`${label}: ${result.family} ${result.product}`}
      className={cn(
        'relative flex min-w-0 flex-col rounded-card border bg-surface p-4 shadow-card transition-shadow duration-150 ne-motion hover:shadow-raised',
        highlight ? 'border-brand ring-1 ring-brand' : 'border-rule'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col items-start gap-2">
          <span
            className={cn(
              't-label inline-flex items-center gap-1 rounded-full px-2 py-0.5',
              highlight ? 'bg-brand-tint text-brand-ink' : 'bg-sunken text-ink-2'
            )}
          >
            {highlight ? <ShieldCheck className="h-3 w-3" aria-hidden /> : null}
            {label}
          </span>
          {selected ? <StatusChip value="SELECTED" tone="live" size="sm" label="In use" /> : null}
        </div>
        <CarrierLogo names={[result.family, result.productId]} size="md" fixedWidth={false} />
      </div>

      <p className="mt-3 truncate text-base font-semibold text-ink" title={result.family}>
        {result.family}
      </p>
      <p className="truncate text-sm text-ink-2" title={result.product}>
        {result.product}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ClassChip line={best} />
        <Flags result={result} priceOnly={!result.uwLoaded} />
      </div>

      <div className="mt-auto pt-4">
        <div className="border-t border-rule pt-4">
          <Price line={best} size="lg" />
          <dl className="mt-2 flex items-baseline gap-1.5 text-sm">
            <dt className="text-ink-3">Coverage</dt>
            <dd>
              <FaceValue line={best} />
            </dd>
          </dl>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        {onUse ? (
          <Button
            className="flex-1"
            variant={selected ? 'outline' : highlight ? 'default' : 'outline'}
            disabled={busy}
            onClick={() => onUse(result, best)}
          >
            {busy ? 'Saving…' : selected ? 'Use again' : 'Use this quote'}
          </Button>
        ) : null}
        {onDetails ? (
          <Button variant="ghost" onClick={() => onDetails(result)}>
            Why
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function Section({
  icon: Icon,
  title,
  className,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section
      aria-label={title}
      className={cn('min-w-0 rounded-card border border-rule bg-surface p-4', className)}
    >
      <h4 className="t-label mb-3 flex items-center gap-1.5 text-ink-2">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {title}
      </h4>
      {children}
    </section>
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
      className="grid gap-3 px-3 pb-4 animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none sm:px-4 md:grid-cols-2"
    >
      <Section icon={ShieldCheck} title="Why this result">
        {!result.uwLoaded ? (
          <p className="mb-2 rounded-control bg-sunken px-3 py-2 text-sm text-ink-2">
            This carrier&apos;s health questions are not loaded yet; the best class is shown for
            price only.
          </p>
        ) : null}
        {result.reasons.length ? (
          <ol className="space-y-2.5">
            {result.reasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-ink">
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                    reason.outcome === 'DECLINE'
                      ? 'bg-dropped-tint text-dropped-ink'
                      : outcomeTone(reason.outcome) === 'ringing'
                        ? 'bg-ringing-tint text-ringing-ink'
                        : 'bg-live-tint text-live-ink'
                  )}
                >
                  {reason.outcome === 'DECLINE' ? (
                    <X className="h-3 w-3" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block">{reason.text}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-2">
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
                    />
                    {reason.page != null ? (
                      reason.url ? (
                        <a
                          href={reason.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            't-meta inline-flex items-center gap-0.5 text-brand-ink hover:underline',
                            FOCUS
                          )}
                        >
                          Page {reason.page}
                          <ExternalLink className="h-3 w-3" aria-hidden />
                          <span className="sr-only"> (opens the carrier document)</span>
                        </a>
                      ) : (
                        <span className="t-meta text-ink-3">Page {reason.page}</span>
                      )
                    ) : null}
                  </span>
                  {isStaff && reason.note ? (
                    <span className="t-meta mt-1 block text-ink-3">Source note: {reason.note}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        ) : result.eligible && result.uwLoaded ? (
          <p className="flex items-start gap-2 text-sm text-ink">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-live-ink" aria-hidden />
            No health question, guide rule, medication or build limit triggered — best class.
          </p>
        ) : null}
        {result.assumptions.length ? (
          <div className="mt-3 border-t border-rule pt-3">
            <h5 className="t-label mb-1 text-ink-3">Assumed</h5>
            <ul className="list-disc space-y-0.5 pl-4 text-sm text-ink-2">
              {result.assumptions.map(a => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <Section icon={Layers} title="Other options">
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
                  <td className="py-2 pr-2">
                    <span className="block font-medium text-ink">{line.classLabel}</span>
                    <span className="t-meta text-ink-3">
                      {BENEFIT_LABEL[line.benefit] ?? line.benefit} · {wholeDollars(line.face)}
                    </span>
                  </td>
                  <td className="t-num whitespace-nowrap py-2 pr-2 text-right tabular-nums">
                    {line.premium == null ? '—' : money(line.premium)}
                    <span className="t-meta text-ink-3">/{MODE_SHORT[line.mode]}</span>
                  </td>
                  <td className="py-2 text-right">
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
      </Section>

      <Section icon={BookOpen} title="Plan facts" className="md:col-span-2">
        {facts ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm lg:grid-cols-2">
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
          <div className="mt-3 border-t border-rule pt-3">
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
      </Section>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-[104px_1fr] gap-2">
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
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-brand bg-surface px-4 py-3 shadow-pop"
    >
      <CarrierLogo names={[selection.carrier, selection.productId]} size="md" />
      <div className="min-w-0 flex-1">
        <p className="t-label flex items-center gap-1 text-brand-ink">
          <Check className="h-3 w-3" aria-hidden />
          Selected
        </p>
        <p className="truncate text-sm text-ink">
          <span className="font-semibold">{selection.carrier}</span> · {selection.product} ·{' '}
          {selection.classLabel}
        </p>
        <p className="t-num text-sm tabular-nums text-ink-2">
          {wholeDollars(selection.face)} ·{' '}
          <span className="font-semibold text-ink">
            {money(selection.premium)}/{MODE_SHORT[selection.mode]}
          </span>
        </p>
        {note ? <p className="t-meta mt-0.5 text-ink-2">{note}</p> : null}
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
