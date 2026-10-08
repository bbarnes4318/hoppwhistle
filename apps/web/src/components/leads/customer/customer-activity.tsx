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

import { EmptyState, Segmented, SegmentedItem, formatEnumLabel } from '@/components/domain';
import { Button } from '@/components/ui/button';
import type { InsuranceActivity } from '@/lib/api/leads';
import { cn } from '@/lib/utils';

import { Disposition } from './customer-calls';
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
  SYSTEM: { icon: Inbox, tone: 'border border-rule bg-surface text-ink-3' },
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

/** How much an event's title weighs: the sale's moves lead, the record's bookkeeping recedes. */
const WEIGHT: Record<ActivityType, 'strong' | 'normal' | 'quiet'> = {
  QUOTE: 'strong',
  SUBMISSION: 'strong',
  NOTE: 'strong',
  TASK: 'strong',
  CALL: 'normal',
  VALIDATION: 'normal',
  COMPLIANCE: 'normal',
  STATUS_CHANGE: 'normal',
  SYSTEM: 'quiet',
};

/** The event's family, named in the stream's Type column. */
const FAMILY: Record<ActivityType, { label: string; ink: string }> = {
  CALL: { label: 'Call', ink: 'text-brand-ink' },
  QUOTE: { label: 'Quote', ink: 'text-money-ink' },
  NOTE: { label: 'Note', ink: 'text-ringing-ink' },
  TASK: { label: 'Task', ink: 'text-live-ink' },
  STATUS_CHANGE: { label: 'Status', ink: 'text-ink-2' },
  SUBMISSION: { label: 'Submission', ink: 'text-live-ink' },
  VALIDATION: { label: 'Validation', ink: 'text-dropped-ink' },
  COMPLIANCE: { label: 'Compliance', ink: 'text-blocked-ink' },
  SYSTEM: { label: 'System', ink: 'text-ink-3' },
};
const familyOf = (type: string) => FAMILY[type as ActivityType] ?? FAMILY.SYSTEM;

const TITLE_CLASS = {
  strong: 'font-semibold text-ink',
  normal: 'font-medium text-ink',
  quiet: 'font-normal text-ink-2',
} as const;

/** "CONTACTED" -> "Contacted", "NOT_INTERESTED" -> "Not interested", in running text. */
const humanEnums = (text: string) =>
  text.replace(/\b[A-Z]{2,}(?:_[A-Z]+)*\b/g, word =>
    ['DNC', 'FE', 'ACA', 'B2B', 'TN', 'GI', 'SI', 'GDB'].includes(word)
      ? word
      : formatEnumLabel(word)
  );

export interface ActivityLine {
  title: string;
  detail: string | null;
  /** A call's disposition, drawn with its outcome dot. */
  disposition: string | null;
}

/**
 * An activity as it reads on the timeline. The API words a call as
 * "Call (INBOUND) - Final Expense Inbound" / "Disposition: NOT_INTERESTED";
 * here it is "Inbound call", the campaign, and the outcome -- and a call
 * with no disposition says nothing rather than "Disposition: None".
 */
