'use client';

/**
 * The small pieces a customer's quotes and applications are labelled with:
 * a status badge, and what the agent asked the quoter for.
 */

import * as React from 'react';

import { MODE_SHORT, money, wholeDollars, type FexQuoteSummary } from '@/lib/fex/api';
import { cn } from '@/lib/utils';

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
