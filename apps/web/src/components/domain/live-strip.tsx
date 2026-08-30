'use client';

import { WifiOff } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * LiveStrip — signature 2. A persistent strip under the topbar, role scoped.
 *
 * Publishers keep a competitor's tab open all day because their earnings number
 * ticks up while they watch. That is the mechanic worth copying, and it is
 * honest here because it is real money in real time.
 *
 * When a value changes the digits briefly take the live colour and settle back
 * over 600ms. Nothing else on the page moves. Under prefers-reduced-motion the
 * flash is replaced by a static change marker, so the information survives
 * without the animation.
 *
 * This component is presentational: it renders values and a connection state.
 * Prompt 3 wires it to the websocket at apps/api/src/routes/websocket.ts and
 * owns the polling fallback.
 */

export type LiveConnectionState = 'live' | 'degraded' | 'offline';

export interface LiveMetric {
  id: string;
  label: string;
  /** Preformatted. Pass what should be read, e.g. "$1,284.60" or "38%". */
  value: string;
  /** Secondary context: "of $5,000 cap", "target 65%". */
  sub?: string;
  /**
   * Tooltip. Used to explain a value the strip cannot show — an em dash with no
   * explanation reads as a bug rather than as a known gap.
   */
  title?: string;
  /**
   * No value is available. Renders muted and skips the flash — a coloured em
   * dash reads as a meaningful value, and a red one reads as a bad number.
   */
  unavailable?: boolean;
  /** Tone for the value. Defaults to ink. */
  tone?: 'ink' | 'live' | 'ringing' | 'dropped' | 'money';
}

export interface LiveStripProps {
  metrics: LiveMetric[];
  /**
   * `live` — socket connected. `degraded` — socket dropped, values are from
   * five-second polling. `offline` — neither. Never render a stale number as
   * if it were live.
   */
  connection?: LiveConnectionState;
  /** When the values were last confirmed. Shown in degraded and offline. */
  lastUpdated?: Date | null;
  /**
   * Overrides the default degraded/offline copy. The default assumes the socket
   * dropped; pass this when the real reason is something else, so the strip
   * never asserts a cause it does not know.
   */
  note?: string;
  className?: string;
}

const TONE_CLASS = {
  ink: 'text-ink',
  live: 'text-live-ink',
  ringing: 'text-ringing-ink',
  dropped: 'text-dropped-ink',
  money: 'text-money-ink',
} as const;

/**
 * Flashes its value to the live colour on change, then settles.
 *
 * The `key`-on-value trick would remount and lose focus; instead the class is
 * added on change and removed when the animation ends. Under reduced motion no
 * class is added and a small marker is rendered beside the value instead.
 */
function LiveValue({
  value,
  tone = 'ink',
  reducedMotion,
  unavailable = false,
}: {
  value: string;
  tone: NonNullable<LiveMetric['tone']>;
  reducedMotion: boolean;
  unavailable?: boolean;
}) {
  const [flash, setFlash] = React.useState(false);
  const [changed, setChanged] = React.useState(false);
  const previous = React.useRef(value);

  React.useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    // Nothing changed in a meaningful sense if there is no value to change to.
    if (unavailable) return;

    if (reducedMotion) {
      setChanged(true);
      const t = setTimeout(() => setChanged(false), 4000);
      return () => clearTimeout(t);
    }

    setFlash(true);
    const t = setTimeout(() => setFlash(false), 600);
    return () => clearTimeout(t);
  }, [value, reducedMotion, unavailable]);

  return (
    <span className="inline-flex items-baseline gap-1">
      <span
        className={cn(
          't-figure tabular transition-colors',
          unavailable ? 'text-ink-3' : flash ? 'text-live' : TONE_CLASS[tone]
        )}
        style={flash ? { transitionDuration: '600ms' } : undefined}
      >
        {value}
      </span>
      {changed ? (
        // The reduced-motion equivalent of the flash: a static mark saying
        // this number just moved.
        <span aria-hidden className="t-meta text-live-ink" title="Updated just now">
          ●
        </span>
      ) : null}
    </span>
  );
}

export function LiveStrip({
  metrics,
  connection = 'live',
  lastUpdated,
  note,
  className,
}: LiveStripProps) {
  const [reducedMotion, setReducedMotion] = React.useState(false);

  // Read the preference after mount and follow it if it changes mid-session.
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const stale = connection !== 'live';

  return (
    <div
      className={cn(
        'flex items-stretch gap-0 overflow-x-auto border-b border-rule bg-surface',
        className
      )}
      // Polite, not assertive: these tick constantly and must never interrupt.
      aria-live="polite"
      aria-atomic="false"
    >
      {metrics.map(m => (
        <div
          key={m.id}
          title={m.title}
          className="flex min-w-[132px] shrink-0 flex-col justify-center border-r border-rule px-3 py-1.5"
        >
          <span className="t-label text-ink-3">{m.label}</span>
          <LiveValue
            value={m.value}
            tone={m.tone ?? 'ink'}
            reducedMotion={reducedMotion}
            unavailable={m.unavailable}
          />
          {m.sub ? <span className="t-meta truncate text-ink-3">{m.sub}</span> : null}
        </div>
      ))}

      {stale ? (
        <div className="flex min-w-0 shrink items-center gap-1.5 px-3 py-1.5">
          <WifiOff aria-hidden className="h-3.5 w-3.5 shrink-0 text-ringing" />
          <span className="t-meta min-w-0 text-ringing-ink">
            {note ? (
              <>
                {note}
                {lastUpdated ? (
                  <span className="text-ink-3">
                    {' '}
                    · updated {lastUpdated.toLocaleTimeString('en-US')}
                  </span>
                ) : null}
              </>
            ) : connection === 'degraded' ? (
              <>
                Live feed dropped — polling every 5s
                {lastUpdated ? (
                  <span className="text-ink-3">
                    {' '}
                    · updated {lastUpdated.toLocaleTimeString('en-US')}
                  </span>
                ) : null}
              </>
            ) : (
              <>
                Not connected
                {lastUpdated ? (
                  <span className="text-ink-3">
                    {' '}
                    · last known {lastUpdated.toLocaleTimeString('en-US')}
                  </span>
                ) : null}
              </>
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
}
