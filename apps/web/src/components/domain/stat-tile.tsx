import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * StatTile — a card holding one figure: label, figure, sub, optional delta,
 * optional icon chip, optional sparkline.
 *
 * The figure is Inter at the figure step with tabular numerals, so a row of
 * tiles reads as one set of numbers. `sub` has a reserved line whether or not
 * it is passed, and the sparkline lane is reserved for every tile that is
 * given a `series` prop, so tiles in a row share their baselines.
 *
 * `value` is the alternative to `figure` for a raw number or string: a number
 * is shown with `toLocaleString()` and an optional `unit` beside it — the same
 * formatting the dashboard's KPI cards have always applied.
 */

export interface StatTileProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Uppercase label. "Billable rate", not "billable_rate". */
  label: string;
  /** The number. Pass a formatted node (MoneyCell) or a string. */
  figure?: React.ReactNode;
  /** A raw figure: numbers are rendered with toLocaleString(). */
  value?: string | number;
  /** Rendered after `value`, e.g. "%". */
  unit?: string;
  /** One line under the figure — the denominator, the period, the caveat. */
  sub?: React.ReactNode;
  /** A lucide icon, shown in a 32px brand-tint chip at the top right. */
  icon?: React.ComponentType<{ className?: string }>;
  /**
   * Period-over-period change. `direction` says which way is good: `up` for
   * earnings, `down` for abandon rate. Without it a falling abandon rate would
   * be painted as bad news.
   */
  delta?: { value: string; direction: 'up' | 'down'; good?: 'up' | 'down' };
  /** Values for the sparkline. The lane is reserved when this is passed. */
  series?: number[];
  /** Emphasise this tile — the one number the page is about. Hero size. */
  emphasis?: boolean;
  /** Colour the figure as money. */
  tone?: 'ink' | 'money';
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
  value,
  unit,
  sub,
  icon: Icon,
  delta,
  series,
  emphasis = false,
  tone = 'ink',
  loading = false,
  className,
  ...props
}: StatTileProps) {
  // `good` defaults to up. Pass `good: 'down'` for abandon rate, cost per call,
  // time to answer — anything where less is better.
  const good = delta?.good ?? 'up';
  const isGood = delta ? delta.direction === good : false;

  const shown =
    figure !== undefined ? figure : typeof value === 'number' ? value.toLocaleString() : value;

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col rounded-card border border-rule bg-surface p-5 shadow-card',
        'transition-shadow duration-150 ease-out ne-motion',
        emphasis && 'border-rule-strong',
        className
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="t-label pt-0.5 text-ink-3">{label}</div>
        {Icon ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand-ink">
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
      </div>

      <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1', Icon ? 'mt-1' : 'mt-3')}>
        {loading ? (
          <Skeleton className={cn('w-24', emphasis ? 'h-10' : 'h-[30px]')} />
        ) : (
          <span
            className={cn(
              emphasis ? 't-hero' : 't-figure',
              'min-w-0 tabular-nums',
              tone === 'money' ? 'text-money-ink' : 'text-ink'
            )}
          >
            {shown}
            {unit && figure === undefined ? (
              <span className="ml-1 text-[15px] font-medium text-ink-3">{unit}</span>
            ) : null}
          </span>
        )}

        {delta && !loading ? (
          <span
            className={cn(
              't-meta tabular-nums shrink-0 font-medium',
              isGood ? 'text-live-ink' : 'text-dropped-ink'
            )}
          >
            {delta.direction === 'up' ? '▲' : '▼'} {delta.value}
          </span>
        ) : null}
      </div>

      {/* Reserved whether or not `sub` is passed, for the same baseline reason. */}
      <div className="t-meta mt-1 min-h-[17px] text-ink-3">
        {loading ? <Skeleton className="h-3 w-16" /> : sub}
      </div>

      {/*
        The sparkline lane: fixed height, reserved whenever `series` is passed
        (even empty), so tiles that chart and tiles that do not yet still line up.
      */}
      {series !== undefined ? (
        <div className="mt-2" style={{ height: SPARK_HEIGHT }} aria-hidden={!series}>
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : series.length > 1 ? (
            <Sparkline
              series={series}
              tone={isGood || !delta ? 'var(--brand)' : 'var(--dropped)'}
            />
          ) : null}
        </div>
      ) : null}
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
    <div className={cn('grid grid-cols-2 gap-4 lg:grid-cols-4', className)} {...props}>
      {children}
    </div>
  );
}
