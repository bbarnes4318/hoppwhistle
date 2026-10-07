'use client';

/**
 * The business written for a customer, with where each application came
 * from: an application written from a saved quote says so, and names that
 * quote's date, so "quoted -> written" reads as one line of work.
 */

import { FileCheck2, FileText } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { CarrierLogo, Panel } from '@/components/domain';
import { Button } from '@/components/ui/button';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { money, wholeDollars, type FexQuoteSummary } from '@/lib/fex/api';

import { QuoteBadge } from '../fex/customer/customer-quote-card';

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function CustomerApplicationsPanel({
  lead,
  quotes,
  onWriteApplication,
}: {
  lead: InsuranceLeadDetail;
  /** The customer's quotes, to name the one an application came from. */
  quotes: FexQuoteSummary[];
  /** Absent when the customer cannot be written from here (not final expense). */
  onWriteApplication?: () => void;
}): JSX.Element {
  const applications = lead.applications ?? [];
  const quoteById = new Map(quotes.map(q => [q.id, q]));

  return (
    <Panel className="min-w-0 overflow-hidden" id="applications">
      <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <h2 className="flex items-baseline gap-2 text-[15px] font-semibold text-ink">
          Applications
          {applications.length ? (
            <span className="text-[13px] font-medium tabular-nums text-ink-3">
              {applications.length}
            </span>
          ) : null}
        </h2>
      </div>
      {applications.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <p className="text-[13px] text-ink-2">No application written for this customer yet.</p>
          {onWriteApplication ? (
            <Button size="sm" variant="outline" onClick={onWriteApplication}>
              <FileCheck2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Write application
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y divide-rule">
          {applications.map(app => {
            const quote = app.fexQuoteId ? quoteById.get(app.fexQuoteId) : undefined;
            return (
              <li
                key={app.id}
                className={`flex items-center gap-4 px-4 py-3 ${app.voidedAt ? 'opacity-60' : ''}`}
              >
                <CarrierLogo names={[app.carrier]} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span
                      className={`truncate text-[14px] font-semibold text-ink ${app.voidedAt ? 'line-through' : ''}`}
                    >
                      {app.carrier}
                    </span>
                    {app.product ? (
                      <span className="truncate text-[13px] text-ink-2">{app.product}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-ink-3">
                    {app.submittedAt ? `Submitted ${shortDate(app.submittedAt)}` : 'Not submitted'}
                    {app.carrierApplicationNumber ? ` · #${app.carrierApplicationNumber}` : ''}
                    {app.callId ? (
                      <>
                        {' · '}
                        <Link
                          href={`/calls?call=${encodeURIComponent(app.callId)}`}
                          className="text-brand-ink hover:underline"
                        >
                          Call
                        </Link>
                      </>
                    ) : null}
                  </p>
                  <p className="mt-1.5 flex flex-wrap gap-1">
                    {app.voidedAt ? (
                      <QuoteBadge tone="neutral">Voided</QuoteBadge>
                    ) : (
                      <QuoteBadge tone="money">{app.status.replace(/_/g, ' ')}</QuoteBadge>
                    )}
                    {app.fexQuoteId ? (
                      <QuoteBadge tone="brand">
                        <FileText className="mr-1 h-3 w-3" aria-hidden />
                        From quote{quote ? ` · ${shortDate(quote.createdAt)}` : ''}
                      </QuoteBadge>
                    ) : null}
                  </p>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  {app.annualizedPremium !== null ? (
                    <span className="block text-[15px] font-semibold text-ink">
                      {money(app.annualizedPremium)}
                      <span className="text-[12px] font-medium text-ink-3">/yr</span>
                    </span>
                  ) : null}
                  {app.faceAmount ? (
                    <span className="block text-[12px] text-ink-2">
                      {wholeDollars(app.faceAmount)} coverage
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
