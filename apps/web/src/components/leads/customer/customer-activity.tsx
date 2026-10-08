'use client';

/**
 * Everything that happened on a customer, newest first. On the customer page
 * it has the full width: grouped by day, the time in its own column, and a
 * filter by kind, so weeks of history scan in seconds. In the CRM sheet the
 * same entries run as a compact list.
 */

import {
  Activity,
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Inbox,
  MessageSquare,
  PhoneCall,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import * as React from 'react';

import { EmptyState, Panel, Segmented, SegmentedItem } from '@/components/domain';
import { Button } from '@/components/ui/button';
import type { InsuranceActivity } from '@/lib/api/leads';
import { cn } from '@/lib/utils';

import { dayHeading, formatDateTime, formatTime, groupByDay } from './format';

type ActivityType = InsuranceActivity['type'];

const LOOK: Record<
  ActivityType,
  { icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  CALL: { icon: PhoneCall, tone: 'bg-brand-tint text-brand-ink' },
  QUOTE: { icon: Calculator, tone: 'bg-money-tint text-money-ink' },
  NOTE: { icon: MessageSquare, tone: 'bg-ringing-tint text-ringing-ink' },
  STATUS_CHANGE: { icon: Activity, tone: 'bg-sunken text-ink-2' },
  SUBMISSION: { icon: Upload, tone: 'bg-live-tint text-live-ink' },
  VALIDATION: { icon: AlertTriangle, tone: 'bg-dropped-tint text-dropped-ink' },
  TASK: { icon: CheckCircle2, tone: 'bg-live-tint text-live-ink' },
  COMPLIANCE: { icon: ShieldCheck, tone: 'bg-blocked-tint text-blocked-ink' },
  SYSTEM: { icon: Inbox, tone: 'bg-sunken text-ink-2' },
};

const lookOf = (type: string) => LOOK[type as ActivityType] ?? LOOK.SYSTEM;

type Filter = 'all' | 'calls' | 'quotes' | 'notes' | 'record';

const FILTERS: Array<{ id: Filter; label: string; types: ActivityType[] | null }> = [
  { id: 'all', label: 'All', types: null },
  { id: 'calls', label: 'Calls', types: ['CALL'] },
  { id: 'quotes', label: 'Quotes', types: ['QUOTE'] },
  { id: 'notes', label: 'Notes & tasks', types: ['NOTE', 'TASK'] },
  {
    id: 'record',
    label: 'Record & system',
    types: ['STATUS_CHANGE', 'SUBMISSION', 'VALIDATION', 'COMPLIANCE', 'SYSTEM'],
  },
];

const PAGE = 30;

function Icon({ type, size = 'md' }: { type: string; size?: 'sm' | 'md' }): JSX.Element {
  const { icon: Glyph, tone } = lookOf(type);
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        size === 'sm' ? 'h-6 w-6' : 'h-7 w-7',
        tone
      )}
    >
      <Glyph aria-hidden className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
    </span>
  );
}

/** The full timeline: the customer page's Activity tab. */
export function CustomerActivityTimeline({
  activities,
}: {
  activities: InsuranceActivity[];
}): JSX.Element {
  const [filter, setFilter] = React.useState<Filter>('all');
  const [shown, setShown] = React.useState(PAGE);

  const counts = React.useMemo(() => {
    const out: Record<Filter, number> = { all: 0, calls: 0, quotes: 0, notes: 0, record: 0 };
    for (const a of activities) {
      out.all += 1;
      for (const f of FILTERS) {
        if (f.types?.includes(a.type)) out[f.id] += 1;
      }
    }
    return out;
  }, [activities]);

  if (!activities.length) {
    return (
      <Panel>
        <EmptyState
          icon={Activity}
          headline="No activity yet"
          body="Calls, quotes, stage changes and notes on this customer will show up here."
        />
      </Panel>
    );
  }

  const types = FILTERS.find(f => f.id === filter)?.types ?? null;
  const matching = types ? activities.filter(a => types.includes(a.type)) : activities;
  const groups = groupByDay(matching.slice(0, shown), a => a.createdAt);

  return (
    <Panel className="min-w-0 overflow-hidden" aria-labelledby="activity-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3">
        <h2 id="activity-title" className="text-[16px] font-semibold text-ink">
          Activity
        </h2>
        <Segmented aria-label="Show activity">
          {FILTERS.filter(f => f.id === 'all' || counts[f.id] > 0).map(f => (
            <SegmentedItem
              key={f.id}
              active={filter === f.id}
              aria-pressed={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                setShown(PAGE);
              }}
            >
              {f.label}
              <span className="tabular-nums text-ink-3">{counts[f.id]}</span>
            </SegmentedItem>
          ))}
        </Segmented>
      </div>

      <div className="px-5 pb-2">
        {groups.map(([at, items]) => (
          <section key={at} aria-label={dayHeading(at)}>
            <h3 className="-mx-5 border-b border-rule bg-sunken/50 px-5 py-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">
              {dayHeading(at)}
            </h3>
            <ol>
              {items.map((act, i) => (
                <li
                  key={act.id}
                  className="relative grid grid-cols-[72px_28px_minmax(0,1fr)] gap-x-3 py-2.5"
                >
                  <time
                    dateTime={act.createdAt}
                    title={formatDateTime(act.createdAt) ?? undefined}
                    className="pt-1 text-right text-[12.5px] tabular-nums text-ink-3"
                  >
                    {formatTime(act.createdAt)}
                  </time>
                  <div className="relative flex justify-center">
                    {i < items.length - 1 ? (
                      <span aria-hidden className="absolute top-8 -bottom-3 w-px bg-rule" />
                    ) : null}
                    <Icon type={act.type} />
                  </div>
                  <div className="min-w-0 pt-[3px]">
                    <p className="text-[14px] font-medium leading-5 text-ink">{act.title}</p>
                    {act.description ? (
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-ink-2">
                        {act.description}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      {matching.length > shown ? (
        <div className="border-t border-rule px-5 py-2 text-center">
          <Button size="sm" variant="ghost" onClick={() => setShown(n => n + PAGE)}>
            Show older ({matching.length - shown} more)
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

/** The timeline in a narrow column: the CRM sheet. */
export function CustomerActivityList({
  activities,
}: {
  activities: InsuranceActivity[];
}): JSX.Element {
  if (!activities.length) {
    return <p className="text-[13px] text-ink-3">No activity recorded.</p>;
  }
  return (
    <ol className="space-y-3">
      {activities.map(act => (
        <li key={act.id} className="flex gap-3">
          <Icon type={act.type} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 text-[13px] font-medium text-ink">{act.title}</p>
              <time
                dateTime={act.createdAt}
                className="shrink-0 text-[11.5px] tabular-nums text-ink-3"
              >
                {formatDateTime(act.createdAt)}
              </time>
            </div>
            {act.description ? (
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] leading-[18px] text-ink-2">
                {act.description}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
