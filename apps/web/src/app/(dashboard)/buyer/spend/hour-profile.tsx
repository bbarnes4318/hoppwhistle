'use client';

import * as React from 'react';

import { formatMoney } from '@/components/domain';
import { cn } from '@/lib/utils';

/**
 * Spend by hour of day.
 *
 * Buckets are computed on the server in UTC, because that is the only clock the
 * server has. The rotation into the reader's own hours happens here, after
 * mount: rendering local hours during hydration would mean the server and the
 * browser disagree about which bar is which. The first paint is therefore UTC
 * and it corrects itself immediately — the caption always names the clock the
 * axis is currently on, so it is never ambiguous.
 */

export interface HourBucket {
  /** 0–23, UTC. */
  hour: number;
  calls: number;
  billableCalls: number;
  /** Whole currency units. */
  cost: number;
}

function hourLabel(hour: number): string {
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

export function HourProfile({ buckets, coverage }: { buckets: HourBucket[]; coverage: string }) {
  const [offsetHours, setOffsetHours] = React.useState(0);
  const [zone, setZone] = React.useState<string | null>(null);

  React.useEffect(() => {
    setOffsetHours(-Math.round(new Date().getTimezoneOffset() / 60));
    try {
      setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      setZone(null);
    }
  }, []);

  const byUtcHour = new Map(buckets.map(b => [b.hour, b]));
  const ordered = Array.from({ length: 24 }, (_, localHour) => {
    const utcHour = (((localHour - offsetHours) % 24) + 24) % 24;
    return {
      localHour,
      bucket: byUtcHour.get(utcHour) ?? { hour: utcHour, calls: 0, billableCalls: 0, cost: 0 },
    };
  });

  const peak = Math.max(1, ...ordered.map(o => o.bucket.cost));
  const total = ordered.reduce((sum, o) => sum + o.bucket.cost, 0);

  return (
    <div>
      <div className="flex h-44 items-end gap-[3px]" role="list" aria-label="Spend by hour of day">
        {ordered.map(({ localHour, bucket }) => {
          const height = (bucket.cost / peak) * 100;
          const share = total > 0 ? (bucket.cost / total) * 100 : 0;
          return (
            <div
              key={localHour}
              role="listitem"
              // h-full is load-bearing: the row is items-end, so a column
              // would otherwise be sized by its content and the bar's
              // percentage height would resolve against nothing.
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${hourLabel(localHour)} — ${formatMoney(bucket.cost, 'USD', 'major')} across ${bucket.calls} call${bucket.calls === 1 ? '' : 's'} (${share.toFixed(0)}% of the window)`}
            >
              <div
                className={cn('w-full rounded-t-sm', bucket.cost > 0 ? 'bg-money' : 'bg-sunken')}
                style={{ height: `${Math.max(bucket.cost > 0 ? 3 : 1, height)}%` }}
              />
            </div>
          );
        })}
      </div>

      <div aria-hidden className="mt-1.5 flex gap-[3px]">
        {ordered.map(({ localHour }) => (
          <span
            key={localHour}
            className="min-w-0 flex-1 text-center text-ink-3"
            style={{ fontSize: 9, lineHeight: 1.2 }}
          >
            {localHour % 3 === 0 ? hourLabel(localHour) : ''}
          </span>
        ))}
      </div>

      <p className="t-meta mt-3 text-ink-3">
        Hour of day{zone ? ` in ${zone}` : ' in UTC'}. {coverage}
      </p>
    </div>
  );
}
