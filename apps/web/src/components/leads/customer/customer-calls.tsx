'use client';

/**
 * The calls with a customer's number. On the customer page, a table with the
 * room to read it (when, direction, how long, how it ended, where it came
 * from); in the CRM sheet, a compact list. Every call opens in Calls, where
 * the recording and the full detail live.
 */

import { ArrowDownLeft, ArrowUpRight, PhoneCall } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { EmptyState, Panel, formatEnumLabel } from '@/components/domain';
import type { InsuranceLeadCall } from '@/lib/api/leads';
import { cn } from '@/lib/utils';

import { formatDateTime, formatSeconds } from './format';

const callHref = (id: string) => `/calls?call=${encodeURIComponent(id)}`;

function Direction({ direction }: { direction: string }): JSX.Element {
  const outbound = direction === 'OUTBOUND';
  const Icon = outbound ? ArrowUpRight : ArrowDownLeft;
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-2">
      <Icon aria-hidden className={cn('h-3.5 w-3.5', outbound ? 'text-brand-ink' : 'text-ink-3')} />
      {outbound ? 'Outbound' : 'Inbound'}
    </span>
  );
}

function Duration({ seconds }: { seconds: number | null }): JSX.Element {
  if (seconds === null) return <span className="text-ink-3">—</span>;
  return (
    <span className={seconds === 0 ? 'text-ink-3' : 'font-medium text-ink'}>
      {formatSeconds(seconds)}
    </span>
  );
}

/** The calls, full width: the customer page's Calls tab. */
export function CustomerCallsTable({ calls }: { calls: InsuranceLeadCall[] }): JSX.Element {
  if (!calls.length) {
    return (
      <Panel>
        <EmptyState
          icon={PhoneCall}
          headline="No calls yet"
          body="Calls to or from this customer's number show up here, newest first."
        />
      </Panel>
    );
  }
  const connected = calls.filter(c => (c.connectedDuration ?? 0) > 0).length;
  return (
    <Panel className="min-w-0 overflow-hidden" aria-labelledby="calls-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-5 py-3">
        <h2 id="calls-title" className="text-[16px] font-semibold text-ink">
          Call history
        </h2>
        <p className="text-[12.5px] text-ink-3">
          {calls.length} call{calls.length === 1 ? '' : 's'} · {connected} connected
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-rule text-[12px] font-medium text-ink-3">
              <th scope="col" className="px-5 py-2.5 font-medium">
                Date &amp; time
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Direction
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">
                Talk time
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Disposition
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Campaign / buyer
              </th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {calls.map(call => (
              <tr key={call.id} className="group transition-colors hover:bg-sunken">
                <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-ink">
                  {formatDateTime(call.createdAt)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <Direction direction={call.direction} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                  <Duration seconds={call.connectedDuration} />
                </td>
                <td className="px-3 py-2.5">
                  {call.disposition ? (
                    <span className="text-ink">{formatEnumLabel(call.disposition)}</span>
                  ) : (
                    <span className="text-ink-3">None</span>
                  )}
                </td>
                <td className="max-w-[260px] truncate px-3 py-2.5 text-ink-2">
                  {[call.campaignName, call.buyerName].filter(Boolean).join(' · ') || (
                    <span className="text-ink-3">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-5 py-2.5 text-right">
                  <Link
                    href={callHref(call.id)}
                    className="rounded-sm font-medium text-brand-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Open call
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** The calls in a narrow column: the CRM sheet, and Overview's recent calls. */
export function CustomerCallList({
  calls,
  limit,
}: {
  calls: InsuranceLeadCall[];
  limit?: number;
}): JSX.Element {
  if (!calls.length) {
    return <p className="text-[13px] text-ink-3">No calls with this number yet.</p>;
  }
  return (
    <ul className="divide-y divide-rule">
      {calls.slice(0, limit).map(call => (
        <li key={call.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
          <div className="min-w-0">
            <div className="font-medium tabular-nums text-ink">
              {formatDateTime(call.createdAt)}
            </div>
            <div className="truncate text-[12.5px] text-ink-3">
              {[
                call.direction === 'OUTBOUND' ? 'Outbound' : 'Inbound',
                call.disposition ? formatEnumLabel(call.disposition) : null,
                call.campaignName,
                call.buyerName,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 tabular-nums">
            <Duration seconds={call.connectedDuration} />
            <Link href={callHref(call.id)} className="font-medium text-brand-ink hover:underline">
              Open
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
