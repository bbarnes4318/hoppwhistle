'use client';

/**
 * Who the customer is and where the sale stands, read-only, beside the
 * sales work on Overview. Editing is one deliberate step away (Edit), never
 * a page of open inputs.
 */

import { Mail, MapPin, Pencil, Phone } from 'lucide-react';
import * as React from 'react';

import { Panel, StatusChip } from '@/components/domain';
import { Button } from '@/components/ui/button';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { formatPhoneNumber } from '@/lib/utils';

import {
  addressLines,
  formatDateTime,
  formatDay,
  priorityLabel,
  stageLabel,
  stageTone,
} from './format';
import type { LeadSectionId } from './lead-fields';
import { ReadField, ReadList } from './read-fields';

function ContactLine({
  icon: Icon,
  children,
  empty,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children?: React.ReactNode;
  empty: string;
}): JSX.Element {
  return (
    <li className="flex min-w-0 items-start gap-3 py-1">
      <Icon aria-hidden className="mt-[3px] h-4 w-4 shrink-0 text-ink-3" />
      <span
        className={children ? 'min-w-0 break-words text-[14px] text-ink' : 'text-[14px] text-ink-3'}
      >
        {children || empty}
      </span>
    </li>
  );
}

export function CustomerSummaryCard({
  lead,
  assignee,
  onEdit,
}: {
  lead: InsuranceLeadDetail;
  assignee: string | null;
  onEdit: (section?: LeadSectionId) => void;
}): JSX.Element {
  const address = addressLines(lead);
  const followUpDue = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) < new Date() : false;

  return (
    <Panel className="min-w-0 overflow-hidden" aria-labelledby="customer-summary-title">
      <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3">
        <h2 id="customer-summary-title" className="text-[16px] font-semibold text-ink">
          Customer
        </h2>
        <Button size="sm" variant="outline" onClick={() => onEdit()}>
          <Pencil aria-hidden className="h-3.5 w-3.5" />
          Edit customer
        </Button>
      </div>

      <section aria-label="Contact" className="px-5 py-3.5">
        <ul>
          <ContactLine icon={Phone} empty="No phone on record">
            {lead.phone ? (
              <span className="tabular-nums">{formatPhoneNumber(lead.phone)}</span>
            ) : null}
          </ContactLine>
          <ContactLine icon={Mail} empty="No email on record">
            {lead.email ? (
              <a href={`mailto:${lead.email}`} className="hover:underline">
                {lead.email}
              </a>
            ) : null}
          </ContactLine>
          <ContactLine icon={MapPin} empty="No address on record">
            {address.length ? (
              <>
                {address.map(line => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </>
            ) : null}
          </ContactLine>
        </ul>
      </section>

      <section
        aria-labelledby="sales-status-title"
        className="border-t border-rule px-5 pb-3 pt-3.5"
      >
        <div className="flex items-center justify-between gap-2">
          <h3
            id="sales-status-title"
            className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3"
          >
            Sales status
          </h3>
          <button
            type="button"
            onClick={() => onEdit('crm')}
            className="rounded-sm text-[12.5px] font-medium text-brand-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Change
          </button>
        </div>
        <ReadList className="mt-1.5">
          <ReadField label="Stage" labelWidth="sm">
            <StatusChip
              size="sm"
              value={lead.leadStage ?? 'NEW'}
              label={stageLabel(lead.leadStage)}
              tone={stageTone(lead.leadStage)}
            />
          </ReadField>
          <ReadField label="Priority" labelWidth="sm">
            {priorityLabel(lead.priority) ?? <span className="text-ink-3">Normal</span>}
          </ReadField>
          <ReadField label="Follow-up" labelWidth="sm">
            {lead.nextFollowUpAt ? (
              <span className={followUpDue ? 'font-medium text-ringing-ink' : undefined}>
                {formatDateTime(lead.nextFollowUpAt)}
                {followUpDue ? ' · due' : ''}
              </span>
            ) : (
              <span className="text-ink-3">None set</span>
            )}
          </ReadField>
          <ReadField label="Assigned to" labelWidth="sm">
            {assignee ?? <span className="text-ink-3">Unassigned</span>}
          </ReadField>
          <ReadField label="Last contact" labelWidth="sm">
            {formatDateTime(lead.lastContactedAt) ?? <span className="text-ink-3">Never</span>}
          </ReadField>
          <ReadField label="Customer since" labelWidth="sm">
            {formatDay(lead.createdAt)}
            {lead.source ? <span className="text-ink-3"> · {lead.source}</span> : null}
          </ReadField>
        </ReadList>
      </section>
    </Panel>
  );
}
