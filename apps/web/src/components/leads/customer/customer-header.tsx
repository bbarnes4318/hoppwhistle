'use client';

/**
 * The top of a customer's workspace, in three registers:
 *
 *   primary      the name and stage, how to reach them, and the actions
 *   secondary    the facts the quoter prices on, as quiet chips
 *   operational  follow-up, tasks, last contact, owner: one tight cluster
 *                under the actions, where the next move is decided
 *
 * Only one action is filled at a time: the page passes which one is the
 * next step (`primary`), and the others stay outlined.
 */

import { ArrowLeft, Calculator, FileCheck2, FileText, Loader2, PhoneCall } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { StatusChip } from '@/components/domain';
import { Button } from '@/components/ui/button';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { formatPhoneNumber } from '@/lib/utils';

import { CustomerFactChips, CustomerWorkStatus } from './customer-facts';
import { stageLabel, stageTone } from './format';

export interface CustomerHeaderProps {
  lead: InsuranceLeadDetail;
  name: string;
  assignee: string | null;
  onCall: () => void;
  /** Absent when this customer is not quoted here (not final expense). */
  onQuote?: () => void;
  resumable?: boolean;
  onApplication: () => void;
  /** An application is on record: the button opens it instead. */
  written: boolean;
  preparing?: boolean;
  /** The header action that is the next step, filled; null when the page body holds it. */
  primary?: 'quote' | 'application' | null;
}

export function CustomerHeader({
  lead,
  name,
  assignee,
  onCall,
  onQuote,
  resumable = false,
  onApplication,
  written,
  preparing = false,
  primary = null,
}: CustomerHeaderProps): JSX.Element {
  return (
    <header>
      <Link
        href="/insurance-leads"
        className="inline-flex items-center gap-1 rounded-sm text-[12.5px] font-medium text-ink-3 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
        All customers
      </Link>

      <div className="mt-1 flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
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
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-[15px] text-ink">
            {lead.phone ? (
              <span className="font-medium tabular-nums">{formatPhoneNumber(lead.phone)}</span>
            ) : (
              <span className="text-ink-3">No phone on record</span>
            )}
            {lead.email ? (
              <>
                <span aria-hidden className="text-ink-3">
                  ·
                </span>
                <a
                  href={`mailto:${lead.email}`}
                  className="truncate text-ink-2 hover:text-ink hover:underline"
                >
                  {lead.email}
                </a>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex flex-col items-start gap-2.5 lg:items-end">
          <div className="flex flex-wrap items-center gap-2">
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
              <Button variant={primary === 'quote' ? 'default' : 'outline'} onClick={onQuote}>
                <Calculator aria-hidden className="h-4 w-4" />
                {resumable ? 'Resume quote' : 'Quote'}
              </Button>
            ) : null}
            <Button
              variant={primary === 'application' ? 'default' : 'outline'}
              disabled={preparing}
              onClick={onApplication}
            >
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
          <CustomerWorkStatus lead={lead} assignee={assignee} />
        </div>
      </div>
      <div className="mt-3">
        <CustomerFactChips lead={lead} />
      </div>
    </header>
  );
}
