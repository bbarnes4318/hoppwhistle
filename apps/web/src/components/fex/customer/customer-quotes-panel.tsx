'use client';

/**
 * "What have we already shown this person?" -- a customer's quotes, on their
 * record.
 *
 * A summary first (how many, the latest, what they chose and at what price),
 * then the history newest first, then the full snapshot of any one of them on
 * a click. Opening a quote shows it exactly as it was quoted; Requote runs the
 * same answers against today's rates as a NEW quote, and the old one stays as
 * it was.
 */

import { AlertTriangle, Calculator, FileText, Plus, RefreshCw } from 'lucide-react';
import * as React from 'react';

import { CarrierLogo, Notice, Panel } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { CustomerQuotesState } from '@/hooks/use-customer-quotes';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { MODE_SHORT, money, wholeDollars, type FexQuoteSummary } from '@/lib/fex/api';
import { customerName, snapshotDifferences } from '@/lib/fex/customer';

import { SavedQuoteDrawer } from '../history/saved-quote-drawer';

import {
  applicationFromQuote,
  hasLiveApplication,
  type QuoteForApplication,
} from './customer-application-drawer';
import { CustomerQuoteCard } from './customer-quote-card';

/** How many quotes show before "Show all". */
const COLLAPSED = 4;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export interface CustomerQuotesPanelProps {
  lead: InsuranceLeadDetail;
  quotes: CustomerQuotesState;
  /** An unsaved draft is waiting in the workspace. */
  resumable?: boolean;
  onNewQuote: () => void;
  onRequote: (quoteId: string) => void;
  onWriteApplication: (quote: QuoteForApplication) => void;
  onViewApplication: () => void;
}

