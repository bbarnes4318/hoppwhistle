import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { isZeroFigure, tileMoneyText } from './figures';

/**
 * StatTile — a card holding one figure: label, figure, sub, optional delta,
 * optional icon chip, optional sparkline.
 *
 * ── Two sizes ────────────────────────────────────────────────────────────────
 *
 * `size="hero"` is for the three or four numbers a page is about: a 30px
 * figure. Everything else is `secondary`, 20px. A page of twelve tiles at the
 * same size is twelve numbers the reader has to rank themselves.
 *
 * ── What the figure looks like ───────────────────────────────────────────────
 *
 * The label is sentence case, 12px, medium, ink-2 -- never an all-caps micro
 * label. A figure that says nothing (0, $0.00, 0.0%, an em dash) renders in
 * ink-3 whatever its tone: a blue $0.00 reads as good news. Money
 * (`tone="money"`) is brand ink only when it is not zero, and a money string
 * of $1,000 or more drops its cents (`tileMoneyText`).
 *
 * `sub` has a reserved line whether or not it is passed, and the sparkline
 * lane is reserved for every tile that is given a `series` prop, so tiles in a
 * row share their baselines.
 */

export interface StatTileProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Sentence case. "Billable rate", not "billable_rate" or "BILLABLE RATE". */
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
   * Change against a comparison. `direction` says which way it moved; `good`
   * says which way is good (`up` for earnings, `down` for abandon rate), so a
   * falling abandon rate is not painted as bad news. Null with `deltaLabel`
   * set renders "—": there was nothing to compare with.
   */
  delta?: { value: string; direction: 'up' | 'down' | 'flat'; good?: 'up' | 'down' } | null;
  /** What the delta is against: "vs same time yesterday". Puts it on its own line. */
  deltaLabel?: string;
  /** Values for the sparkline. The lane is reserved when this is passed. */
  series?: number[];
  /** `hero` for the numbers a page is about; `secondary` (default) for the rest. */
  size?: 'hero' | 'secondary';
  /** Older spelling of `size="hero"`. */
  emphasis?: boolean;
  /** Colour the figure as money: brand ink when it is not zero. */
  tone?: 'ink' | 'money';
  loading?: boolean;
}

const SPARK_HEIGHT = 24;

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
        `${(i * stepX).toFixed(2)},${(SPARK_HEIGHT - 2 - ((v - min) / span) * (SPARK_HEIGHT - 4)).toFixed(2)}`
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
  deltaLabel,
  series,
  size,
  emphasis = false,
  tone = 'ink',
  loading = false,
  className,
  ...props
}: StatTileProps) {
  const hero = size === 'hero' || (size === undefined && emphasis);
  // `good` defaults to up. Pass `good: 'down'` for abandon rate, cost per call,
  // time to answer — anything where less is better.
  const good = delta?.good ?? 'up';
  const isGood = delta ? delta.direction === good : false;

  const raw =
    figure !== undefined ? figure : typeof value === 'number' ? value.toLocaleString() : value;
  const shown = typeof raw === 'string' ? tileMoneyText(raw) : raw;
  const zero = isZeroFigure(raw);

  const deltaNode =
    delta && !loading ? (
      <span
        className={cn(
          't-meta tabular-nums shrink-0 font-medium',
          delta.direction === 'flat' ? 'text-ink-3' : isGood ? 'text-live-ink' : 'text-dropped-ink'
        )}
      >
        {delta.direction === 'up' ? '▲ ' : delta.direction === 'down' ? '▼ ' : ''}
        {delta.value}
      </span>
    ) : null;

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col rounded-card border border-rule bg-surface shadow-card',
        hero ? 'p-5' : 'p-4',
        'transition-shadow duration-150 ease-out ne-motion',
        className
      )}
      data-tile-size={hero ? 'hero' : 'secondary'}
      data-zero={zero ? '' : undefined}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="t-caption pt-0.5 text-ink-2">{label}</div>
        {Icon ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand-ink">
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
      </div>

      <div
        className={cn(
          'flex flex-wrap items-baseline gap-x-2 gap-y-1',
          Icon ? 'mt-1' : hero ? 'mt-2' : 'mt-1.5'
        )}
      >
        {loading ? (
          <Skeleton className={cn('w-24', hero ? 'h-[34px]' : 'h-6')} />
        ) : (
          <span
            className={cn(
              hero ? 't-kpi-hero' : 't-kpi',
              'min-w-0 tabular-nums',
              zero ? 'text-ink-3' : tone === 'money' ? 'text-brand-ink' : 'text-ink'
            )}
            data-tile-figure
          >
            {shown}
            {unit && figure === undefined ? (
              <span className="ml-1 text-[15px] font-medium text-ink-3">{unit}</span>
            ) : null}
          </span>
        )}

        {deltaLabel ? null : deltaNode}
      </div>

      {deltaLabel && !loading ? (
        <div className="t-meta mt-1 flex items-baseline gap-1 text-ink-3" data-tile-delta>
          {deltaNode ?? <span className="font-medium text-ink-3">—</span>} <span>{deltaLabel}</span>
        </div>
      ) : null}

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
            <Sparkline series={series} tone="var(--brand)" />
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
