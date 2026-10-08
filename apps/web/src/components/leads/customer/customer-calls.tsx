'use client';

/**
 * The calls with a customer's number. On the customer page, a table with the
 * room to read it (when, direction, how long, how it ended, where it came
 * from); in the CRM sheet, a compact list. Every call opens in Calls, where
 * the recording and the full detail live.
 */

import { ArrowDownLeft, ArrowUpRight, ChevronRight, PhoneCall } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { EmptyState, formatEnumLabel } from '@/components/domain';
import type { InsuranceLeadCall } from '@/lib/api/leads';
import { cn } from '@/lib/utils';

import {
  dayHeading,
  dispositionTone,
  formatDateTime,
  formatSeconds,
  formatTime,
  groupByDay,
  type OutcomeTone,
} from './format';
import { Stat } from './workspace';

const callHref = (id: string) => `/calls?call=${encodeURIComponent(id)}`;

/** Someone was on the line. */
const talked = (call: InsuranceLeadCall) => (call.connectedDuration ?? 0) > 0;

function Duration({ seconds }: { seconds: number | null }): JSX.Element {
  if (seconds === null || seconds === 0) {
    return <span className="text-[14px] tabular-nums text-ink-3 opacity-60">0:00</span>;
  }
  return (
    <span className="text-[14px] font-semibold tabular-nums text-ink">
      {formatSeconds(seconds)}
    </span>
  );
}

const OUTCOME_DOT: Record<OutcomeTone, string> = {
  good: 'bg-live',
  bad: 'bg-dropped',
  neutral: 'bg-ink-3',
};

/** How the call ended: a dot for its family, the words in ink; nothing recorded recedes. */
export function Disposition({ value }: { value: string | null }): JSX.Element {
  if (!value || /^none$/i.test(value)) {
    return <span className="text-ink-3 opacity-60">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-2 font-medium text-ink">
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', OUTCOME_DOT[dispositionTone(value)])}
      />
      {formatEnumLabel(value)}
    </span>
  );
}

