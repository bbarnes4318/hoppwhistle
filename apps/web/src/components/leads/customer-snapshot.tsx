'use client';

/**
 * The customer at a glance: who they are to the quoter (state, age, sex,
 * tobacco, the coverage they asked about) and where they stand (stage, the
 * next follow-up, open tasks, last contact). One dense strip at the top of the
 * customer page, so an agent picking the record back up reads it in a second
 * instead of opening five sections.
 *
 * A fact the record does not have reads "Not on record" rather than a dash:
 * it is something to ask on the next call.
 */

import * as React from 'react';

import { Panel } from '@/components/domain';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { wholeDollars } from '@/lib/fex/api';
import { customerFacts } from '@/lib/fex/customer';
import { parseDob, parseFace } from '@/lib/fex/prefill';
import { cn } from '@/lib/utils';

const STAGE_LABEL: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  PROPOSAL: 'Proposal',
  UNDERWRITING: 'Underwriting',
  HOLD: 'Hold',
  CLOSED_WON: 'Closed won',
  CLOSED_LOST: 'Closed lost',
};

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function Fact({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode | null;
  hint?: React.ReactNode;
  tone?: 'warn' | 'bad';
}): JSX.Element {
  return (
    <div className="min-w-0 px-4 py-2.5">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-0.5 truncate text-[14px] font-semibold leading-5',
          value === null
            ? 'font-medium text-ink-3'
            : tone === 'bad'
              ? 'text-dropped-ink'
              : tone === 'warn'
                ? 'text-ringing-ink'
                : 'text-ink'
        )}
      >
        {value ?? 'Not on record'}
        {hint ? <span className="ml-1 text-[12px] font-normal text-ink-3">{hint}</span> : null}
      </dd>
    </div>
  );
}

export function CustomerSnapshot({ lead }: { lead: InsuranceLeadDetail }): JSX.Element {
  const facts = customerFacts(lead);
  const dob = parseDob(lead.birthDate);
  const face = parseFace(lead.faceAmount) ?? parseFace(lead.coverageAmount);
  const openTasks = (lead.tasks ?? []).filter(t => t.status === 'OPEN');
  const overdue = openTasks.filter(t => t.dueAt && new Date(t.dueAt) < new Date()).length;
  const followUp = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
  const followUpDue = followUp ? followUp < new Date() : false;
  const fe = lead.vertical === 'FE';

  return (
    <Panel className="min-w-0 overflow-hidden" aria-label="Customer snapshot">
      <dl className="grid grid-cols-2 divide-rule sm:grid-cols-4 xl:grid-cols-8 [&>div]:border-rule [&>div]:border-b xl:[&>div]:border-b-0 xl:[&>div:not(:first-child)]:border-l">
        <Fact label="State" value={facts.state} />
        <Fact
          label="Age"
          value={facts.age !== null ? facts.age : null}
          hint={dob ? `born ${lead.birthDate}` : null}
        />
        <Fact
          label="Sex"
          value={facts.sex === 'F' ? 'Female' : facts.sex === 'M' ? 'Male' : null}
        />
        {fe ? (
          <Fact
            label="Tobacco"
            value={facts.tobacco === null ? null : facts.tobacco ? 'Tobacco' : 'Non-tobacco'}
          />
        ) : null}
        {fe ? (
          <Fact label="Coverage asked" value={face !== null ? wholeDollars(face) : null} />
        ) : null}
        <Fact
          label="Stage"
          value={lead.leadStage ? (STAGE_LABEL[lead.leadStage] ?? lead.leadStage) : 'New'}
          tone={lead.doNotCall ? 'bad' : undefined}
          hint={lead.doNotCall ? 'DNC' : null}
        />
        <Fact
          label="Follow-up"
          value={followUp ? shortDate(followUp.toISOString()) : 'None set'}
          tone={followUpDue ? 'warn' : undefined}
          hint={followUpDue ? 'due' : null}
        />
        <Fact
          label="Open tasks"
          value={openTasks.length}
          tone={overdue ? 'warn' : undefined}
          hint={overdue ? `${overdue} overdue` : null}
        />
      </dl>
    </Panel>
  );
}
