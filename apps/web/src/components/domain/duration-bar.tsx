import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * DurationBar — signature element of the platform.
 *
 * A call's length rendered as a thin horizontal bar with a tick where the
 * billable threshold sits. Under the threshold the bar is `dropped`; at or over
 * it the bar is `live`, with the portion past the tick in `live-deep` so
 * overage reads as a second value rather than more of the same one.
 *
 * The point is to turn "did this call pay" from a number you read and compare
 * into a shape you see. It is the same shape in the buyer call list, the
 * publisher call list, the admin call log and the recording player, so every
 * role's central question is answered by one visual.
 *
 * SCALE. The bar's full width is `scaleSeconds`. In a table every row MUST be
 * passed the same `scaleSeconds` or the bars cannot be compared to each other,
 * which defeats the entire purpose. Callers should pass a shared value derived
 * from the visible set (a high percentile of it, not the max, so one outlier
 * does not flatten every other row). The default is only for one-off use.
 */

export type DurationBarState =
  | 'billable' // at or past the threshold
  | 'short' // under the threshold
  | 'in-progress' // still running, outcome not settled
  | 'unmeasured' // no threshold configured — nothing to judge against
  | 'zero'; // no duration at all

export interface DurationBarProps {
  /** Elapsed call length in seconds. */
  seconds: number;
  /**
   * Billable threshold in seconds. `null` or omitted means no threshold is
   * configured, which is a different thing from a threshold of zero: there is
   * no billable judgment to render, so the bar goes neutral.
   */
  thresholdSeconds?: number | null;
  /**
   * Seconds represented by the full width of the bar. Pass a shared value for
   * every row of a table. Defaults to 3x the threshold (putting the tick at a
   * third of the width, leaving room for overage) or 300s with no threshold.
   */
  scaleSeconds?: number;
  /** The call has not ended. Outcome is not final, so the bar reads as pending. */
  inProgress?: boolean;
  /** Render the duration as text beside the bar. */
  showValue?: boolean;
  /** `row` (6px) for tables, `detail` (10px) for the recording player. */
  size?: 'row' | 'detail';
  className?: string;
}

const TRACK_HEIGHT = { row: 6, detail: 10 } as const;
const TICK_OVERHANG = { row: 3, detail: 4 } as const;

