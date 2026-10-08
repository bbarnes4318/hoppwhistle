'use client';

/**
 * The customer at a glance, in two registers.
 *
 * `CustomerFactChips` -- what the quoter prices on (where they live, age,
 * sex, tobacco, coverage): quiet chips under the name. A fact the record does
 * not have is said plainly ("Tobacco not entered") in a dashed outline: it is
 * the next thing to ask, not a blank.
 *
 * `CustomerWorkStatus` -- where the work stands (follow-up, open tasks, last
 * contact, who holds them): one tight, divided cluster beside the actions,
 * so it reads as operational state rather than more facts about the person.
 */

import { CalendarClock, ListChecks, PhoneIncoming, UserRound } from 'lucide-react';
import * as React from 'react';

import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { customerFacts } from '@/lib/fex/customer';
import { parseDob } from '@/lib/fex/prefill';
import { cn } from '@/lib/utils';

import { formatDateTime, formatShortDay, openTasks, requestedCoverage } from './format';

function Chip({
  value,
  missing,
  hint,
}: {
  value: string | null;
  missing: string;
  hint?: string | null;
}): JSX.Element {
  return (
    <li
      className={cn(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 text-[13px]',
        value
          ? 'bg-sunken font-medium text-ink'
          : 'border border-dashed border-rule-strong font-normal text-ink-3'
      )}
    >
      {value ?? missing}
      {value && hint ? <span className="font-normal text-ink-3">{hint}</span> : null}
    </li>
  );
}

export function CustomerFactChips({ lead }: { lead: InsuranceLeadDetail }): JSX.Element {
  const facts = customerFacts(lead);
  const fe = lead.vertical === 'FE';
  const dob = parseDob(lead.birthDate);
  const coverage = requestedCoverage(lead);
  // The town says where they are better than the state alone; the state is in it.
  const place = facts.state ? [lead.city, facts.state].filter(Boolean).join(', ') : null;

  return (
    <ul aria-label="Customer facts" className="flex flex-wrap items-center gap-1.5">
      {lead.vertical === 'B2B' ? (
        <>
          <Chip value={lead.industry} missing="Industry not entered" />
          <Chip value={place} missing="State not entered" />
        </>
      ) : (
        <>
          <Chip value={place} missing="State not entered" />
          <Chip
            value={facts.age !== null ? `Age ${facts.age}` : null}
            hint={dob ? `DOB ${lead.birthDate}` : null}
            missing="Age not entered"
          />
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
            <Chip value={coverage ? `${coverage} coverage` : null} missing="Coverage not entered" />
          ) : null}
        </>
      )}
    </ul>
  );
}

function Status({
  icon: Icon,
  children,
  warn = false,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  warn?: boolean;
  title?: string;
}): JSX.Element {
  return (
    <li
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap px-3 first:pl-0 last:pr-0',
        warn ? 'font-medium text-ringing-ink' : 'text-ink-2'
      )}
    >
      <Icon aria-hidden className={cn('h-3.5 w-3.5', warn ? '' : 'text-ink-3')} />
      {children}
    </li>
  );
}

export function CustomerWorkStatus({
  lead,
  assignee,
  className,
}: {
  lead: InsuranceLeadDetail;
  /** Who holds the customer, when the viewer can know it. */
  assignee: string | null;
  className?: string;
}): JSX.Element {
  const { open, overdue } = openTasks(lead);
  const followUp = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
  const followUpDue = followUp ? followUp < new Date() : false;

  return (
    <ul
      aria-label="Where the work stands"
      className={cn(
        'flex flex-wrap items-center gap-y-1 divide-x divide-rule text-[12.5px]',
        className
      )}
    >
      <Status
        icon={CalendarClock}
        warn={followUpDue}
        title={followUp ? (formatDateTime(lead.nextFollowUpAt) ?? undefined) : undefined}
      >
        {followUp
          ? `${followUpDue ? 'Follow-up was due' : 'Follow up'} ${formatShortDay(lead.nextFollowUpAt)}`
          : 'No follow-up'}
      </Status>
      <Status icon={ListChecks} warn={overdue > 0}>
        {open.length} open task{open.length === 1 ? '' : 's'}
        {overdue ? ` · ${overdue} overdue` : ''}
      </Status>
      <Status icon={PhoneIncoming} title={formatDateTime(lead.lastContactedAt) ?? undefined}>
        {lead.lastContactedAt
          ? `Contacted ${formatShortDay(lead.lastContactedAt)}`
          : 'Never contacted'}
      </Status>
      {assignee ? (
        <Status icon={UserRound}>{assignee === 'You' ? 'Assigned to you' : assignee}</Status>
      ) : null}
    </ul>
  );
}
