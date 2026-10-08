'use client';

/**
 * "What have we already shown this person, and what did they pick?" -- a
 * customer's quotes, on their workspace.
 *
 * The plan they chose leads: the carrier's mark at a size it is recognised
 * by, the plan, the coverage and the premium, and the next step on it (write
 * the application, open the quote, requote). Every other saved quote follows
 * as one comparable row each, newest first. Any quote opens as it was stored
 * (`SavedQuoteDrawer`); Requote runs the same answers against today's rates
 * as a NEW quote, and the old one stays as it was.
 */

import { BENEFIT_LABEL } from '@hopwhistle/fex-engine/catalog';
import {
  AlertTriangle,
  Calculator,
  Check,
  ChevronRight,
  FileCheck2,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
} from 'lucide-react';
import * as React from 'react';

import { CarrierLogo, Notice, Panel } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { CustomerQuotesState } from '@/hooks/use-customer-quotes';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import {
  MODE_SHORT,
  money,
  QUOTE_SOURCE_LABEL,
  wholeDollars,
  type FexQuoteSummary,
  type QuoteSource,
} from '@/lib/fex/api';
import { customerName, snapshotDifferences } from '@/lib/fex/customer';
import { cn } from '@/lib/utils';

import { SavedQuoteDrawer } from '../history/saved-quote-drawer';
import { FOCUS } from '../parts';

import {
  applicationFromQuote,
  hasLiveApplication,
  type QuoteForApplication,
} from './customer-application-drawer';
import { QuoteBadge, quoteAsk } from './customer-quote-card';

/** How many other quotes show before "Show all". */
const COLLAPSED = 3;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export interface CustomerQuotesPanelProps {
  lead: InsuranceLeadDetail;
  quotes: CustomerQuotesState;
  /** An unsaved draft is waiting in the workspace. */
  resumable?: boolean;
  onNewQuote: () => void;
  onRequote: (quoteId: string) => void;
  /** Write the application from a quote, loaded in full first. */
  onWriteFromQuote: (quote: FexQuoteSummary) => void;
  /** Write it from a quote already loaded (the saved quote drawer). */
  onWriteApplication: (quote: QuoteForApplication) => void;
  onViewApplication: () => void;
  /** A quote is being loaded to write from. */
  preparing?: boolean;
}

/**
 * The plan that leads: the one an application was written from, else the
 * newest quote with a plan chosen.
 */
export function featuredQuote(
  quotes: FexQuoteSummary[],
  lead: InsuranceLeadDetail
): FexQuoteSummary | null {
  const liveQuoteIds = new Set(
    (lead.applications ?? []).filter(a => !a.voidedAt && a.fexQuoteId).map(a => a.fexQuoteId)
  );
  return (
    quotes.find(q => q.selectedCarrier && liveQuoteIds.has(q.id)) ??
    quotes.find(q => q.selectedCarrier) ??
    null
  );
}

