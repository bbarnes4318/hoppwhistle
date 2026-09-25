import { History, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing } from 'lucide-react';

import { EmptyState } from '@/components/domain/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import {
  formatDurationShort,
  formatPhoneNumber,
  formatRelativeTime,
  type RecentCallItem,
} from './format';
import { FOCUS_RING, PRESS, TOUCH_TARGET } from './parts';

/**
 * Recent calls: which way, who, how long, when, and a one-tap call back.
 *
 * A missed call is an inbound one that never connected. It is the only row
 * that takes a colour, because it is the only one that asks for something.
 */
export interface RecentCallsListProps {
  items: RecentCallItem[];
  loading?: boolean;
  error?: boolean;
  now: Date;
  onRedial: (number: string) => void;
  onRetry?: () => void;
  onOpenKeypad?: () => void;
}

export function RecentCallsList({
  items,
  loading = false,
  error = false,
  now,
  onRedial,
  onRetry,
  onOpenKeypad,
}: RecentCallsListProps): JSX.Element {
  if (loading) {
    return (
      <ul className="divide-y divide-rule" aria-busy="true" aria-label="Loading recent calls">
        {[0, 1, 2, 3].map(i => (
          <li key={i} className="flex items-center gap-3 py-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-9 w-9 rounded-full" />
          </li>
        ))}
      </ul>
    );
  }

  if (error && items.length === 0) {
    return (
      <EmptyState
        variant="error"
        icon={History}
        headline="Recent calls did not load"
        body="Your calls are safe. This list could not be fetched just now."
        action={onRetry ? { label: 'Try again', onClick: onRetry } : undefined}
        className="py-8"
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={History}
        headline="No calls yet"
        body="Calls you place or take on this phone will be listed here, ready to call back."
        action={onOpenKeypad ? { label: 'Open keypad', onClick: onOpenKeypad } : undefined}
        className="py-8"
      />
    );
  }

  return (
    <ul className="divide-y divide-rule" aria-label="Recent calls">
      {items.map(item => {
        const number = formatPhoneNumber(item.number) || 'Unknown number';
        const Icon = item.missed
          ? PhoneMissed
          : item.direction === 'inbound'
            ? PhoneIncoming
            : PhoneOutgoing;
        const kind = item.missed
          ? 'Missed'
          : item.direction === 'inbound'
            ? 'Incoming'
            : 'Outgoing';
        const when = formatRelativeTime(item.startedAt, now);
        return (
          <li key={item.id} className="flex items-center gap-3 py-2.5">
            <span
              className={cn(
                'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                item.missed ? 'bg-dropped-tint text-dropped-ink' : 'bg-sunken text-ink-2'
              )}
              aria-hidden
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'truncate text-sm font-medium',
                  item.missed ? 'text-dropped-ink' : 'text-ink'
                )}
              >
                {item.name ?? <span className="t-data text-[13px]">{number}</span>}
              </p>
              <p className="t-meta flex items-center gap-1.5 truncate text-ink-3">
                <span className="sr-only">{kind}. </span>
                {item.name ? (
                  <span className="t-data text-[12px]">{number}</span>
                ) : (
                  <span>{kind}</span>
                )}
                <span aria-hidden>·</span>
                <span className="tabular-nums">
                  {item.missed ? 'No answer' : formatDurationShort(item.durationSeconds)}
                </span>
              </p>
            </div>
            <span className="t-meta shrink-0 tabular-nums text-ink-3">{when}</span>
            <button
              type="button"
              onClick={() => onRedial(item.number)}
              disabled={!item.number}
              aria-label={`Call ${item.name ?? number}`}
              title="Call back"
              className={cn(
                'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-rule-strong bg-surface text-brand-ink',
                'hover:border-brand-ink hover:bg-brand-tint disabled:opacity-40',
                PRESS,
                FOCUS_RING,
                TOUCH_TARGET
              )}
            >
              <Phone className="h-4 w-4" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
