'use client';

/**
 * The customer at a glance, under their name: the facts the quoter prices on
 * (state, age, sex, tobacco, coverage) as one row of chips, and where the
 * work stands (follow-up, open tasks, last contact, who holds them).
 *
 * A fact the record does not have is said plainly -- "Tobacco not entered"
 * -- in a quieter, dashed chip: it is the next thing to ask, not a blank.
 */

import { CalendarClock, ListChecks, PhoneIncoming, UserRound } from 'lucide-react';
import * as React from 'react';

import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { customerFacts } from '@/lib/fex/customer';
import { parseDob } from '@/lib/fex/prefill';
import { cn } from '@/lib/utils';

import { formatDateTime, formatDay, openTasks, requestedCoverage } from './format';

function Chip({ value, missing }: { value: string | null; missing: string }): JSX.Element {
  return (
    <li
      className={cn(
        'inline-flex h-7 items-center whitespace-nowrap rounded-full border px-3 text-[13px]',
        value
          ? 'border-rule bg-surface font-medium text-ink'
          : 'border-dashed border-rule-strong font-normal text-ink-3'
      )}
    >
      {value ?? missing}
    </li>
  );
}

function Status({
  icon: Icon,
  children,
  tone,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  tone?: 'warn';
  title?: string;
}): JSX.Element {
  return (
    <li
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]',
        tone === 'warn' ? 'font-medium text-ringing-ink' : 'text-ink-2'
      )}
    >
      <Icon aria-hidden className={cn('h-4 w-4', tone === 'warn' ? '' : 'text-ink-3')} />
      {children}
    </li>
  );
}

export function CustomerFacts({
  lead,
  assignee,
}: {
  lead: InsuranceLeadDetail;
  /** Who holds the customer, when the viewer can know it. */
  assignee: string | null;
}): JSX.Element {
  const facts = customerFacts(lead);
  const fe = lead.vertical === 'FE';
  const dob = parseDob(lead.birthDate);
  const { open, overdue } = openTasks(lead);
  const followUp = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
  const followUpDue = followUp ? followUp < new Date() : false;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5">
      <ul aria-label="Customer facts" className="flex flex-wrap items-center gap-1.5">
        {lead.vertical === 'B2B' ? (
          <>
            <Chip value={lead.industry} missing="Industry not entered" />
            <Chip value={facts.state} missing="State not entered" />
          </>
        ) : (
          <>
            <Chip value={facts.state} missing="State not entered" />
            <li
              className={cn(
                'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px]',
                facts.age !== null
                  ? 'border-rule bg-surface font-medium text-ink'
                  : 'border-dashed border-rule-strong text-ink-3'
              )}
            >
              {facts.age !== null ? `Age ${facts.age}` : 'Age not entered'}
              {facts.age !== null && dob ? (
                <span className="font-normal text-ink-3">DOB {lead.birthDate}</span>
              ) : null}
            </li>
            <Chip
              value={facts.sex === 'F' ? 'Female' : facts.sex === 'M' ? 'Male' : null}
              missing="Sex not entered"
            />
            {fe ? (
              <Chip
                value={facts.tobacco === null ? null : facts.tobacco ? 'Tobacco' : 'Non-tobacco'}
                missing="Tobacco not entered"
              />
            ) : null}
            {fe ? (
              <Chip
                value={requestedCoverage(lead) ? `${requestedCoverage(lead)} coverage` : null}
                missing="Coverage not entered"
              />
            ) : null}
          </>
        )}
      </ul>

      <ul
        aria-label="Where the work stands"
        className="flex flex-wrap items-center gap-x-5 gap-y-1"
      >
        <Status
          icon={CalendarClock}
          tone={followUpDue ? 'warn' : undefined}
          title={followUp ? (formatDateTime(lead.nextFollowUpAt) ?? undefined) : undefined}
        >
          {followUp
            ? `${followUpDue ? 'Follow-up was due' : 'Follow up'} ${formatDay(lead.nextFollowUpAt)}`
            : 'No follow-up set'}
        </Status>
        <Status icon={ListChecks} tone={overdue ? 'warn' : undefined}>
          {open.length} open task{open.length === 1 ? '' : 's'}
          {overdue ? ` · ${overdue} overdue` : ''}
        </Status>
        <Status icon={PhoneIncoming} title={formatDateTime(lead.lastContactedAt) ?? undefined}>
          {lead.lastContactedAt
            ? `Last contact ${formatDay(lead.lastContactedAt)}`
            : 'Never contacted'}
        </Status>
        {assignee ? (
          <Status icon={UserRound}>{assignee === 'You' ? 'Assigned to you' : assignee}</Status>
        ) : null}
      </ul>
    </div>
  );
}
