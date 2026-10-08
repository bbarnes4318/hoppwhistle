'use client';

/**
 * The business written for a customer, as a band of the Overview sheet.
 *
 * Not started: says so, names the plan it would be written from, and offers
 * the step (unless the selected plan above already does). Written: the
 * carrier and plan, the premium, and a status track drawn only from what
 * the record holds -- written (created), submitted (submittedAt), and the
 * carrier's word once the status is past "submitted". Nothing is inferred.
 */

import { Check, FileCheck2, PhoneCall } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { StatusChip, formatEnumLabel } from '@/components/domain';
import { Button } from '@/components/ui/button';
import type { InsuranceLeadApplication, InsuranceLeadDetail } from '@/lib/api/leads';
import { money, wholeDollars, type FexQuoteSummary } from '@/lib/fex/api';
import { cn } from '@/lib/utils';

import { formatDay } from './format';
import { CarrierMark, Section } from './workspace';

/** Statuses that mean the carrier has not answered yet. */
const AWAITING = new Set(['PENDING', 'SUBMITTED', 'UW_REVIEW', 'IN_REVIEW']);
const BAD = /DECLIN|NOT_TAKEN|LAPS|CANCEL|WITHDR/;

function Step({
  done,
  tone = 'good',
  label,
  detail,
}: {
  done: boolean;
  tone?: 'good' | 'bad';
  label: string;
  detail?: string | null;
}): JSX.Element {
  return (
    <li className="flex min-w-0 flex-1 items-start gap-2.5">
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full',
          !done
            ? 'border border-dashed border-rule-strong'
            : tone === 'bad'
              ? 'bg-dropped text-white'
              : 'bg-live text-white'
        )}
      >
        {done ? <Check className="h-3 w-3" /> : null}
      </span>
      <span className="min-w-0">
        <span className={cn('block text-[13.5px] font-medium', done ? 'text-ink' : 'text-ink-3')}>
          {label}
        </span>
        {detail ? <span className="block text-[12.5px] text-ink-3">{detail}</span> : null}
      </span>
    </li>
  );
}

function Track({ app }: { app: InsuranceLeadApplication }): JSX.Element {
  const status = app.status?.toUpperCase() ?? '';
  const decided = status && !AWAITING.has(status);
  return (
    <ol aria-label="Application progress" className="flex flex-wrap gap-x-6 gap-y-3">
      <Step done label="Written" detail={formatDay(app.createdAt)} />
      <Step
        done={Boolean(app.submittedAt)}
        label={app.submittedAt ? 'Submitted' : 'Not submitted'}
        detail={app.submittedAt ? formatDay(app.submittedAt) : null}
      />
      <Step
        done={Boolean(decided)}
        tone={BAD.test(status) ? 'bad' : 'good'}
        label={decided ? formatEnumLabel(status) : 'Carrier decision'}
        detail={decided ? null : 'Not recorded yet'}
      />
    </ol>
  );
}

export function CustomerApplicationCard({
  lead,
  quotes,
  onWriteApplication,
  writeFrom,
  divided = true,
}: {
  lead: InsuranceLeadDetail;
  /** The customer's quotes, to date the one an application came from. */
  quotes: FexQuoteSummary[];
  /** Offered when no application exists and nothing above already offers it. */
  onWriteApplication?: () => void;
  /** The plan it would be written from, when one is selected. */
  writeFrom?: string | null;
  /** A hairline above it: off when it is the first band of the sheet. */
  divided?: boolean;
}): JSX.Element {
  const applications = lead.applications ?? [];
  const quoteById = new Map(quotes.map(q => [q.id, q]));

  if (!applications.length) {
    return (
      <Section id="applications" title="Application" divided={divided}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <StatusChip value="NOT_STARTED" label="Not started" tone="neutral" />
            <p className="text-[14px] text-ink-2">
              {writeFrom ? (
                <>
                  Start from <span className="font-medium text-ink">{writeFrom}</span>
                </>
              ) : (
                'No application written for this customer yet.'
              )}
            </p>
          </div>
          {onWriteApplication ? (
            <Button variant="outline" onClick={onWriteApplication}>
              <FileCheck2 className="h-4 w-4" aria-hidden />
              Write application
            </Button>
          ) : null}
        </div>
      </Section>
    );
  }

  return (
    <Section
      id="applications"
      title="Application"
      divided={divided}
      meta={applications.length > 1 ? `${applications.length} on record` : null}
    >
      <ul className="divide-y divide-rule">
        {applications.map(app => {
          const quote = app.fexQuoteId ? quoteById.get(app.fexQuoteId) : undefined;
          const voided = Boolean(app.voidedAt);
          return (
            <li key={app.id} className={cn('py-4 first:pt-0 last:pb-0', voided && 'opacity-60')}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-8 gap-y-3">
                <div className="flex min-w-0 items-start gap-4">
                  <span className="flex w-[112px] shrink-0 pt-0.5">
                    <CarrierMark names={[app.carrier]} height={30} maxWidth={112} />
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'text-[15px] font-semibold text-ink',
                          voided && 'line-through'
                        )}
                      >
                        {app.product || app.carrier}
                      </span>
                      {voided ? (
                        <StatusChip value="VOIDED" label="Voided" tone="neutral" size="sm" />
                      ) : (
                        <StatusChip value={app.status} size="sm" />
                      )}
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink-3">
                      {[
                        app.product ? app.carrier : null,
                        app.carrierApplicationNumber ? `#${app.carrierApplicationNumber}` : null,
                        app.fexQuoteId
                          ? `From the ${quote ? formatDay(quote.createdAt) : 'saved'} quote`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      {app.callId ? (
                        <>
                          {' · '}
                          <Link
                            href={`/calls?call=${encodeURIComponent(app.callId)}`}
                            className="inline-flex items-center gap-1 font-medium text-ink-2 hover:text-brand-ink"
                          >
                            <PhoneCall aria-hidden className="h-3 w-3" />
                            Sale call
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  {app.annualizedPremium !== null ? (
                    <p className="text-[18px] font-semibold text-ink">
                      {money(app.annualizedPremium)}
                      <span className="text-[13px] font-medium text-ink-3">/yr</span>
                    </p>
                  ) : null}
                  {app.faceAmount ? (
                    <p className="text-[13px] text-ink-2">
                      {wholeDollars(app.faceAmount)} coverage
                    </p>
                  ) : null}
                </div>
              </div>
              {voided ? null : (
                <div className="mt-4 rounded-[10px] bg-paper px-4 py-3">
                  <Track app={app} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
