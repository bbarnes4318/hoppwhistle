'use client';

import { WifiOff } from 'lucide-react';
import * as React from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * LiveStrip — one dense row under the topbar, on every page.
 *
 * ── What it is for ──────────────────────────────────────────────────────────
 *
 * An agency principal glancing at any screen asks three things in this order:
 * am I on pace today, what is today costing me, and where is my rate going.
 * An agent asks about their own day. NetEnroll staff ask about the platform.
 * The strip answers whichever of those the signed-in person is asking, and
 * nothing else. See `use-live-metrics.ts` for which figures each reading gets
 * and why.
 *
 * ── Why it is a row and not four cards ───────────────────────────────────────
 *
 * It used to be four large cards across the full width, and it took forty-odd
 * pixels off the top of every page in the application to say very little. This
 * is a single 56px row: a small uppercase label over the figure in Inter with
 * tabular numerals, its denominator or caveat inline beside it rather than on a
 * third line, figures between hairline dividers. The
 * figures share the row's width equally and it never scrolls sideways: a
 * status row that hides figures off to the right is not a status row. Below
 * 640px the figures wrap three to a line.
 *
 * The date, timezone, polling and connection state collapse into one status
 * pill at the right. The pill says Live / the feed state and the time of the
 * last update; the full original wording is its tooltip.
 *
 * ── An absent figure is an em dash and an explanation ────────────────────────
 *
 * A figure the server could not source correctly renders muted, as an em dash,
 * carrying the server's own reason as its tooltip. Nothing is estimated,
 * derived from an unrelated number, or carried forward from an earlier poll: a
 * fabricated live number on a screen where somebody watches their own money is
 * worse than an absent one.
 *
 * When a value changes the digits briefly take the live colour and settle back
 * over 600ms. Nothing else on the page moves. Under prefers-reduced-motion the
 * flash is replaced by a static change marker, so the information survives
 * without the animation.
 *
 * This component is presentational: it renders values and a connection state.
 */

export type LiveConnectionState = 'live' | 'degraded' | 'offline';

export interface LiveMetric {
  id: string;
  label: string;
  /** Preformatted. Pass what should be read, e.g. "$1,284.60" or "38%". */
  value: string;
  /** Secondary context, rendered INLINE after the value: "of 40 block". */
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
   * polling. `offline` — neither. Never render a stale number as if it were
   * live.
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
  /**
   * The day and timezone the figures are for, shown once at the right rather
   * than repeated under every figure. "2026-09-09 · America/New_York".
   */
  asOf?: string;
  /**
   * Which reading these figures are: `agency`, `agent`, `platform`, or one of
   * the two marketplace roles. Not rendered — it is stamped on the row as
   * `data-scope` so the browser smoke test can assert that the person signed
   * in got the reading meant for them, rather than inferring it from labels.
   */
  scope?: string;
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
          'text-[16px] font-semibold leading-tight tabular-nums transition-colors',
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
  asOf,
  scope,
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

  // The tail, as it read before it became a pill: the day and timezone, the
  // feed state, and when the figures were last confirmed. Carried verbatim as
  // the pill's tooltip.
  const feedText = stale
    ? (note ?? (connection === 'degraded' ? 'Live feed dropped — polling' : 'Not connected'))
    : null;
  const updatedText = lastUpdated
    ? `${connection === 'offline' ? 'last known' : 'updated'} ${lastUpdated.toLocaleTimeString('en-US')}`
    : null;
  const statusTooltip = [asOf, feedText, updatedText].filter(Boolean).join(' · ');

  return (
    <div
      data-testid="live-strip"
      data-scope={scope}
      className={cn(
        'flex min-h-14 items-stretch border-b border-rule bg-surface px-4 sm:h-14 sm:px-6 min-[1440px]:px-8',
        className
      )}
      // Polite, not assertive: these tick constantly and must never interrupt.
      aria-live="polite"
      aria-atomic="false"
    >
      {/*
        The figures share the row's width rather than scrolling: every figure
        is visible at every width without anybody reaching for a scrollbar.
        Each takes an equal share and truncates its caveat before its value;
        below 640px they wrap three to a line instead of squeezing.
      */}
      <div className="grid min-w-0 flex-1 grid-cols-3 gap-y-2 py-2 sm:flex sm:items-stretch sm:py-0">
        {metrics.map(m => (
          <div
            key={m.id}
            title={m.title}
            /*
            Machine-readable, so the browser smoke test can compare this figure
            with the one the page below reports for the same tenant rather than
            parsing it out of the rendered text. The attribute carries the SAME
            string that is rendered a line down, so the two cannot disagree.
            See apps/web/e2e/platform-landing.smoke.mjs.
          */
            data-figure={m.id}
            data-figure-value={m.value}
            className="flex min-w-0 flex-col justify-center gap-0.5 whitespace-nowrap pr-2 sm:flex-1 sm:border-r sm:border-rule sm:px-4 sm:first:pl-0 sm:last:border-r-0 xl:px-5"
          >
            <span className="t-label truncate text-ink-3">{m.label}</span>
            {/*
            The value and its denominator on ONE line. A third line per figure
            is what made this a band of cards rather than a strip, and the
            denominator is only ever read together with the number anyway.
          */}
            <span className="flex min-w-0 items-baseline gap-1.5">
              <LiveValue
                value={m.value}
                tone={m.tone ?? 'ink'}
                reducedMotion={reducedMotion}
                unavailable={m.unavailable}
              />
              {m.sub ? (
                <span className="t-meta hidden min-w-0 truncate text-ink-3 md:inline">
                  {m.sub}
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>

      {/*
        The status pill, pushed right. Live: a live dot, "Live" and the time of
        the last update. Degraded: a ringing dot and the feed's own wording.
        Offline: a dropped dot, the WifiOff mark and the same. Everything the
        tail used to spell out — date, timezone, polling interval, updated
        time — is the tooltip, word for word.
      */}
      <div className="flex shrink-0 items-center border-l border-rule pl-3 sm:pl-4">
        <Tooltip content={statusTooltip || 'Live'} align="end">
          <span
            tabIndex={0}
            className={cn(
              'inline-flex h-7 items-center gap-2 whitespace-nowrap rounded-full border px-2.5 t-meta font-medium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              connection === 'live' && 'border-rule bg-surface text-ink-2',
              connection === 'degraded' && 'border-rule bg-surface text-ink-2',
              connection === 'offline' &&
                'border-transparent bg-dropped-tint text-dropped-ink [&>svg]:text-dropped'
            )}
          >
            <span
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                connection === 'live' && 'bg-live',
                connection === 'degraded' && 'bg-ringing',
                connection === 'offline' && 'bg-dropped'
              )}
            />
            {connection === 'offline' ? (
              <WifiOff aria-hidden className="h-3.5 w-3.5 shrink-0 text-ringing" />
            ) : null}
            {/* Only an outage earns words on the strip; polling is the normal state
                and says so in the tooltip rather than across the row. */}
            {connection === 'offline' ? (
              <span className="hidden lg:inline">{feedText}</span>
            ) : connection === 'live' ? (
              <span>Live</span>
            ) : null}
            {updatedText ? (
              <span className="hidden font-normal text-ink-3 tabular-nums sm:inline">
                {lastUpdated
                  ? lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                  : null}
              </span>
            ) : null}
          </span>
        </Tooltip>
      </div>
    </div>
  );
}
