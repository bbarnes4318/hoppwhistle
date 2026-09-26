'use client';

import Link from 'next/link';

import { count, pct } from '@/components/delivery/ledger';
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle } from '@/components/domain';
import { cn } from '@/lib/utils';

import type { CallSalesSummary } from './types';

/**
 * "Where your calls went": one bar, four parts.
 *
 * Revenue shows it for the period it measures, and Today for today.
 *
 * The four come from different columns -- who answered, which buyer, blocked
 * -- so the shares are each out of every inbound call and are not forced to
 * add to exactly one hundred.
 */
export function WhereCallsWent({
  inbound,
  disposition,
  agentsHref,
}: {
  inbound: number;
  disposition: CallSalesSummary['disposition'];
  /** Where "Your agents" links: the Leaderboard for the same period. */
  agentsHref: string;
}): JSX.Element {
  const parts = [
    { key: 'agents', label: 'Your agents', value: disposition.yourAgents, bar: 'bg-live' },
    { key: 'buyers', label: 'Buyers', value: disposition.buyers, bar: 'bg-money' },
    {
      key: 'unanswered',
      label: 'Unanswered',
      value: disposition.unanswered,
      bar: 'bg-ringing',
    },
    { key: 'blocked', label: 'Blocked', value: disposition.blocked, bar: 'bg-blocked' },
  ];
  const share = (value: number) => (inbound > 0 ? (value / inbound) * 100 : 0);

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Where your calls went</PanelTitle>
        <PanelDescription>{`${count(inbound)} inbound calls`}</PanelDescription>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-4">
        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-sunken"
          role="img"
          aria-label={parts.map(part => `${part.label} ${part.value}`).join(', ')}
        >
          {parts.map(part =>
            part.value > 0 ? (
              <div
                key={part.key}
                className={part.bar}
                style={{ width: `${Math.min(100, share(part.value))}%` }}
              />
            ) : null
          )}
        </div>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {parts.map(part => {
            const figure = (
              <>
                {count(part.value)}{' '}
                <span className="t-meta text-ink-3">{pct(share(part.value), 1)}</span>
              </>
            );
            return (
              <div key={part.key}>
                <dt className="flex items-center gap-2 t-label text-ink-3">
                  <span className={cn('h-2 w-2 rounded-full', part.bar)} aria-hidden />
                  {part.label}
                </dt>
                <dd className="t-data text-ink tabular-nums" data-part={part.key}>
                  {part.key === 'agents' ? (
                    <Link
                      href={agentsHref}
                      className="hover:underline"
                      title="Your agents on the Leaderboard, for the same period"
                    >
                      {figure}
                    </Link>
                  ) : (
                    figure
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </PanelBody>
    </Panel>
  );
}
