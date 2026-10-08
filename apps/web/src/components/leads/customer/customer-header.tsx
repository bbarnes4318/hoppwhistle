'use client';

/**
 * The command center: the top of the customer's sheet.
 *
 *   identity     name and stage, how to reach them, and the facts the quoter
 *                prices on, read as one line of prose rather than tags
 *   actions      Call, Quote, the application -- one of them filled, the
 *                one the page says is next
 *   operations   a full-width strip of the facts that run the sale: what to
 *                do next (with the button to do it), the last contact, open
 *                tasks, who owns the customer
 */

import {
  ArrowLeft,
  Calculator,
  CalendarPlus,
  Check,
  FileCheck2,
  FileText,
  Loader2,
  PhoneCall,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { StatusChip, formatEnumLabel } from '@/components/domain';
import { Button } from '@/components/ui/button';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { customerFacts } from '@/lib/fex/customer';
import { parseDob } from '@/lib/fex/prefill';
import { cn, formatPhoneNumber } from '@/lib/utils';

import {
  formatDateTime,
  formatSeconds,
  formatShortDay,
  openTasks,
  requestedCoverage,
  stageLabel,
  stageTone,
} from './format';
import type { NextAction } from './next-action';
import { Kicker, Stat } from './workspace';

export interface CustomerHeaderProps {
  lead: InsuranceLeadDetail;
  name: string;
  assignee: string | null;
  next: NextAction;
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
  onScheduleFollowUp: () => void;
  onCompleteTask: (taskId: string) => void;
  completingTask?: boolean;
  /** The page body already offers the next action's step: show the action, not a second button. */
  hideNextStep?: boolean;
}

/** "Knoxville, TN · Age 50 · Male · Non-tobacco · $10,000 requested", with gaps said quietly. */
function FactLine({ lead }: { lead: InsuranceLeadDetail }): JSX.Element {
  const facts = customerFacts(lead);
  const fe = lead.vertical === 'FE';
  const dob = parseDob(lead.birthDate);
  const coverage = requestedCoverage(lead);
  const place = facts.state ? [lead.city, facts.state].filter(Boolean).join(', ') : null;

  const items: Array<{ key: string; text: React.ReactNode; missing?: boolean }> =
    lead.vertical === 'B2B'
      ? [
          { key: 'industry', text: lead.industry ?? 'Industry unknown', missing: !lead.industry },
          { key: 'place', text: place ?? 'State unknown', missing: !place },
        ]
      : [
          { key: 'place', text: place ?? 'State unknown', missing: !place },
          {
            key: 'age',
            text:
              facts.age !== null ? (
                <>
                  Age {facts.age}
                  {dob ? <span className="text-ink-3"> (DOB {lead.birthDate})</span> : null}
                </>
              ) : (
                'Age unknown'
              ),
            missing: facts.age === null,
          },
          {
            key: 'sex',
            text: facts.sex === 'F' ? 'Female' : facts.sex === 'M' ? 'Male' : 'Sex unknown',
            missing: !facts.sex,
          },
          ...(fe
            ? [
                {
                  key: 'tobacco',
                  text:
                    facts.tobacco === null
                      ? 'Tobacco unknown'
                      : facts.tobacco
                        ? 'Tobacco'
                        : 'Non-tobacco',
                  missing: facts.tobacco === null,
                },
                {
                  key: 'coverage',
                  text: coverage ? `${coverage} requested` : 'Coverage not set',
                  missing: !coverage,
                },
              ]
            : []),
        ];

  return (
    <p
      aria-label="Customer facts"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]"
    >
      {items.map((item, i) => (
        <React.Fragment key={item.key}>
          {i > 0 ? (
            <span aria-hidden className="text-rule-strong">
              ·
            </span>
          ) : null}
          <span className={item.missing ? 'text-ink-3' : 'font-medium text-ink-2'}>
            {item.text}
          </span>
        </React.Fragment>
      ))}
    </p>
  );
}

