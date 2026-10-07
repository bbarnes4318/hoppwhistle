'use client';

/**
 * One saved quote in a customer's history.
 *
 * Read in one glance, top to bottom: who was chosen (the carrier's mark, at a
 * size it can be read), what (plan and class), how much (coverage, premium),
 * then when and by whom. A quote saved without a choice says what it showed
 * instead: how many plans qualified and the lowest price among them.
 */

import { BENEFIT_LABEL } from '@hopwhistle/fex-engine/catalog';
import { Calculator, ChevronRight } from 'lucide-react';
import * as React from 'react';

import { CarrierLogo } from '@/components/domain';
import {
  MODE_SHORT,
  money,
  QUOTE_SOURCE_LABEL,
  wholeDollars,
  type FexQuoteSummary,
  type QuoteSource,
} from '@/lib/fex/api';
import { cn } from '@/lib/utils';

import { FOCUS } from '../parts';

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export type QuoteBadgeTone = 'live' | 'money' | 'neutral' | 'brand';

const BADGE: Record<QuoteBadgeTone, string> = {
  live: 'bg-live-tint text-live-ink',
  money: 'bg-money-tint text-money-ink',
  brand: 'bg-brand-tint text-brand-ink',
  neutral: 'bg-sunken text-ink-2',
};

export function QuoteBadge({
  tone,
  children,
}: {
  tone: QuoteBadgeTone;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-[5px] px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]',
        BADGE[tone]
      )}
    >
      {children}
    </span>
  );
}

/** "$10,000 requested" or "$50.00/mo budget": what the agent asked the quoter. */
export function quoteAsk(q: Pick<FexQuoteSummary, 'faceAmount' | 'budget' | 'paymentMode'>) {
  if (q.faceAmount) return `${wholeDollars(q.faceAmount)} requested`;
  if (q.budget) return `${money(q.budget)}/${MODE_SHORT[q.paymentMode]} budget`;
  return null;
}

export function CustomerQuoteCard({
  quote: q,
  latest = false,
  onOpen,
}: {
  quote: FexQuoteSummary;
  latest?: boolean;
  onOpen: (quote: FexQuoteSummary) => void;
}): JSX.Element {
  const mode = MODE_SHORT[q.paymentMode];
  const selected = Boolean(q.selectedCarrier);
  const benefit = q.selectedBenefit ? (BENEFIT_LABEL[q.selectedBenefit] ?? null) : null;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(q)}
        data-quote-id={q.id}
        className={cn(
          'group flex w-full items-center gap-4 px-4 py-3 text-left transition-colors duration-150 ne-motion hover:bg-sunken',
          FOCUS
        )}
      >
        {selected ? (
          <CarrierLogo names={[q.selectedCarrier, q.selectedProductId]} size="md" />
        ) : (
          <span
            aria-hidden
            className="flex h-12 w-[128px] shrink-0 items-center justify-center gap-2 rounded-control border border-dashed border-rule-strong text-ink-3"
          >
            <Calculator className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em]">Compared</span>
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="truncate text-[14px] font-semibold text-ink">
              {selected
                ? q.selectedCarrier
                : `${q.eligibleCount} plan${q.eligibleCount === 1 ? '' : 's'} qualified`}
            </span>
            {selected ? (
              <span className="truncate text-[13px] text-ink-2">
                {q.selectedProduct}
                {q.selectedClass ? ` · ${q.selectedClass}` : ''}
                {benefit && benefit !== q.selectedClass ? ` (${benefit})` : ''}
              </span>
            ) : (
              <span className="truncate text-[13px] text-ink-2">{quoteAsk(q)}</span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-ink-3">
            <time dateTime={q.createdAt}>{dateTime(q.createdAt)}</time> · {q.createdBy.name}
            {q.source !== 'CRM'
              ? ` · ${QUOTE_SOURCE_LABEL[q.source as QuoteSource] ?? q.source}`
              : ''}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-1">
            {latest ? <QuoteBadge tone="brand">Latest</QuoteBadge> : null}
            {selected ? <QuoteBadge tone="live">Selected</QuoteBadge> : null}
            {q.applicationId ? <QuoteBadge tone="money">Application written</QuoteBadge> : null}
            <QuoteBadge tone="neutral">
              {q.eligibleCount} plan{q.eligibleCount === 1 ? '' : 's'} compared
            </QuoteBadge>
          </span>
        </span>

        <span className="shrink-0 text-right tabular-nums">
          {selected ? (
            <>
              <span className="block text-[17px] font-semibold leading-6 text-ink">
                {money(q.selectedPremium)}
                <span className="text-[12px] font-medium text-ink-3">/{mode}</span>
              </span>
              <span className="block text-[12px] text-ink-2">
                {wholeDollars(q.selectedFace)} coverage
              </span>
            </>
          ) : q.lowestPremium != null ? (
            <>
              <span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">
                Lowest
              </span>
              <span className="block text-[15px] font-semibold leading-5 text-ink">
                {money(q.lowestPremium)}
                <span className="text-[12px] font-medium text-ink-3">/{mode}</span>
              </span>
            </>
          ) : (
            <span className="text-[12px] text-ink-3">No price</span>
          )}
        </span>
        <ChevronRight
          aria-hidden
          className="h-4 w-4 shrink-0 text-ink-3 transition-transform duration-150 ne-motion group-hover:translate-x-0.5"
        />
      </button>
    </li>
  );
}