export function CustomerQuotesPanel({
  lead,
  quotes: state,
  resumable = false,
  onNewQuote,
  onRequote,
  onWriteApplication,
  onViewApplication,
}: CustomerQuotesPanelProps): JSX.Element {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const { quotes, total, loading, error } = state;
  const name = customerName(lead);
  const first = lead.firstName?.trim() || name;
  const written = hasLiveApplication(lead);

  const visible = showAll ? quotes : quotes.slice(0, COLLAPSED);
  const latest = quotes[0] ?? null;
  const lastSelected = quotes.find(q => q.selectedCarrier) ?? null;
  const lowest = quotes.reduce<FexQuoteSummary | null>(
    (best, q) =>
      q.lowestPremium != null &&
      (best?.lowestPremium == null || q.lowestPremium < best.lowestPremium)
        ? q
        : best,
    null
  );

  let body: React.ReactNode;
  if (loading && !quotes.length) {
    body = (
      <div className="space-y-px" aria-busy="true" aria-label="Loading quotes">
        {[0, 1].map(i => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-12 w-[128px]" />
            <span className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="h-3 w-32" />
            </span>
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>
    );
  } else if (error && !quotes.length) {
    body = (
      <Notice
        tone="error"
        className="m-4"
        title="Quotes could not be loaded"
        action={
          <Button size="sm" variant="outline" onClick={state.reload}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Retry
          </Button>
        }
      >
        {error}
      </Notice>
    );
  } else if (!quotes.length) {
    body = (
      <div className="flex flex-col items-center px-6 py-8 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-[12px] border border-rule bg-brand-tint text-brand-ink">
          <Calculator className="h-5 w-5" aria-hidden />
        </span>
        <p className="mt-3 text-[15px] font-semibold text-ink">No quotes yet</p>
        <p className="mt-1 max-w-[420px] text-[13px] leading-5 text-ink-2">
          Quote every carrier for {first}. What this record already knows is filled in, and every
          quote you save lands back here.
        </p>
        <Button className="mt-4" onClick={onNewQuote}>
          <Calculator className="mr-1.5 h-4 w-4" aria-hidden />
          {resumable ? 'Resume quote' : 'Create quote'}
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        <dl className="grid grid-cols-2 border-b border-rule md:grid-cols-[auto_auto_minmax(0,1fr)_auto]">
          <Stat label="Quotes">
            <span className="tabular-nums">{total}</span>
          </Stat>
          <Stat label="Latest">
            {latest ? (
              <>
                {day(latest.createdAt)}
                <span className="block text-[12px] font-normal text-ink-3">
                  {latest.createdBy.name}
                </span>
              </>
            ) : (
              '—'
            )}
          </Stat>
          <Stat label="Last selected" wide>
            {lastSelected ? (
              <span className="flex min-w-0 items-center gap-2.5">
                <CarrierLogo
                  names={[lastSelected.selectedCarrier, lastSelected.selectedProductId]}
                  size="sm"
                />
                <span className="min-w-0">
                  <span className="block truncate">{lastSelected.selectedCarrier}</span>
                  <span className="block truncate text-[12px] font-normal text-ink-2 tabular-nums">
                    {wholeDollars(lastSelected.selectedFace)} ·{' '}
                    {money(lastSelected.selectedPremium)}/{MODE_SHORT[lastSelected.paymentMode]}
                  </span>
                </span>
              </span>
            ) : (
              <span className="text-ink-3">None chosen yet</span>
            )}
          </Stat>
          <Stat label="Lowest quoted">
            {lowest?.lowestPremium != null ? (
              <span className="tabular-nums">
                {money(lowest.lowestPremium)}
                <span className="text-[12px] font-medium text-ink-3">
                  /{MODE_SHORT[lowest.paymentMode]}
                </span>
              </span>
            ) : (
              '—'
            )}
          </Stat>
        </dl>
        <ul className="divide-y divide-rule" aria-label={`${name}'s quotes`}>
          {visible.map((q, i) => (
            <CustomerQuoteCard
              key={q.id}
              quote={q}
              latest={i === 0}
              onOpen={quote => setOpenId(quote.id)}
            />
          ))}
        </ul>
        {quotes.length > COLLAPSED || state.hasMore ? (
          <div className="border-t border-rule px-4 py-2 text-center">
            <Button
              size="sm"
              variant="ghost"
              disabled={loading}
              onClick={() => {
                if (!showAll) setShowAll(true);
                else if (state.hasMore) state.loadMore();
                else setShowAll(false);
              }}
            >
              {!showAll ? `Show all ${total} quotes` : state.hasMore ? 'Load more' : 'Show fewer'}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <Panel className="min-w-0 overflow-hidden" id="quotes">
      <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <h2 className="flex items-baseline gap-2 text-[15px] font-semibold text-ink">
          Quotes
          {total ? (
            <span className="text-[13px] font-medium tabular-nums text-ink-3">{total}</span>
          ) : null}
        </h2>
        {quotes.length ? (
          <Button size="sm" variant="outline" onClick={onNewQuote}>
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
            {resumable ? 'Resume quote' : 'New quote'}
          </Button>
        ) : null}
      </div>
      {body}

      <SavedQuoteDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        inCustomer
        notice={detail => {
          const changed = snapshotDifferences(detail, lead);
          return changed.length ? (
            <p className="flex items-start gap-2 rounded-control border border-ringing bg-ringing-tint px-3 py-2 text-[12.5px] leading-[18px] text-ink">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ringing-ink" aria-hidden />
              <span>
                <span className="font-semibold">{first}&apos;s record has changed since.</span>{' '}
                {changed.map(c => `${c.field} ${c.quoted} → ${c.now}`).join(' · ')}. Requote to
                price them as they are now.
              </span>
            </p>
          ) : null;
        }}
        actions={detail => {
          const forApplication = applicationFromQuote(detail);
          return (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {detail.applicationId ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setOpenId(null);
                    onViewApplication();
                  }}
                >
                  <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  View application
                </Button>
              ) : forApplication && !written ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setOpenId(null);
                    onWriteApplication(forApplication);
                  }}
                >
                  <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Use for application
                </Button>
              ) : null}
              <Button
                size="sm"
                onClick={() => {
                  setOpenId(null);
                  onRequote(detail.id);
                }}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Requote at today&apos;s rates
              </Button>
            </div>
          );
        }}
      />
    </Panel>
  );
}

function Stat({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      className={
        wide
          ? 'col-span-2 min-w-0 border-rule px-4 py-2.5 md:col-span-1 md:border-l'
          : 'min-w-0 border-rule px-4 py-2.5 md:border-l md:first:border-l-0'
      }
    >
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        {label}
      </dt>
      <dd className="mt-0.5 text-[14px] font-semibold leading-5 text-ink">{children}</dd>
    </div>
  );
}
