'use client';

/**
 * The business written for a customer, on their Overview: the carrier, the
 * plan, where it stands, and the quote it came from, so "quoted -> written"
 * reads as one line of work. With none written, it says so -- and offers to
 * write one only when nothing above already does.
 */

import { FileCheck2, FileText, PhoneCall } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { CarrierLogo, Panel, StatusChip } from '@/components/domain';
import { Button } from '@/components/ui/button';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { money, wholeDollars, type FexQuoteSummary } from '@/lib/fex/api';
import { cn } from '@/lib/utils';

import { formatDay } from './format';

export function CustomerApplicationCard({
  lead,
  quotes,
  onWriteApplication,
  writeHint,
}: {
  lead: InsuranceLeadDetail;
  /** The customer's quotes, to date the one an application came from. */
  quotes: FexQuoteSummary[];
  /** Offered in the empty state; absent when another control already offers it. */
  onWriteApplication?: () => void;
  /** Said in the empty state when the button is offered elsewhere. */
  writeHint?: string;
}): JSX.Element {
  const applications = lead.applications ?? [];
  const quoteById = new Map(quotes.map(q => [q.id, q]));

  if (!applications.length) {
    return (
      <Panel
        className="min-w-0 scroll-mt-4 overflow-hidden"
        id="applications"
        aria-labelledby="applications-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-3">
              <FileText aria-hidden className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 id="applications-title" className="text-[16px] font-semibold text-ink">
                Application
              </h2>
              <p className="text-[13px] text-ink-3">
                No application written yet{writeHint ? ` · ${writeHint}` : '.'}
              </p>
            </div>
          </div>
          {onWriteApplication ? (
            <Button size="sm" variant="outline" onClick={onWriteApplication}>
              <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
              Write application
            </Button>
          ) : null}
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      className="min-w-0 scroll-mt-4 overflow-hidden"
      id="applications"
      aria-labelledby="applications-title"
    >
      <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3">
        <h2
          id="applications-title"
          className="flex items-baseline gap-2 text-[16px] font-semibold text-ink"
        >
          Application
          {applications.length > 1 ? (
            <span className="text-[13px] font-medium tabular-nums text-ink-3">
              {applications.length}
            </span>
          ) : null}
        </h2>
      </div>
      <ul className="divide-y divide-rule">
        {applications.map(app => {
          const quote = app.fexQuoteId ? quoteById.get(app.fexQuoteId) : undefined;
          const voided = Boolean(app.voidedAt);
          return (
            <li
              key={app.id}
              className={cn(
                'flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5',
                voided && 'opacity-60'
              )}
            >
              <CarrierLogo names={[app.carrier]} size="row" />
              <div className="min-w-[180px] flex-1">
                <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={cn(
                      'truncate text-[15px] font-semibold text-ink',
                      voided && 'line-through'
                    )}
                  >
                    {app.carrier}
                  </span>
                  {voided ? (
                    <StatusChip value="VOIDED" label="Voided" tone="neutral" size="sm" />
                  ) : (
                    <StatusChip value={app.status} size="sm" />
                  )}
                </p>
                {app.product ? (
                  <p className="mt-0.5 truncate text-[13.5px] text-ink-2">{app.product}</p>
                ) : null}
                <p className="mt-0.5 truncate text-[12.5px] text-ink-3">
                  {app.submittedAt
                    ? `Submitted ${formatDay(app.submittedAt)}`
                    : `Written ${formatDay(app.createdAt)} · not submitted`}
                  {app.carrierApplicationNumber ? ` · #${app.carrierApplicationNumber}` : ''}
                </p>
                {app.fexQuoteId || app.callId ? (
                  <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-ink-3">
                    {app.fexQuoteId ? (
                      <span>From quote{quote ? ` · ${formatDay(quote.createdAt)}` : ''}</span>
                    ) : null}
                    {app.fexQuoteId && app.callId ? <span aria-hidden>·</span> : null}
                    {app.callId ? (
                      <Link
                        href={`/calls?call=${encodeURIComponent(app.callId)}`}
                        className="inline-flex items-center gap-1 text-brand-ink hover:underline"
                      >
                        <PhoneCall aria-hidden className="h-3 w-3" />
                        Open call
                      </Link>
                    ) : null}
                  </p>
                ) : null}
              </div>
              <div className="ml-auto text-right tabular-nums">
                {app.annualizedPremium !== null ? (
                  <p className="text-[16px] font-semibold text-ink">
                    {money(app.annualizedPremium)}
                    <span className="text-[12px] font-medium text-ink-3">/yr</span>
                  </p>
                ) : null}
                {app.faceAmount ? (
                  <p className="text-[12.5px] text-ink-2">
                    {wholeDollars(app.faceAmount)} coverage
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