/** mm:ss, or h:mm:ss past an hour. Tabular figures keep columns aligned. */
function formatSeconds(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function resolveDurationState(
  seconds: number,
  thresholdSeconds?: number | null,
  inProgress?: boolean
): DurationBarState {
  if (inProgress) return 'in-progress';
  if (seconds <= 0) return 'zero';
  if (thresholdSeconds === null || thresholdSeconds === undefined) return 'unmeasured';
  return seconds >= thresholdSeconds ? 'billable' : 'short';
}

/** Plain-language description, used as the accessible value and as a tooltip. */
function describe(
  state: DurationBarState,
  seconds: number,
  thresholdSeconds?: number | null
): string {
  const d = formatSeconds(seconds);
  const t = thresholdSeconds != null ? formatSeconds(thresholdSeconds) : null;
  switch (state) {
    case 'billable':
      return t ? `${d}, billable — threshold ${t}` : `${d}, billable`;
    case 'short':
      return `${d}, not billable — ${t} needed`;
    case 'in-progress':
      return t ? `${d} and running — threshold ${t}` : `${d} and running`;
    case 'unmeasured':
      return `${d}, no billable threshold set`;
    case 'zero':
      return t ? `No duration — threshold ${t}` : 'No duration';
  }
}

export function DurationBar({
  seconds,
  thresholdSeconds,
  scaleSeconds,
  inProgress = false,
  showValue = false,
  size = 'row',
  className,
}: DurationBarProps) {
  const state = resolveDurationState(seconds, thresholdSeconds, inProgress);
  const hasThreshold = thresholdSeconds != null && thresholdSeconds > 0;

  const scale = Math.max(1, scaleSeconds ?? (hasThreshold ? thresholdSeconds * 3 : 300));

  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scale) * 100))}%`;

  const safeSeconds = Math.max(0, seconds);
  // The bar is clipped rather than rescaled when a call runs past the shared
  // scale. Clipping is marked so a truncated bar is never read as an exact one.
  const clipped = safeSeconds > scale;
  const tickPct = hasThreshold ? Math.min(100, (thresholdSeconds / scale) * 100) : null;

  const height = TRACK_HEIGHT[size];
  const overhang = TICK_OVERHANG[size];

  // Fill geometry. `billable` splits into two segments so the time past the
  // tick is visibly a different quantity from the time that earned the call.
  const upToThreshold =
    state === 'billable' && hasThreshold ? Math.min(safeSeconds, thresholdSeconds) : safeSeconds;
  const overage =
    state === 'billable' && hasThreshold ? Math.max(0, safeSeconds - thresholdSeconds) : 0;

  const fillColor =
    state === 'short'
      ? 'var(--dropped)'
      : state === 'in-progress'
        ? 'var(--ringing)'
        : state === 'unmeasured'
          ? 'var(--ink-3)'
          : 'var(--live)';

  return (
    <div
      className={cn('flex items-center gap-2', className)}
      title={describe(state, safeSeconds, thresholdSeconds)}
    >
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={scale}
        aria-valuenow={Math.min(safeSeconds, scale)}
        aria-valuetext={describe(state, safeSeconds, thresholdSeconds)}
        data-state={state}
        className="relative min-w-0 flex-1"
        style={{ height: height + overhang * 2 }}
      >
        {/* track */}
        <div
          className="absolute left-0 right-0 top-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-sunken"
          style={{ height }}
        >
          {/* primary fill */}
          {safeSeconds > 0 && (
            <div
              className="absolute left-0 top-0 h-full rounded-full"
              style={{ width: pct(upToThreshold), backgroundColor: fillColor }}
            />
          )}

          {/* overage — time earned past the threshold, one shade deeper */}
          {overage > 0 && tickPct !== null && (
            <div
              className="absolute top-0 h-full rounded-r-full"
              style={{
                left: `${tickPct}%`,
                width: pct(overage),
                backgroundColor: 'var(--live-deep)',
              }}
            />
          )}
        </div>

        {/*
          Threshold tick. Taller than the track so its nubs sit against the
          panel on both sides — that way it stays legible whether the fill has
          reached it or not, without needing a second colour.
        */}
        {tickPct !== null && (
          <div
            aria-hidden
            className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-ink-2"
            style={{ left: `${tickPct}%` }}
          />
        )}

        {/*
          Leading edge of a running call. The one piece of motion in the
          component, and it stops under prefers-reduced-motion — the edge stays
          drawn, so the state is still legible without the animation.
        */}
        {state === 'in-progress' && (
          <div
            aria-hidden
            className="absolute top-1/2 w-[2px] -translate-x-1/2 -translate-y-1/2 bg-ringing motion-safe:animate-edge-pulse"
            style={{ left: pct(safeSeconds), height: height + overhang }}
          />
        )}

        {/* Clip marker: this call ran past the shared scale. */}
        {clipped && (
          <div
            aria-hidden
            className="absolute right-0 top-1/2 -translate-y-1/2 text-ink-3"
            style={{ fontSize: 9, lineHeight: 1 }}
          >
            ›
          </div>
        )}
      </div>

      {showValue && (
        <span
          className={cn(
            't-data shrink-0 tabular',
            state === 'short' && 'text-dropped-ink',
            state === 'billable' && 'text-live-ink',
            state === 'in-progress' && 'text-ringing-ink',
            (state === 'unmeasured' || state === 'zero') && 'text-ink-3'
          )}
        >
          {formatSeconds(safeSeconds)}
        </span>
      )}
    </div>
  );
}

export { formatSeconds as formatDurationSeconds };
