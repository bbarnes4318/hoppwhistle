'use client';

/**
 * One carrier's answer, as a card -- the quoter's results are a set of
 * recommendations, not a table.
 *
 * Three weights, so the list has a shape an agent reads in one glance:
 *
 *   hero  -- the first result: a large card under a "Recommended" band, a
 *            190x76 logo plate, the plan at headline size, the price large
 *            at the right, and the only solid Use Quote.
 *   pick  -- the next two, side by side: the runners-up, a 160x62 logo
 *            plate, the plan, the benefit, the price and an outlined Use Quote.
 *   quiet -- everything else: one compact card each, a 150x56 logo plate,
 *            plan, benefit, price, and an outlined Use Quote.
 *
 * Every card has the same four zones -- carrier brand, product and benefit,
 * price, action -- and opens in place to the same detail the rows had: the
 * reasons, pricing, other classes, published limits, copy, save, compare.
 */

import type { QuoteLine } from '@hopwhistle/fex-engine/types';
import { Check, ChevronDown, Star } from 'lucide-react';
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

  // The card's labels as pills: the recommendation's in the live green, the
  // runners-up's rank in ink, everything else ("Best level") in the brand.
  const label = labels.length ? (
    <span className="flex flex-wrap items-center gap-1.5">
      {labels.map(text => {
        const rank = /^#\d+$/.test(text);
        const recommended = text === 'Recommended';
        return (
          <span
            key={text}
            className={cn(
              'inline-flex h-[22px] items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold uppercase leading-none tracking-[0.06em]',
              recommended
                ? 'bg-live text-white'
                : rank
                  ? 'bg-ink text-surface'
                  : hero
                    ? 'bg-live-tint text-live-ink'
                    : 'bg-brand-tint text-brand-ink'
            )}
          >
            {recommended ? <Star className="h-3 w-3 fill-current" aria-hidden /> : null}
            {text}
          </span>
        );
      })}
    </span>
  ) : null;

  const action =
    onUse && !declined && best ? (
      <Button
        size="sm"
        disabled={busy}
        variant={hero && !selected ? 'default' : 'outline'}
        onClick={() => onUse(result, best)}
        className={cn(
          'relative z-[1] shrink-0 font-semibold',
          hero
            ? 'h-11 w-[148px] rounded-[10px] text-[15px] shadow-raised'
            : pick
              ? 'h-10 w-[120px] text-[14px]'
              : 'h-9 w-[112px] text-[13.5px]',
          selected
            ? 'border-live text-live-ink shadow-none hover:bg-live-tint hover:text-live-ink'
            : !hero &&
                'border-brand-ink bg-surface text-brand-ink shadow-none hover:bg-brand-tint hover:text-brand-ink'
        )}
      >
        {busy ? (
          'Saving…'
        ) : selected ? (
          <>
            <Check className="mr-1 h-4 w-4" aria-hidden />
            Selected
          </>
        ) : (
          'Use Quote'
        )}
      </Button>
    ) : null;

  const benefit = declined ? (
    <span className="flex min-w-0 items-center gap-2">
      <span className="inline-flex h-[20px] shrink-0 items-center rounded-[4px] bg-dropped-tint px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-dropped-ink">
        {result.outcome === 'DECLINE' ? 'Declined' : 'Not available'}
      </span>
      {result.ineligibleReason ? (
        <span className="min-w-0 truncate text-[12.5px] text-ink-2" title={result.ineligibleReason}>
          {result.ineligibleReason}
        </span>
      ) : null}
    </span>
  ) : best ? (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
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
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors duration-150 ne-motion group-hover/card:bg-sunken group-hover/card:text-ink-2"
    >
      <ChevronDown
        className={cn(
          'h-4 w-4 transition-transform duration-150 ne-motion motion-reduce:transition-none',
          expanded && 'rotate-180'
        )}
      />
    </span>
  );

  const logo = (size: 'quoteHero' | 'quotePick' | 'quoteRow', cls: string) => (
    <CarrierLogo
      names={[result.family, result.productId]}
      size={size}
      className={cn(cls, declined && 'opacity-50 grayscale')}
    />
  );

  const name = (cls: string) => (
    <span className={cn('block truncate text-ink', cls)} title={result.product}>
      {result.product}
    </span>
  );

  const family = (cls: string) => (
    <span className={cn('block truncate font-medium text-ink-2', cls)}>{result.family}</span>
  );

  const price = (size: 18 | 20 | 26, align: 'start' | 'end' = 'end') =>
    !declined && best ? (
      <span
        className={cn('flex shrink-0 flex-col', align === 'start' ? 'items-start' : 'items-end')}
      >
        <Price line={best} size={size} align={align} />
        <RateVerify result={result} />
      </span>
    ) : null;

  let body: React.ReactNode;
  if (hero) {
    body = (
      <>
        {/* The band that says why this one is first. */}
        <div className="flex min-h-[44px] items-center justify-between gap-3 rounded-t-[15px] border-b border-rule bg-live-tint px-5 py-2">
          {label ?? <span />}
          <span className="flex items-center gap-2">
            {compareBox}
            {chevron}
          </span>
        </div>
        <div className="flex items-center gap-x-6 px-5 pb-3.5 pt-4">
          {logo('quoteHero', 'hidden [@container(min-width:520px)]:inline-flex')}
          <div className="min-w-0 flex-1">
            {name('text-[20px] font-bold leading-7 tracking-[-0.015em]')}
            {family('mt-0.5 text-[13.5px]')}
            <span className="mt-2.5 block">
              {declined ? (
                benefit
              ) : best ? (
                <BenefitBadge line={best} className="max-w-full" />
              ) : null}
            </span>
          </div>
          {price(26)}
        </div>
        {/* What the agent says next: the one thing to know, and the action. */}
        <div
          className={cn(
            'flex min-h-[60px] items-center justify-between gap-4 border-t border-rule bg-paper px-5 py-2.5',
            !expanded && 'rounded-b-[15px]'
          )}
        >
          <span className="min-w-0 flex-1">
            {declined ? null : note || priceOnly || change ? (
              <StatusNote note={note} priceOnly={priceOnly} change={change} separator={false} />
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-live-ink">
                <Check className="h-3.5 w-3.5" aria-hidden />
                Qualifies as answered
              </span>
            )}
          </span>
          {action}
        </div>
      </>
    );
  } else if (pick) {
    body = (
      <div className="px-4 pb-4 pt-3.5">
        <div className="flex items-start justify-between gap-2">
          {logo('quotePick', '')}
          <span className="-mr-1 -mt-0.5 flex items-center gap-1">
            {compareBox}
            {chevron}
          </span>
        </div>
        <div className="mt-3 min-w-0">
          {label ? <span className="mb-1.5 block">{label}</span> : null}
          {name('text-[16px] font-semibold leading-6 tracking-[-0.01em]')}
          {family('text-[12.5px] leading-5')}
        </div>
        <div className="mt-2.5 min-w-0">
          {declined ? benefit : best ? <BenefitBadge line={best} className="max-w-full" /> : null}
          <span className="mt-1.5 block empty:hidden">
            <StatusNote note={note} priceOnly={priceOnly} change={change} separator={false} />
          </span>
        </div>
        <div className="mt-3 flex min-w-0 items-end justify-between gap-3 border-t border-rule pt-3">
          {price(20, 'start') ?? <span />}
          {action}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="flex items-center gap-4 py-2.5 pl-3 pr-3">
        {logo('quoteRow', 'hidden [@container(min-width:520px)]:inline-flex')}
        <div className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            {name('min-w-0 text-[15px] font-semibold leading-5')}
            {label ? <span className="shrink-0">{label}</span> : null}
          </span>
          {family('text-[12.5px] leading-5')}
          <span className="mt-1 block">{benefit}</span>
        </div>
        {price(18)}
        <span className="flex shrink-0 items-center gap-1.5">
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
          ? 'rounded-[16px] border-live shadow-raised'
          : pick
            ? 'rounded-[14px] border-rule-strong shadow-card hover:shadow-raised'
            : 'rounded-[12px] border-rule shadow-card hover:border-rule-strong hover:shadow-raised',
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
