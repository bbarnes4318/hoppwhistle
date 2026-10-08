'use client';

/**
 * "What are we recommending, and what else did we show them?" -- the
 * customer's coverage, on the Overview sheet.
 *
 * The selected plan reads as a financial product: the carrier's mark set
 * into the layout, the plan named the way the carrier names it, the monthly
 * premium as the figure the eye lands on, and a facts row (coverage, annual
 * cost, benefit, when and by whom). Every other saved quote follows as one
 * row of a comparison table, priced against the selected plan. Any quote
 * opens as it was stored (`SavedQuoteDrawer`); Requote runs the same answers
 * against today's rates as a NEW quote, and the old one stays as it was.
 *
 * No card of its own: it composes into the sheet with the sections around it.
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

import { Notice } from '@/components/domain';
import { CarrierMark, Kicker, Section, TextAction } from '@/components/leads/customer/workspace';
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
import { annualPremium, customerName, snapshotDifferences } from '@/lib/fex/customer';
import { cn } from '@/lib/utils';

import { SavedQuoteDrawer } from '../history/saved-quote-drawer';
import { FOCUS } from '../parts';

import {
  applicationFromQuote,
  hasLiveApplication,
  type QuoteForApplication,
} from './customer-application-drawer';
import { quoteAsk } from './customer-quote-card';

/** How many other quotes show before "Show all". */
const COLLAPSED = 4;

const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

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

/** The class and, when it adds something, the benefit: "Graded Death Benefit (GDB)". */
function planParts(q: FexQuoteSummary): string[] {
  const benefit = q.selectedBenefit ? (BENEFIT_LABEL[q.selectedBenefit] ?? null) : null;
  const said = (q.selectedClass ?? '').toLowerCase();
  const adds = benefit && !said.includes(benefit.toLowerCase().split(' ')[0]);
  return [q.selectedClass, adds ? benefit : null].filter((p): p is string => Boolean(p));
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
      <div className="space-y-4" aria-busy="true" aria-label="Loading quotes">
        <Skeleton className="h-8 w-40" />
        <div className="flex items-end justify-between">
          <span className="space-y-2">
            <Skeleton className="h-5 w-72" />
            <Skeleton className="h-4 w-48" />
          </span>
          <Skeleton className="h-10 w-36" />
        </div>
        <Skeleton className="h-12 w-full" />
      </div>
    );
  } else if (error && !quotes.length) {
    body = (
      <Notice
        tone="error"
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
      <div className="flex flex-wrap items-center justify-between gap-6 rounded-[10px] bg-paper px-6 py-6">
        <div className="flex min-w-0 items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink">
            <Calculator className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[16px] font-semibold text-ink">No quotes yet</p>
            <p className="mt-1 max-w-[460px] text-[14px] leading-5 text-ink-2">
              Quote every carrier for {first}. What this record already knows is filled in, and
              every quote you save lands back here.
            </p>
          </div>
        </div>
        <Button onClick={onNewQuote}>
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
          <section aria-label={featured ? 'Other saved quotes' : 'Saved quotes'} className="mt-7">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[14px] font-semibold text-ink">
                {featured ? 'Alternatives' : 'Saved quotes'}
                <span className="ml-2 font-medium tabular-nums text-ink-3">{others.length}</span>
              </h3>
              {lowest?.lowestPremium != null ? (
                <span className="text-[13px] text-ink-3">
                  Lowest quoted {money(lowest.lowestPremium)}/{MODE_SHORT[lowest.paymentMode]}
                </span>
              ) : null}
            </div>
            <div
              role="row"
              aria-hidden
              className="mt-2 hidden grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_96px_120px_16px] gap-x-5 border-b border-rule pb-2 text-[12px] font-medium text-ink-3 md:grid"
            >
              <span>Plan</span>
              <span>Benefit</span>
              <span className="text-right">Coverage</span>
              <span className="text-right">Premium</span>
              <span />
            </div>
            <ul aria-label={`${name}'s quotes`} className="divide-y divide-rule">
              {visible.map(q => (
                <QuoteRow
                  key={q.id}
                  quote={q}
                  latest={q === latest}
                  against={featured}
                  onOpen={() => setOpenId(q.id)}
                />
              ))}
            </ul>
            {others.length > COLLAPSED || state.hasMore ? (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                disabled={loading}
                onClick={() => {
                  if (!showAll) setShowAll(true);
                  else if (state.hasMore) state.loadMore();
                  else setShowAll(false);
                }}
              >
                {!showAll ? `Show all ${total} quotes` : state.hasMore ? 'Load more' : 'Show fewer'}
              </Button>
            ) : null}
          </section>
        ) : null}
      </>
    );
  }

  return (
    <>
      <Section
        id="quotes"
        divided={false}
        title="Coverage"
        meta={
          latest
            ? `${total} quote${total === 1 ? '' : 's'} · latest ${day(latest.createdAt)} by ${latest.createdBy.name}`
            : null
        }
        action={
          quotes.length ? (
            <TextAction icon={Plus} onClick={onNewQuote}>
              {resumable ? 'Resume quote' : 'New quote'}
            </TextAction>
          ) : null
        }
      >
        {body}
      </Section>

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
    </>
  );
}

