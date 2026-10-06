'use client';

/**
 * One carrier's answer, as a card -- the quoter's results are a set of
 * recommendations, not a table.
 *
 * Three weights, so the list has a shape an agent reads in one glance:
 *
 *   hero  -- the first result: a large card with a 150px logo plate, the
 *            recommendation spelled out, and the only solid Use Quote.
 *   pick  -- the next two, side by side: the runners-up, a logo plate, the
 *            plan, the benefit, the price and a quiet outlined Use Quote.
 *   quiet -- everything else: one calm line of its own card, logo, plan,
 *            benefit, price, and "Use quote" as a text action.
 *
 * Every card has the same four zones -- carrier brand, product and benefit,
 * price, action -- and opens in place to the same detail the rows had: the
 * reasons, pricing, other classes, published limits, copy, save, compare.
 */

import type { QuoteLine } from '@hopwhistle/fex-engine/types';
import { Check, ChevronDown } from 'lucide-react';
import * as React from 'react';

import { CarrierLogo } from '@/components/domain';
import { Button } from '@/components/ui/button';
import type { FexResult } from '@/lib/fex/api';
import type { OutcomeChange } from '@/lib/fex/outcome-diff';
import { cn } from '@/lib/utils';

import { FOCUS } from './parts';
import {
  BenefitBadge,
  materialNote,
  Price,
  RateVerify,
  ResultDetail,
  StatusNote,
} from './result-row';

export type ResultCardVariant = 'hero' | 'pick' | 'quiet';

export interface ResultCardProps {
  variant: ResultCardVariant;
  result: FexResult;
  /** "#2", "Best price", ...: what the card is, said above the plan. */
  labels?: string[];
  expanded: boolean;
  onToggle: () => void;
  onUse?: (result: FexResult, line: QuoteLine) => void;
  onCopy?: (result: FexResult) => void;
  onSave?: (result: FexResult) => void;
  busy?: boolean;
  isStaff?: boolean;
  priceOnly?: boolean;
  selected?: boolean;
  compared?: boolean;
  onCompareToggle?: () => void;
  compareFull?: boolean;
  comparing?: boolean;
  change?: OutcomeChange;
  healthSubject?: string | null;
}