export function CustomerQuotesPanel({
  lead,
  quotes: state,
  resumable = false,
  onNewQuote,
  onRequote,
  onWriteFromQuote,
  onWriteApplication,
  onViewApplication,
  preparing = false,
}: CustomerQuotesPanelProps): JSX.Element {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const { quotes, total, loading, error } = state;
  const name = customerName(lead);
  const first = lead.firstName?.trim() || name;
  const written = hasLiveApplication(lead);

  const featured = featuredQuote(quotes, lead);
  const others = quotes.filter(q => q !== featured);
  const visible = showAll ? others : others.slice(0, COLLAPSED);
  const latest = quotes[0] ?? null;
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
      <div className="space-y-4 px-5 py-5" aria-busy="true" aria-label="Loading quotes">
        <div className="flex items-center gap-5">
          <Skeleton className="h-[76px] w-[190px]" />
          <span className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3.5 w-64" />
          </span>
          <Skeleton className="h-8 w-24" />
        </div>
        <Skeleton className="h-12 w-full" />
      </div>
    );
  } else if (error && !quotes.length) {
    body = (
      <Notice
        tone="error"
        className="m-5"
        title="Quotes could not be loaded"
        action={
          <Button size="sm" variant="outline" onClick={state.reload}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Retry
          </Button>
        }
      >
        {error}
      </Notice>
    );
  } else if (!quotes.length) {
    body = (
      <div className="flex flex-col items-center px-6 py-10 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-tint text-brand-ink">
          <Calculator className="h-5 w-5" aria-hidden />
        </span>
        <p className="mt-3 text-[15px] font-semibold text-ink">No quotes yet</p>
        <p className="mt-1 max-w-[420px] text-[13.5px] leading-5 text-ink-2">
          Quote every carrier for {first}. What this record already knows is filled in, and every
          quote you save lands back here.
        </p>
        <Button className="mt-4" onClick={onNewQuote}>
          <Calculator className="h-4 w-4" aria-hidden />
          {resumable ? 'Resume quote' : 'Create quote'}
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        {featured ? (
          <FeaturedPlan
            quote={featured}
            written={written}
            preparing={preparing}
            onOpen={() => setOpenId(featured.id)}
            onRequote={() => onRequote(featured.id)}
            onWrite={() => onWriteFromQuote(featured)}
          />
        ) : (
          <NoPlanChosen latest={latest} onOpen={() => latest && setOpenId(latest.id)} />
        )}
        {others.length ? (
          <section
            aria-label={featured ? 'Other saved quotes' : 'Saved quotes'}
            className="border-t border-rule bg-paper"
          >
            <h3 className="px-5 pb-0.5 pt-3 text-[13px] font-semibold text-ink-2">
              {featured ? 'Other quotes' : 'Saved quotes'}
              <span className="ml-1.5 font-medium tabular-nums text-ink-3">{others.length}</span>
            </h3>
            <ul aria-label={`${name}'s quotes`}>
              {visible.map(q => (
                <QuoteRow
                  key={q.id}
                  quote={q}
                  latest={q === latest}
                  onOpen={() => setOpenId(q.id)}
                />
              ))}
            </ul>
          </section>
        ) : null}
        {others.length > COLLAPSED || state.hasMore ? (
          <div className="border-t border-rule px-5 py-1.5">
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
    <Panel
      className="min-w-0 scroll-mt-4 overflow-hidden"
      id="quotes"
      aria-labelledby="quotes-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-rule px-5 py-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <h2
            id="quotes-title"
            className="flex items-baseline gap-2 text-[16px] font-semibold text-ink"
          >
            Quotes
            {total ? (
              <span className="text-[13px] font-medium tabular-nums text-ink-3">{total}</span>
            ) : null}
          </h2>
          {latest ? (
            <p className="truncate text-[12.5px] text-ink-3">
              Latest {day(latest.createdAt)} by {latest.createdBy.name}
              {lowest?.lowestPremium != null
                ? ` · lowest quoted ${money(lowest.lowestPremium)}/${MODE_SHORT[lowest.paymentMode]}`
                : ''}
            </p>
          ) : null}
        </div>
        {quotes.length ? (
          <Button size="sm" variant="outline" onClick={onNewQuote}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
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
                  <FileText className="h-3.5 w-3.5" aria-hidden />
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
                  <FileText className="h-3.5 w-3.5" aria-hidden />
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
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Requote at today&apos;s rates
              </Button>
            </div>
          );
        }}
      />
    </Panel>
  );
}

function planParts(q: FexQuoteSummary): string[] {
  const benefit = q.selectedBenefit ? (BENEFIT_LABEL[q.selectedBenefit] ?? null) : null;
  const said = (q.selectedClass ?? '').toLowerCase();
  const adds = benefit && !said.includes(benefit.toLowerCase().split(' ')[0]);
  return [q.selectedClass, adds ? benefit : null].filter((p): p is string => Boolean(p));
}

function QuoteMeta({ q }: { q: FexQuoteSummary }): JSX.Element {
  return (
    <>
      Quoted <time dateTime={q.createdAt}>{day(q.createdAt)}</time> by {q.createdBy.name}
      {q.source !== 'CRM' ? ` · ${QUOTE_SOURCE_LABEL[q.source as QuoteSource] ?? q.source}` : ''}
      {' · '}
      {q.eligibleCount} plan{q.eligibleCount === 1 ? '' : 's'} compared
    </>
  );
}

/**
 * The agent's working recommendation: the carrier's mark at full plate size,
 * the plan named the way the carrier names it, the premium as the figure the
 * eye lands on, and the next step on it.
 */
function FeaturedPlan({
  quote: q,
  written,
  preparing,
  onOpen,
  onRequote,
  onWrite,
}: {
  quote: FexQuoteSummary;
  written: boolean;
  preparing: boolean;
  onOpen: () => void;
  onRequote: () => void;
  onWrite: () => void;
}): JSX.Element {
  const mode = MODE_SHORT[q.paymentMode];
  const fromThis = Boolean(q.applicationId);

  return (
    <section aria-label="Selected plan" data-quote-id={q.id} className="px-5 pb-4 pt-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <CarrierLogo names={[q.selectedCarrier, q.selectedProductId]} size="quoteHero" />
        <div className="min-w-[200px] flex-1">
          <p className="flex flex-wrap items-center gap-2">
            {fromThis ? (
              <QuoteBadge tone="money">
                <Check className="mr-1 h-3 w-3" aria-hidden />
                Application written
              </QuoteBadge>
            ) : (
              <QuoteBadge tone="live">
                <Check className="mr-1 h-3 w-3" aria-hidden />
                Selected plan
              </QuoteBadge>
            )}
            <span className="text-[13px] font-medium text-ink-2">{q.selectedCarrier}</span>
          </p>
          <p className="mt-1.5 text-[18px] font-semibold leading-6 tracking-[-0.005em] text-ink">
            {q.selectedProduct}
          </p>
          {planParts(q).length ? (
            <p className="mt-0.5 text-[13.5px] leading-5 text-ink-2">{planParts(q).join(' · ')}</p>
          ) : null}
        </div>
        <div className="ml-auto text-right tabular-nums">
          <p className="text-[32px] font-semibold leading-9 tracking-[-0.02em] text-ink">
            {money(q.selectedPremium)}
            <span className="ml-1 text-[14px] font-medium tracking-normal text-ink-3">/{mode}</span>
          </p>
          <p className="mt-0.5 text-[14px] font-medium text-ink-2">
            {wholeDollars(q.selectedFace)} coverage
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Written: the application sits right under this panel, so no second way to it here. */}
          {fromThis || written ? null : (
            <Button size="sm" onClick={onWrite} disabled={preparing}>
              {preparing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
              )}
              Write application
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onOpen}>
            View quote
          </Button>
          <Button size="sm" variant="ghost" onClick={onRequote}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Requote
          </Button>
        </div>
        <p className="text-[12.5px] text-ink-3">
          <QuoteMeta q={q} />
        </p>
      </div>
    </section>
  );
}