export function describeActivity(act: InsuranceActivity): ActivityLine {
  if (act.type === 'CALL') {
    const call = /^Call \((INBOUND|OUTBOUND)\)\s*-?\s*(.*)$/i.exec(act.title);
    const disposition = /^Disposition:\s*(.+)$/i.exec(act.description ?? '')?.[1]?.trim() ?? null;
    if (call) {
      return {
        title: `${call[1].toUpperCase() === 'OUTBOUND' ? 'Outbound' : 'Inbound'} call`,
        detail: call[2] || null,
        disposition: disposition && !/^none$/i.test(disposition) ? disposition : null,
      };
    }
  }
  return {
    title: act.title,
    detail: act.description ? humanEnums(act.description) : null,
    disposition: null,
  };
}

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
      <EmptyState
        icon={Activity}
        headline="No activity yet"
        body="Calls, quotes, stage changes and notes on this customer will show up here."
      />
    );
  }

  const types = FILTERS.find(f => f.id === filter)?.types ?? null;
  const matching = types ? activities.filter(a => types.includes(a.type)) : activities;
  const groups = groupByDay(matching.slice(0, shown), a => a.createdAt);

  return (
    <section aria-labelledby="activity-title">
      <div className="flex flex-wrap items-center justify-between gap-3 px-7 py-4">
        <h2
          id="activity-title"
          className="flex items-baseline gap-2.5 text-[15px] font-semibold text-ink"
        >
          Activity
          <span className="text-[13px] font-medium text-ink-3">
            {matching.length} event{matching.length === 1 ? '' : 's'}
          </span>
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
              <span
                className={cn(
                  'text-[12px] font-semibold tabular-nums',
                  filter === f.id ? 'text-brand-ink' : 'text-ink-3'
                )}
              >
                {counts[f.id]}
              </span>
            </SegmentedItem>
          ))}
        </Segmented>
      </div>

      <div
        aria-hidden
        className="hidden grid-cols-[96px_76px_124px_minmax(0,1fr)_minmax(0,1.3fr)] gap-x-6 border-y border-rule bg-paper px-7 py-2.5 text-[12px] font-medium text-ink-3 xl:grid"
      >
        <span>Day</span>
        <span>Time</span>
        <span>Type</span>
        <span>Event</span>
        <span>Details</span>
      </div>
      <div className="border-t border-rule xl:border-t-0">
        {groups.map(([at, items]) => (
          <section
            key={at}
            aria-label={dayHeading(at)}
            className="border-b border-rule last:border-b-0"
          >
            <h3 className="border-b border-rule bg-paper px-7 py-2 text-[12.5px] font-semibold text-ink-2 xl:hidden">
              {dayHeading(at)}
            </h3>
            <ol>
              {items.map((act, i) => (
                <EventRow key={act.id} act={act} day={i === 0 ? dayHeading(at) : null} />
              ))}
            </ol>
          </section>
        ))}
      </div>

      {matching.length > shown ? (
        <div className="border-t border-rule px-7 py-3">
          <Button size="sm" variant="ghost" onClick={() => setShown(n => n + PAGE)}>
            Show older ({matching.length - shown} more)
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function EventRow({ act, day }: { act: InsuranceActivity; day: string | null }): JSX.Element {
  const line = describeActivity(act);
  const weight = WEIGHT[act.type as ActivityType] ?? 'normal';
  const family = familyOf(act.type);
  const quiet = weight === 'quiet';
  return (
    <li className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-4 px-7 py-2.5 md:grid-cols-[76px_124px_minmax(0,1fr)] md:gap-x-6 xl:grid-cols-[96px_76px_124px_minmax(0,1fr)_minmax(0,1.3fr)]">
      <span className="hidden pt-0.5 text-[13px] font-semibold text-ink-2 xl:block">{day}</span>
      <time
        dateTime={act.createdAt}
        title={formatDateTime(act.createdAt) ?? undefined}
        className={cn('pt-0.5 text-[13px] tabular-nums', quiet ? 'text-ink-3' : 'text-ink-2')}
      >
        {formatTime(act.createdAt)}
      </time>
      <span className="hidden items-center gap-2 self-start md:flex">
        <Icon type={act.type} size="sm" />
        <span className={cn('text-[13px] font-medium', family.ink)}>{family.label}</span>
      </span>
      <div className="min-w-0">
        <p className={cn('text-[14px] leading-5', TITLE_CLASS[weight])}>{line.title}</p>
        {line.detail || line.disposition ? (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 break-words text-[13px] leading-5 text-ink-3 xl:hidden">
            {line.detail ? <span className="whitespace-pre-wrap">{line.detail}</span> : null}
            {line.disposition ? <Disposition value={line.disposition} /> : null}
          </p>
        ) : null}
      </div>
      <div className="hidden min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[13.5px] leading-5 xl:flex">
        {line.disposition ? <Disposition value={line.disposition} /> : null}
        {line.detail ? (
          <span
            className={cn('whitespace-pre-wrap break-words', quiet ? 'text-ink-3' : 'text-ink-2')}
          >
            {line.detail}
          </span>
        ) : null}
        {!line.detail && !line.disposition ? (
          <span className="text-ink-3 opacity-50">—</span>
        ) : null}
      </div>
    </li>
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
      {activities.map(act => {
        const line = describeActivity(act);
        return (
          <li key={act.id} className="flex gap-3">
            <Icon type={act.type} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 text-[13px] font-medium text-ink">{line.title}</p>
                <time
                  dateTime={act.createdAt}
                  className="shrink-0 text-[11.5px] tabular-nums text-ink-3"
                >
                  {formatDateTime(act.createdAt)}
                </time>
              </div>
              {line.detail || line.disposition ? (
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] leading-[18px] text-ink-2">
                  {[line.detail, line.disposition ? formatEnumLabel(line.disposition) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
