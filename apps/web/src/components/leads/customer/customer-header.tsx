'use client';

/**
 * The top of a customer's workspace: who they are, how to reach them, and
 * the three things an agent does next -- Call, Quote, write the application
 * -- in the one place they live on this page.
 */

import { ArrowLeft, Calculator, FileCheck2, FileText, Loader2, PhoneCall } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { StatusChip } from '@/components/domain';
import { Button } from '@/components/ui/button';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { formatPhoneNumber } from '@/lib/utils';

import { addressLines, stageLabel, stageTone } from './format';

export interface CustomerHeaderProps {
  lead: InsuranceLeadDetail;
  name: string;
  onCall: () => void;
  /** Absent when this customer is not quoted here (not final expense). */
  onQuote?: () => void;
  resumable?: boolean;
  onApplication: () => void;
  /** An application is on record: the button opens it instead. */
  written: boolean;
  preparing?: boolean;
}

export function CustomerHeader({
  lead,
  name,
  onCall,
  onQuote,
  resumable = false,
  onApplication,
  written,
  preparing = false,
}: CustomerHeaderProps): JSX.Element {
  const place = addressLines(lead).at(-1) ?? null;
  const reach = [
    lead.phone ? (
      <span key="phone" className="tabular-nums">
        {formatPhoneNumber(lead.phone)}
      </span>
    ) : null,
    lead.email ? (
      <a
        key="email"
        href={`mailto:${lead.email}`}
        className="truncate hover:text-ink hover:underline"
      >
        {lead.email}
      </a>
    ) : null,
    place ? <span key="place">{place}</span> : null,
  ].filter(Boolean);

  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <Link
          href="/insurance-leads"
          className="inline-flex items-center gap-1 rounded-sm text-[12.5px] font-medium text-ink-3 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
          All customers
        </Link>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="truncate text-[26px] font-semibold leading-8 tracking-[-0.015em] text-ink">
            {name}
          </h1>
          <StatusChip
            value={lead.leadStage ?? 'NEW'}
            label={stageLabel(lead.leadStage)}
            tone={stageTone(lead.leadStage)}
          />
          {lead.doNotCall ? <StatusChip value="DNC" label="Do not call" tone="blocked" /> : null}
        </div>
        {reach.length ? (
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-[14px] text-ink-2">
            {reach.map((item, i) => (
              <React.Fragment key={i}>
                {i > 0 ? (
                  <span aria-hidden className="text-ink-3">
                    ·
                  </span>
                ) : null}
                {item}
              </React.Fragment>
            ))}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 pt-5">
        {lead.phone ? (
          <Button
            variant="outline"
            disabled={lead.doNotCall}
            title={lead.doNotCall ? 'This customer is on Do Not Call' : undefined}
            onClick={onCall}
          >
            <PhoneCall aria-hidden className="h-4 w-4" />
            Call
          </Button>
        ) : null}
        {onQuote ? (
          <Button onClick={onQuote}>
            <Calculator aria-hidden className="h-4 w-4" />
            {resumable ? 'Resume quote' : 'Quote'}
          </Button>
        ) : null}
        <Button variant="outline" disabled={preparing} onClick={onApplication}>
          {preparing ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : written ? (
            <FileText aria-hidden className="h-4 w-4" />
          ) : (
            <FileCheck2 aria-hidden className="h-4 w-4" />
          )}
          {written ? 'View application' : 'Write application'}
        </Button>
      </div>
    </header>
  );
}