/** The calls as a communication log: the customer page's Calls tab. */
export function CustomerCallsTable({ calls }: { calls: InsuranceLeadCall[] }): JSX.Element {
  if (!calls.length) {
    return (
      <EmptyState
        icon={PhoneCall}
        headline="No calls yet"
        body="Calls to or from this customer's number show up here, newest first."
      />
    );
  }
  const connected = calls.filter(talked);
  const talkSeconds = connected.reduce((sum, c) => sum + (c.connectedDuration ?? 0), 0);
  const lastTalk = connected[0] ?? null;
  const groups = groupByDay(calls, c => c.createdAt);

  return (
    <div>
      <dl className="grid grid-cols-2 border-b border-rule md:grid-cols-4 md:divide-x md:divide-rule">
        <Stat className="px-7 py-4" label="Calls">
          {calls.length}
        </Stat>
        <Stat
          className="px-7 py-4"
          label="Connected"
          tone={connected.length ? undefined : 'muted'}
          sub={`${Math.round((connected.length / calls.length) * 100)}% of calls`}
        >
          {connected.length}
        </Stat>
        <Stat className="px-7 py-4" label="Talk time" tone={talkSeconds ? undefined : 'muted'}>
          {formatSeconds(talkSeconds)}
        </Stat>
        <Stat
          className="px-7 py-4"
          label="Last conversation"
          tone={lastTalk ? undefined : 'muted'}
          sub={
            lastTalk?.disposition && !/^none$/i.test(lastTalk.disposition)
              ? formatEnumLabel(lastTalk.disposition)
              : lastTalk
                ? `${formatSeconds(lastTalk.connectedDuration ?? 0)} talk time`
                : 'No call has connected'
          }
        >
          {lastTalk ? formatDateTime(lastTalk.createdAt) : 'None yet'}
        </Stat>
      </dl>

      <div
        aria-hidden
        className="hidden grid-cols-[96px_76px_minmax(0,1.2fr)_minmax(0,1.3fr)_80px_16px] gap-x-6 border-b border-rule bg-paper px-7 py-2.5 text-[12px] font-medium text-ink-3 md:grid"
      >
        <span>Day</span>
        <span>Time</span>
        <span>Call</span>
        <span>Outcome</span>
        <span className="text-right">Talk time</span>
        <span />
      </div>
      {groups.map(([at, items]) => (
        <section
          key={at}
          aria-label={dayHeading(at)}
          className="border-b border-rule last:border-b-0"
        >
          <h3 className="border-b border-rule bg-paper px-7 py-2 text-[12.5px] font-semibold text-ink-2 md:hidden">
            {dayHeading(at)}
          </h3>
          <ul>
            {items.map((call, i) => (
              <CallRow key={call.id} call={call} day={i === 0 ? dayHeading(at) : null} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CallRow({ call, day }: { call: InsuranceLeadCall; day: string | null }): JSX.Element {
  const live = talked(call);
  const outbound = call.direction === 'OUTBOUND';
  const Icon = outbound ? ArrowUpRight : ArrowDownLeft;
  const hasDisposition = Boolean(call.disposition && !/^none$/i.test(call.disposition));
  return (
    <li>
      <Link
        href={callHref(call.id)}
        aria-label={`${outbound ? 'Outbound' : 'Inbound'} call, ${formatDateTime(call.createdAt)}`}
        className="group grid grid-cols-[72px_minmax(0,1fr)_auto_16px] items-center gap-x-4 px-7 py-2.5 transition-colors hover:bg-paper focus-visible:bg-paper focus-visible:outline-none md:grid-cols-[96px_76px_minmax(0,1.2fr)_minmax(0,1.3fr)_80px_16px] md:gap-x-6"
      >
        <span className="hidden text-[13px] font-semibold text-ink-2 md:block">{day}</span>
        <span
          className={cn('text-[14px] tabular-nums', live ? 'font-semibold text-ink' : 'text-ink-3')}
        >
          {formatTime(call.createdAt)}
        </span>
        <span className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
              live ? 'bg-live-tint text-live-ink' : 'bg-sunken text-ink-3'
            )}
          >
            <Icon aria-hidden className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0">
            <span className={cn('block text-[14px] font-medium', live ? 'text-ink' : 'text-ink-2')}>
              {outbound ? 'Outbound' : 'Inbound'}
            </span>
            {call.campaignName || call.buyerName ? (
              <span className="block truncate text-[12.5px] text-ink-3">
                {[call.campaignName, call.buyerName].filter(Boolean).join(' · ')}
              </span>
            ) : null}
          </span>
        </span>
        <span className="hidden min-w-0 items-center gap-3 md:flex">
          {hasDisposition ? (
            <Disposition value={call.disposition} />
          ) : (
            <span className={cn('text-[14px]', live ? 'font-medium text-ink' : 'text-ink-3')}>
              {live ? 'Connected' : 'No connection'}
            </span>
          )}
        </span>
        <span className="text-right">
          <Duration seconds={call.connectedDuration} />
        </span>
        <ChevronRight
          aria-hidden
          className="h-4 w-4 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </Link>
    </li>
  );
}

/** The calls in a narrow column: the CRM sheet, and Overview's rail. */
export function CustomerCallList({
  calls,
  limit,
}: {
  calls: InsuranceLeadCall[];
  limit?: number;
}): JSX.Element {
  if (!calls.length) {
    return <p className="text-[13.5px] text-ink-3">No calls with this number yet.</p>;
  }
  return (
    <ul className="-mx-2">
      {calls.slice(0, limit).map(call => {
        const live = talked(call);
        const hasDisposition = Boolean(call.disposition && !/^none$/i.test(call.disposition));
        return (
          <li key={call.id}>
            <Link
              href={callHref(call.id)}
              className="group flex items-center justify-between gap-3 rounded-[8px] px-2 py-2 transition-colors hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0">
                <span
                  className={cn(
                    'block text-[13.5px] tabular-nums',
                    live ? 'font-semibold text-ink' : 'text-ink-2'
                  )}
                >
                  {formatDateTime(call.createdAt)}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[12.5px] text-ink-3">
                  <span className="shrink-0">
                    {call.direction === 'OUTBOUND' ? 'Outbound' : 'Inbound'}
                  </span>
                  {hasDisposition ? (
                    <span className="min-w-0 truncate [&_*]:text-[12.5px]">
                      <Disposition value={call.disposition} />
                    </span>
                  ) : (
                    <span className="truncate">{live ? 'Connected' : 'No connection'}</span>
                  )}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <Duration seconds={call.connectedDuration} />
                <ChevronRight
                  aria-hidden
                  className="h-4 w-4 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100"
                />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
