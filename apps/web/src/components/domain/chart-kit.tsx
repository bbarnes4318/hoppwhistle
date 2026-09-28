import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The chart palette and chrome, for every recharts chart in the portal.
 *
 * Colours come from the brand and from where a call went: your agents green,
 * buyers the brand blue, unanswered amber, blocked slate. A comparison (the
 * same slot yesterday, the previous seven days) is a dashed ink-3 line, so it
 * reads as context rather than as a fifth series. Gridlines are the rule
 * colour, horizontal only; charts carry no border of their own, since the
 * panel around them already has one.
 */
export const CHART = {
  agents: 'var(--entity-agent)',
  buyers: 'var(--entity-buyer)',
  unanswered: 'var(--entity-unanswered)',
  blocked: 'var(--entity-blocked)',
  brand: 'var(--brand)',
  comparison: 'var(--ink-3)',
  grid: 'var(--rule)',
  axis: 'var(--ink-3)',
} as const;

/** Props for a recharts <CartesianGrid>: horizontal rules only, in the rule colour. */
export const GRID_PROPS = {
  stroke: CHART.grid,
  strokeDasharray: '0',
  vertical: false,
} as const;

/** Props for a recharts axis: no line, no ticks, 12px ink-3 labels. */
export const AXIS_PROPS = {
  axisLine: false,
  tickLine: false,
  tick: { fill: CHART.axis, fontSize: 12 },
} as const;

/** The dashed comparison line. */
export const COMPARISON_LINE = {
  stroke: CHART.comparison,
  strokeWidth: 1.5,
  strokeDasharray: '4 4',
  dot: false,
  activeDot: false,
} as const;

export interface ChartTooltipRow {
  name: React.ReactNode;
  value: React.ReactNode;
  color?: string;
  dashed?: boolean;
}

/**
 * A tooltip in the popover style: surface, hairline, the raised shadow, 12px
 * text, a swatch per row. Pass it to recharts as `content` via
 * `chartTooltip(...)`, which maps recharts' payload to rows.
 */
export function ChartTooltipCard({
  title,
  rows,
  footer,
  className,
}: {
  title?: React.ReactNode;
  rows: ChartTooltipRow[];
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'min-w-[160px] rounded-control border border-rule bg-surface px-3 py-2 shadow-pop t-meta text-ink',
        className
      )}
    >
      {title ? <div className="mb-1 font-medium text-ink">{title}</div> : null}
      <ul className="flex flex-col gap-0.5">
        {rows.map((row, i) => (
          <li key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-2">
              {row.color ? (
                <span
                  aria-hidden
                  className={cn(
                    'inline-block h-2 w-2 shrink-0',
                    row.dashed ? 'h-0.5 w-3' : 'rounded-full'
                  )}
                  style={{ backgroundColor: row.color }}
                />
              ) : null}
              {row.name}
            </span>
            <span className="tabular-nums font-medium text-ink">{row.value}</span>
          </li>
        ))}
      </ul>
      {footer ? <div className="mt-1 border-t border-rule pt-1 text-ink-3">{footer}</div> : null}
    </div>
  );
}

/** Recharts' tooltip payload, as far as these charts read it. */
export interface RechartsTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: Array<{
    name?: string;
    dataKey?: string | number;
    value?: number | string;
    color?: string;
    stroke?: string;
    fill?: string;
    payload?: Record<string, unknown>;
  }>;
}

/**
 * A recharts `content` renderer built on ChartTooltipCard.
 *
 *   <Tooltip content={chartTooltip({ title: l => `${l}:00`, value: v => count(v) })} />
 */
export function chartTooltip(options: {
  title?: (label: string | number | undefined) => React.ReactNode;
  value?: (value: number, key: string) => React.ReactNode;
  footer?: (payload: Record<string, unknown> | undefined) => React.ReactNode;
  dashed?: string[];
}) {
  function ChartTooltipContent({ active, label, payload }: RechartsTooltipProps) {
    if (!active || !payload || payload.length === 0) return null;
    return (
      <ChartTooltipCard
        title={options.title ? options.title(label) : label}
        rows={payload.map(entry => {
          const key = String(entry.dataKey ?? entry.name ?? '');
          const value = Number(entry.value ?? 0);
          return {
            name: entry.name ?? key,
            value: options.value ? options.value(value, key) : value.toLocaleString(),
            color: entry.color ?? entry.stroke ?? entry.fill,
            dashed: options.dashed?.includes(key),
          };
        })}
        footer={options.footer?.(payload[0]?.payload)}
      />
    );
  }
  return ChartTooltipContent;
}