export function ResultCard({
  variant,
  result,
  labels = [],
  expanded,
  onToggle,
  onUse,
  onCopy,
  onSave,
  busy = false,
  isStaff = false,
  priceOnly = false,
  selected = false,
  compared = false,
  onCompareToggle,
  compareFull = false,
  comparing = false,
  change,
  healthSubject,
}: ResultCardProps): JSX.Element {
  const best = result.best;
  const declined = !result.eligible;
  const detailId = `fex-detail-${result.productId}`;
  const note = declined ? null : materialNote(result, healthSubject);
  const canCompare = Boolean(onCompareToggle) && !declined && Boolean(best);
  const hero = variant === 'hero';
  const pick = variant === 'pick';
  const quiet = variant === 'quiet';

  const compareBox = canCompare ? (
    <label
      className={cn(
        'relative z-[1] inline-flex cursor-pointer items-center gap-1.5 rounded-control px-1.5 py-1 text-[12px] font-medium text-ink-3 transition-opacity duration-150 ne-motion hover:text-ink',
        compared || comparing
          ? 'opacity-100'
          : 'opacity-0 focus-within:opacity-100 group-hover/card:opacity-100 [@media(hover:none)]:opacity-100',
        compareFull && !compared && 'cursor-not-allowed'
      )}
      title={compareFull && !compared ? 'Compare up to 4' : 'Add to comparison (C)'}
    >
      <input
        type="checkbox"
        checked={compared}
        disabled={compareFull && !compared}
        onChange={onCompareToggle}
        aria-label={`Add ${result.family} ${result.product} to comparison`}
        className={cn('h-3.5 w-3.5 cursor-pointer accent-[var(--brand-strong)]', FOCUS)}
      />
      <span aria-hidden>Compare</span>
    </label>
  ) : null;

  const label = labels.length ? (
    <span
      className={cn(
        'flex items-center gap-1.5 text-[10.5px] font-semibold uppercase leading-4 tracking-[0.08em]',
        hero ? 'text-live-ink' : 'text-ink-2'
      )}
    >
      {labels.map((text, i) => (
        <React.Fragment key={text}>
          {i > 0 ? (
            <span aria-hidden className="text-ink-3">
              ·
            </span>
          ) : null}
          <span>{text}</span>
        </React.Fragment>
      ))}
    </span>
  ) : null;

  const action =
    onUse && !declined && best ? (
      quiet ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onUse(result, best)}
          className={cn(
            'relative z-[1] inline-flex h-8 shrink-0 items-center gap-1 rounded-control px-2.5 text-[13px] font-semibold transition-colors duration-150 ne-motion disabled:opacity-60',
            selected
              ? 'text-live-ink'
              : 'text-brand-ink hover:bg-brand-tint group-hover/card:bg-brand-tint',
            FOCUS
          )}
        >
          {busy ? (
            'Saving…'
          ) : selected ? (
            <>
              <Check className="h-3.5 w-3.5" aria-hidden />
              Selected
            </>
          ) : (
            'Use Quote'
          )}
        </button>
      ) : (
        <Button
          size="sm"
          disabled={busy}
          variant={hero && !selected ? 'default' : 'outline'}
          onClick={() => onUse(result, best)}
          className={cn(
            'relative z-[1] shrink-0 font-semibold',
            hero ? 'h-10 w-[124px] text-[14px]' : 'h-[34px] w-[104px] text-[13px]',
            selected
              ? 'border-live text-live-ink shadow-none hover:bg-live-tint hover:text-live-ink'
              : !hero &&
                  'border-rule bg-surface text-brand-ink shadow-none hover:border-brand-ink hover:bg-brand-tint hover:text-brand-ink'
          )}
        >
          {busy ? (
            'Saving…'
          ) : selected ? (
            <>
              <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
              Selected
            </>
          ) : (
            'Use Quote'
          )}
        </Button>
      )
    ) : null;

  const benefit = declined ? (
    <span className="flex min-w-0 items-center gap-2">
      <span className="inline-flex h-[18px] shrink-0 items-center rounded-[4px] bg-dropped-tint px-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-dropped-ink">
        {result.outcome === 'DECLINE' ? 'Declined' : 'Not available'}
      </span>
      {result.ineligibleReason ? (
        <span className="min-w-0 truncate text-[12px] text-ink-2" title={result.ineligibleReason}>
          {result.ineligibleReason}
        </span>
      ) : null}
    </span>
  ) : best ? (
    <span className="flex min-w-0 items-center gap-2">
      <BenefitBadge line={best} className="max-w-full" />
      <StatusNote note={note} priceOnly={priceOnly} change={change} />
    </span>
  ) : null;

  const toggle = (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={detailId}
      onClick={onToggle}
      data-row-toggle=""
      className={cn(
        // The hit area is stretched over the whole card; the compare box and
        // the Use Quote action sit above it.
        "absolute inset-0 z-0 cursor-pointer rounded-[inherit] after:content-['']",
        'focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--brand-ink)]'
      )}
    >
      <span className="sr-only">
        {result.family} {result.product}: {expanded ? 'hide details' : 'show details'}
      </span>
    </button>
  );

  const chevron = (
    <ChevronDown
      aria-hidden
      className={cn(
        'h-4 w-4 shrink-0 text-ink-3 transition-transform duration-150 ne-motion motion-reduce:transition-none',
        expanded && 'rotate-180'
      )}
    />
  );

  const logo = (size: string) => (
    <CarrierLogo
      names={[result.family, result.productId]}
      size="row"
      className={cn(size, declined && 'opacity-50 grayscale')}
    />
  );

  const name = (cls: string) => (
    <span className={cn('block truncate font-semibold text-ink', cls)} title={result.product}>
      {result.product}
    </span>
  );

  let body: React.ReactNode;
  if (hero) {
    body = (
      <div className="px-5 pb-3.5 pt-3">
        <div className="mb-2 flex min-h-[24px] items-center justify-between gap-3">
          {label ?? <span />}
          <span className="flex items-center gap-2">
            {compareBox}
            {chevron}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4 cq-md:flex-nowrap">
          {logo('hidden h-[64px] w-[150px] [@container(min-width:520px)]:inline-flex')}
          <div className="min-w-0 flex-1">
            {name('text-[18px] leading-6')}
            <span className="mt-0.5 block truncate text-[13px] text-ink-2">{result.family}</span>
            <span className="mt-2.5 block">{benefit}</span>
          </div>
          {!declined && best ? (
            <div className="flex shrink-0 flex-col items-end">
              <Price line={best} size={17} />
              <RateVerify result={result} />
            </div>
          ) : null}
          {action}
        </div>
      </div>
    );
  } else if (pick) {
    body = (
      <div className="px-4 pb-3 pt-3">
        <div className="flex min-w-0 items-start gap-4">
          {logo('hidden h-[50px] w-[130px] [@container(min-width:340px)]:inline-flex')}
          <div className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              {label ?? <span />}
              <span className="-mr-1 -mt-0.5 flex items-center gap-1">
                {compareBox}
                {chevron}
              </span>
            </span>
            {name('text-[15px] leading-5')}
            <span className="block truncate text-[12px] leading-4 text-ink-2">{result.family}</span>
          </div>
        </div>
        <div className="mt-3 flex min-w-0 items-center justify-between gap-3">
          <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
            {declined ? benefit : best ? <BenefitBadge line={best} className="max-w-full" /> : null}
            <StatusNote note={note} priceOnly={priceOnly} change={change} separator={false} />
          </span>
          <span className="flex shrink-0 items-center gap-3.5">
            {!declined && best ? (
              <span className="flex flex-col items-end">
                <Price line={best} size={16} />
                <RateVerify result={result} />
              </span>
            ) : null}
            {action}
          </span>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="flex items-center gap-4 py-2 pl-4 pr-3">
        {logo('hidden h-[46px] w-[130px] [@container(min-width:480px)]:inline-flex')}
        <div className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            {name('min-w-0 text-[15px] leading-5')}
            {label ? <span className="shrink-0">{label}</span> : null}
          </span>
          <span className="block truncate text-[12px] leading-4 text-ink-2">{result.family}</span>
          <span className="mt-1.5 block">{benefit}</span>
        </div>
        {!declined && best ? (
          <span className="flex shrink-0 flex-col items-end">
            <Price line={best} size={16} />
            <RateVerify result={result} />
          </span>
        ) : null}
        <span className="flex shrink-0 items-center gap-1">
          {action}
          {compareBox}
          {chevron}
        </span>
      </div>
    );
  }

  return (
    <li
      className={cn(
        'cq group/card relative overflow-visible border bg-surface transition-[box-shadow,border-color] duration-150 ne-motion',
        hero
          ? 'rounded-[14px] border-rule shadow-raised [box-shadow:inset_4px_0_0_var(--live),var(--shadow-raised)]'
          : 'rounded-card border-rule shadow-card hover:border-rule-strong',
        pick && 'h-fit',
        selected && 'border-live bg-[#fbfdfc]'
      )}
      data-product={result.productId}
      data-selected={selected ? '' : undefined}
      data-recommended={hero ? '' : undefined}
    >
      <div className="relative">
        {toggle}
        <div className="pointer-events-none relative [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto [&_label]:pointer-events-auto [&_.ne-tooltip]:pointer-events-auto">
          {body}
        </div>
      </div>
      {expanded ? (
        <ResultDetail
          id={detailId}
          result={result}
          onUse={onUse}
          onCopy={onCopy}
          onSave={onSave}
          busy={busy}
          isStaff={isStaff}
          selected={selected}
          compared={compared}
          onCompareToggle={canCompare ? onCompareToggle : undefined}
          compareFull={compareFull}
          indent="none"
        />
      ) : null}
    </li>
  );
}