function Fact({
  label,
  children,
  sub,
}: {
  label: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="min-w-0 px-5 py-2.5 first:pl-0">
      <dt className="text-[12.5px] text-ink-3">{label}</dt>
      <dd className="mt-0.5 truncate text-[14px] font-semibold text-ink">
        {children}
        {sub ? <span className="font-normal text-ink-3"> {sub}</span> : null}
      </dd>
    </div>
  );
}

/**
 * The agent's working recommendation, set like a financial product: the
 * carrier's mark, the plan, the premium as the figure the eye lands on, a
 * row of the terms, and the next step on it.
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
  const annual = annualPremium(q.selectedPremium, q.paymentMode);
  const parts = planParts(q);

  return (
    <section aria-label="Selected plan" data-quote-id={q.id}>
      <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <CarrierMark names={[q.selectedCarrier, q.selectedProductId]} height={38} />
            <span
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-[6px] px-2 text-[12px] font-semibold',
                fromThis ? 'bg-money-tint text-money-ink' : 'bg-live-tint text-live-ink'
              )}
            >
              <Check className="h-3 w-3" aria-hidden />
              {fromThis ? 'Application written' : 'Selected plan'}
            </span>
          </div>
          <p className="mt-3 text-[21px] font-semibold leading-7 tracking-[-0.01em] text-ink">
            {q.selectedProduct}
          </p>
          <p className="mt-0.5 text-[14px] text-ink-2">
            <span className="font-medium text-ink-2">{q.selectedCarrier}</span>
            {parts.length ? <span className="text-ink-3"> · {parts.join(' · ')}</span> : null}
          </p>
        </div>
        <div className="text-right">
          <Kicker>Monthly premium</Kicker>
          <p className="mt-0.5 text-[38px] font-semibold leading-[44px] tracking-[-0.025em] text-ink tabular-nums">
            {money(q.selectedPremium)}
            <span className="ml-1 text-[15px] font-medium tracking-normal text-ink-3">/{mode}</span>
          </p>
          <p className="mt-0.5 text-[15px] font-semibold text-ink-2 tabular-nums">
            {wholeDollars(q.selectedFace)} coverage
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 divide-x divide-rule border-y border-rule md:grid-cols-4">
        <Fact label="Face amount">{wholeDollars(q.selectedFace)}</Fact>
        <Fact label="Annual premium">{annual != null ? money(annual) : '—'}</Fact>
        <Fact label="Compared">
          {q.eligibleCount} plan{q.eligibleCount === 1 ? '' : 's'}
        </Fact>
        <Fact
          label="Quoted"
          sub={`by ${q.createdBy.name.split(' ')[0]}${q.source !== 'CRM' ? ` · ${QUOTE_SOURCE_LABEL[q.source as QuoteSource] ?? q.source}` : ''}`}
        >
          <span className="tabular-nums">{shortDay(q.createdAt)}</span>
        </Fact>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* Written: the application section sits right below, so no second way to it here. */}
        {fromThis || written ? null : (
          <Button onClick={onWrite} disabled={preparing}>
            {preparing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <FileCheck2 className="h-4 w-4" aria-hidden />
            )}
            Write application
          </Button>
        )}
        <Button variant="outline" onClick={onOpen}>
          <FileText className="h-4 w-4" aria-hidden />
          View quote
        </Button>
        <Button variant="ghost" onClick={onRequote}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Requote
        </Button>
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
      className="flex flex-wrap items-center justify-between gap-5 rounded-[10px] bg-paper px-6 py-5"
    >
      <div className="min-w-0">
        <p className="text-[16px] font-semibold text-ink">No plan chosen yet</p>
        <p className="mt-1 text-[14px] leading-5 text-ink-2">
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
        <Button variant="outline" onClick={onOpen}>
          View latest quote
        </Button>
      ) : null}
    </section>
  );
}