function NoPlanChosen({
  latest,
  onOpen,
}: {
  latest: FexQuoteSummary | null;
  onOpen: () => void;
}): JSX.Element {
  return (
    <section
      aria-label="Selected plan"
      className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4"
    >
      <span
        aria-hidden
        className="flex h-[76px] w-[190px] shrink-0 items-center justify-center rounded-[8px] border border-dashed border-rule-strong text-ink-3"
      >
        <Calculator className="h-5 w-5" />
      </span>
      <div className="min-w-[200px] flex-1">
        <p className="text-[15px] font-semibold text-ink">No plan chosen yet</p>
        <p className="mt-0.5 text-[13px] leading-5 text-ink-3">
          {latest
            ? `The latest quote compared ${latest.eligibleCount} plan${latest.eligibleCount === 1 ? '' : 's'}${
                latest.lowestPremium != null
                  ? `, from ${money(latest.lowestPremium)}/${MODE_SHORT[latest.paymentMode]}`
                  : ''
              }. Open it to choose one.`
            : 'Open a quote to choose a plan.'}
        </p>
      </div>
      {latest ? (
        <Button size="sm" variant="outline" onClick={onOpen}>
          View latest quote
        </Button>
      ) : null}
    </section>
  );
}

/** Another saved quote: the same facts as the selected plan, one size down and one shade quieter. */
function QuoteRow({
  quote: q,
  latest,
  onOpen,
}: {
  quote: FexQuoteSummary;
  latest: boolean;
  onOpen: () => void;
}): JSX.Element {
  const mode = MODE_SHORT[q.paymentMode];
  const selected = Boolean(q.selectedCarrier);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-quote-id={q.id}
        className={cn(
          'group grid w-full grid-cols-[auto_minmax(0,1fr)_auto_16px] items-center gap-x-4 px-5 py-2.5 text-left transition-colors duration-150 ne-motion hover:bg-sunken',
          FOCUS
        )}
      >
        {selected ? (
          <CarrierLogo names={[q.selectedCarrier, q.selectedProductId]} size="row" />
        ) : (
          <span
            aria-hidden
            className="flex h-[50px] w-[120px] shrink-0 items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-rule-strong text-ink-3"
          >
            <Calculator className="h-4 w-4" />
            <span className="text-[12px] font-medium">Compared</span>
          </span>
        )}
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-ink">
              {selected
                ? q.selectedProduct || q.selectedCarrier
                : `${q.eligibleCount} plan${q.eligibleCount === 1 ? '' : 's'} qualified`}
            </span>
            {latest ? <QuoteBadge tone="brand">Latest</QuoteBadge> : null}
            {q.applicationId ? <QuoteBadge tone="money">Application written</QuoteBadge> : null}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-ink-2">
            {selected ? [q.selectedCarrier, ...planParts(q)].join(' · ') : quoteAsk(q)}
          </span>
          <span className="block truncate text-[12px] text-ink-3">
            <time dateTime={q.createdAt}>{day(q.createdAt)}</time> · {q.createdBy.name}
          </span>
        </span>
        <span className="text-right tabular-nums">
          {selected ? (
            <>
              <span className="block text-[15px] font-semibold leading-6 text-ink-2">
                {money(q.selectedPremium)}
                <span className="text-[12px] font-medium text-ink-3">/{mode}</span>
              </span>
              <span className="block text-[12.5px] text-ink-3">
                {wholeDollars(q.selectedFace)} coverage
              </span>
            </>
          ) : q.lowestPremium != null ? (
            <>
              <span className="block text-[12px] text-ink-3">From</span>
              <span className="block text-[15px] font-semibold leading-5 text-ink-2">
                {money(q.lowestPremium)}
                <span className="text-[12px] font-medium text-ink-3">/{mode}</span>
              </span>
            </>
          ) : (
            <span className="text-[12.5px] text-ink-3">No price</span>
          )}
        </span>
        <ChevronRight
          aria-hidden
          className="h-4 w-4 text-ink-3 transition-transform duration-150 ne-motion group-hover:translate-x-0.5"
        />
      </button>
    </li>
  );
}