function NextActionCell({
  next,
  onScheduleFollowUp,
  onApplication,
  onQuote,
  onCompleteTask,
  completingTask,
  hideStep,
}: {
  next: NextAction;
  hideStep?: boolean;
  onScheduleFollowUp: () => void;
  onApplication: () => void;
  onQuote?: () => void;
  onCompleteTask: (taskId: string) => void;
  completingTask?: boolean;
}): JSX.Element {
  const action =
    next.kind === 'task' && next.task ? (
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        disabled={completingTask}
        onClick={() => onCompleteTask(next.task!.id)}
      >
        {completingTask ? (
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check aria-hidden className="h-3.5 w-3.5" />
        )}
        Mark done
      </Button>
    ) : next.kind === 'application' ? (
      <Button size="sm" variant="outline" className="h-8" onClick={onApplication}>
        <FileCheck2 aria-hidden className="h-3.5 w-3.5" />
        Write it
      </Button>
    ) : next.kind === 'quote' && onQuote ? (
      <Button size="sm" variant="outline" className="h-8" onClick={onQuote}>
        <Calculator aria-hidden className="h-3.5 w-3.5" />
        Start quote
      </Button>
    ) : (
      <Button size="sm" variant="outline" className="h-8" onClick={onScheduleFollowUp}>
        <CalendarPlus aria-hidden className="h-3.5 w-3.5" />
        {next.kind === 'follow-up' ? 'Reschedule' : 'Schedule follow-up'}
      </Button>
    );

  return (
    <div
      className={cn(
        'relative flex min-w-0 items-center justify-between gap-4 px-7 py-3.5',
        next.kind !== 'none' && 'bg-brand-tint',
        next.overdue && 'bg-dropped-tint'
      )}
    >
      {next.kind !== 'none' ? (
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-0 left-0 w-[3px]',
            next.overdue ? 'bg-dropped' : 'bg-brand-strong'
          )}
        />
      ) : null}
      <div className="min-w-0">
        <Kicker
          className={
            next.overdue ? 'text-dropped-ink' : next.kind !== 'none' ? 'text-brand-ink' : undefined
          }
        >
          Next action
        </Kicker>
        <p
          className={cn(
            'mt-1.5 truncate text-[16px] font-semibold leading-5',
            next.kind === 'none' ? 'text-ink-2' : next.overdue ? 'text-dropped-ink' : 'text-ink'
          )}
        >
          {next.title}
        </p>
        <p className="mt-0.5 truncate text-[13px] text-ink-3">
          {next.detail ?? 'No follow-up or task is set for this customer.'}
        </p>
      </div>
      {hideStep ? null : <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CustomerHeader({
  lead,
  name,
  assignee,
  next,
  onCall,
  onQuote,
  resumable = false,
  onApplication,
  written,
  preparing = false,
  primary = null,
  onScheduleFollowUp,
  onCompleteTask,
  completingTask,
  hideNextStep = false,
}: CustomerHeaderProps): JSX.Element {
  const { open, overdue } = openTasks(lead);
  const lastCall = lead.calls?.[0] ?? null;
  const lastCallLine = lastCall
    ? [
        lastCall.direction === 'OUTBOUND' ? 'Outbound' : 'Inbound',
        lastCall.disposition && !/^none$/i.test(lastCall.disposition)
          ? formatEnumLabel(lastCall.disposition)
          : (lastCall.connectedDuration ?? 0) > 0
            ? `Talked ${formatSeconds(lastCall.connectedDuration ?? 0)}`
            : 'No connection',
      ].join(' · ')
    : null;

  return (
    <header>
      <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-4 px-7 pb-4 pt-4">
        <div className="min-w-0 flex-1">
          <Link
            href="/insurance-leads"
            className="inline-flex items-center gap-1 rounded-sm text-[12.5px] font-medium text-ink-3 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
            All customers
          </Link>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="truncate text-[28px] font-semibold leading-[34px] tracking-[-0.02em] text-ink">
              {name}
            </h1>
            <StatusChip
              value={lead.leadStage ?? 'NEW'}
              label={stageLabel(lead.leadStage)}
              tone={stageTone(lead.leadStage)}
            />
            {lead.doNotCall ? <StatusChip value="DNC" label="Do not call" tone="blocked" /> : null}
          </div>
          <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
            {lead.phone ? (
              <span className="font-semibold tabular-nums text-ink">
                {formatPhoneNumber(lead.phone)}
              </span>
            ) : (
              <span className="text-ink-3">No phone on record</span>
            )}
            {lead.email ? (
              <a
                href={`mailto:${lead.email}`}
                className="truncate text-ink-2 hover:text-ink hover:underline"
              >
                {lead.email}
              </a>
            ) : null}
          </p>
          <div className="mt-2">
            <FactLine lead={lead} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-6">
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
      </div>

      <div
        aria-label="Where the work stands"
        className="grid grid-cols-1 border-t border-rule sm:grid-cols-2 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] lg:divide-x lg:divide-rule"
      >
        <NextActionCell
          next={next}
          onScheduleFollowUp={onScheduleFollowUp}
          onApplication={onApplication}
          onQuote={onQuote}
          onCompleteTask={onCompleteTask}
          completingTask={completingTask}
          hideStep={hideNextStep}
        />
        <Stat
          className="px-7 py-3.5"
          label="Last contact"
          tone={lead.lastContactedAt ? undefined : 'muted'}
          sub={lastCallLine ?? 'No calls with this number'}
        >
          {formatDateTime(lead.lastContactedAt) ?? 'Never contacted'}
        </Stat>
        <Stat
          className="px-7 py-3.5"
          label="Open tasks"
          tone={overdue ? 'danger' : open.length ? undefined : 'muted'}
          sub={overdue ? `${overdue} overdue` : open.length ? 'None overdue' : 'Nothing to do'}
        >
          {open.length ? `${open.length} open` : 'None'}
        </Stat>
        <Stat
          className="px-7 py-3.5"
          label="Owner"
          tone={assignee ? undefined : 'muted'}
          sub={lead.assignedAt ? `Since ${formatShortDay(lead.assignedAt)}` : lead.source}
        >
          {assignee ?? 'Unassigned'}
        </Stat>
      </div>
    </header>
  );
}