/** One comparison row: the plan, its benefit, the coverage, and the price against the selected plan. */
function QuoteRow({
  quote: q,
  latest,
  against,
  onOpen,
}: {
  quote: FexQuoteSummary;
  latest: boolean;
  against: FexQuoteSummary | null;
  onOpen: () => void;
}): JSX.Element {
  const mode = MODE_SHORT[q.paymentMode];
  const selected = Boolean(q.selectedCarrier);
  const price = selected ? q.selectedPremium : q.lowestPremium;
  const comparable =
    selected &&
    against?.selectedPremium != null &&
    q.selectedPremium != null &&
    against.paymentMode === q.paymentMode;
  const delta = comparable ? q.selectedPremium! - against.selectedPremium! : null;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-quote-id={q.id}
        className={cn(
          'group -mx-3 grid w-[calc(100%+1.5rem)] grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-x-5 rounded-[8px] px-3 py-3 text-left transition-colors duration-150 ne-motion hover:bg-paper md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_96px_120px_16px]',
          FOCUS
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          {selected ? (
            <span className="flex w-[72px] shrink-0 items-center">
              <CarrierMark
                names={[q.selectedCarrier, q.selectedProductId]}
                height={22}
                maxWidth={72}
              />
            </span>
          ) : (
            <span
              aria-hidden
              className="flex h-[22px] w-[72px] shrink-0 items-center gap-1 text-[12px] font-medium text-ink-3"
            >
              <Calculator className="h-3.5 w-3.5" />
              Compared
            </span>
          )}
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[14px] font-semibold text-ink">
                {selected
                  ? q.selectedProduct || q.selectedCarrier
                  : `${q.eligibleCount} plan${q.eligibleCount === 1 ? '' : 's'} qualified`}
              </span>
              {latest ? (
                <span className="shrink-0 text-[11.5px] font-semibold text-brand-ink">Latest</span>
              ) : null}
              {q.applicationId ? (
                <span className="shrink-0 text-[11.5px] font-semibold text-money-ink">
                  Application written
                </span>
              ) : null}
            </span>
            <span className="block truncate text-[12.5px] text-ink-3">
              {selected ? q.selectedCarrier : quoteAsk(q)} · {day(q.createdAt)}
            </span>
          </span>
        </span>
        <span className="hidden truncate text-[13.5px] text-ink-2 md:block">
          {selected ? planParts(q).join(' · ') || '—' : '—'}
        </span>
        <span className="hidden text-right text-[13.5px] tabular-nums text-ink-2 md:block">
          {selected ? wholeDollars(q.selectedFace) : '—'}
        </span>
        <span className="text-right tabular-nums">
          <span className="block text-[15px] font-semibold text-ink">
            {price != null ? (
              <>
                {selected ? '' : <span className="text-[12px] font-normal text-ink-3">from </span>}
                {money(price)}
                <span className="text-[12px] font-medium text-ink-3">/{mode}</span>
              </>
            ) : (
              <span className="text-[13px] font-normal text-ink-3">No price</span>
            )}
          </span>
          {delta != null && Math.abs(delta) >= 0.005 ? (
            <span
              className={cn(
                'block text-[12px] font-medium',
                delta < 0 ? 'text-live-ink' : 'text-ink-3'
              )}
            >
              {money(Math.abs(delta))} {delta < 0 ? 'less' : 'more'}
            </span>
          ) : null}
        </span>
        <ChevronRight
          aria-hidden
          className="h-4 w-4 text-ink-3 transition-transform duration-150 ne-motion group-hover:translate-x-0.5"
        />
      </button>
    </li>
  );
}
