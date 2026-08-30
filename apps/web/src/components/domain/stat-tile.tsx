import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * StatTile — label, figure, sub, optional delta, optional sparkline lane.
 *
 * The sparkline lane is ALWAYS reserved, whether or not a series is passed.
 * A row of tiles where some have a sparkline and some do not would otherwise
 * put its numbers on different baselines, and a row of numbers that do not
 * share a baseline reads as a mistake even when every value is right.
 */

export interface StatTileProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Uppercase label. "Billable rate", not "billable_rate". */
  label: string;
  /** The number. Pass a formatted node (MoneyCell) or a string. */
  figure: React.ReactNode;
  /** One line under the figure — the denominator, the period, the caveat. */
  sub?: string;
  /**
   * Period-over-period change. `direction` says which way is good: `up` for
   * earnings, `down` for abandon rate. Without it a falling abandon rate would
   * be painted as bad news.
   */
  delta?: { value: string; direction: 'up' | 'down'; good?: 'up' | 'down' };
  /** Values for the sparkline. The lane is reserved either way. */
  series?: number[];
  /** Emphasise this tile — the one number the page is about. */
  emphasis?: boolean;
  loading?: boolean;
}

const SPARK_HEIGHT = 20;

/**
 * Deliberately a plain SVG polyline: no axes, no tooltip, no animation. It is
 * a shape showing direction, not a chart, and the moment it grows a tooltip
 * someone will try to read values off it.
 */
function Sparkline({ series, tone }: { series: number[]; tone: string }) {
  if (series.length < 2) return null;

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const stepX = 100 / (series.length - 1);

  const points = series
    .map(
      (v, i) =>
        `${(i * stepX).toFixed(2)},${(SPARK_HEIGHT - ((v - min) / span) * SPARK_HEIGHT).toFixed(2)}`
    )
    .join(' ');

  return (
    <svg
      viewBox={`0 0 100 ${SPARK_HEIGHT}`}
      preserveAspectRatio="none"
      className="h-full w-full"
      aria-hidden
      focusable="false"
    >
      <polyline
        points={points}
        fill="none"
        stroke={tone}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function StatTile({
  label,
  figure,
  sub,
  delta,
  series,
  emphasis = false,
  loading = false,
  className,
  ...props
}: StatTileProps) {
  // `good` defaults to up. Pass `good: 'down'` for abandon rate, cost per call,
  // time to answer — anything where less is better.
  const good = delta?.good ?? 'up';
  const isGood = delta ? delta.direction === good : false;

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col rounded-card border border-rule bg-surface p-3',
        emphasis && 'border-rule-strong',
        className
      )}
      {...props}
    >
      <div className="t-label text-ink-3">{label}</div>

      <div className="mt-1.5 flex items-baseline gap-2">
        {loading ? (
          <Skeleton className="h-[19px] w-24 rounded-control" />
        ) : (
          <span className={cn(emphasis ? 't-hero' : 't-figure', 'min-w-0 truncate text-ink')}>
            {figure}
          </span>
        )}

        {delta && !loading ? (
          <span
            className={cn('t-meta tabular shrink-0', isGood ? 'text-live-ink' : 'text-dropped-ink')}
          >
            {delta.direction === 'up' ? '▲' : '▼'} {delta.value}
          </span>
        ) : null}
      </div>

      {/* Reserved whether or not `sub` is passed, for the same baseline reason. */}
      <div className="t-meta mt-1 min-h-[17px] truncate text-ink-3">
        {loading ? <Skeleton className="h-3 w-16 rounded-control" /> : sub}
      </div>

      {/*
        The reserved sparkline lane. Fixed height, always present, empty when
        there is no series. This is the whole reason tiles line up.
      */}
      <div className="mt-2" style={{ height: SPARK_HEIGHT }} aria-hidden={!series}>
        {loading ? (
          <Skeleton className="h-full w-full rounded-control" />
        ) : series && series.length > 1 ? (
          <Sparkline series={series} tone={isGood || !delta ? 'var(--live)' : 'var(--dropped)'} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * A row of tiles. Uses a grid so every tile is the same width and the figures
 * share a baseline, which is the invariant StatTile exists to protect.
 */
export function StatTileRow({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)} {...props}>
      {children}
    </div>
  );
}
