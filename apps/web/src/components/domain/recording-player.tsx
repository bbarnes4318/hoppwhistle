'use client';

import { Loader2, Pause, Play } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { DurationBar, formatDurationSeconds } from './duration-bar';

/**
 * RecordingPlayer — waveform with the billable threshold marked.
 *
 * The threshold line is the reason this exists rather than a bare <audio>. When
 * someone disputes a call, the question is almost always "was it long enough",
 * and the answer should be visible in the shape before anyone presses play.
 *
 * PEAKS. Decoding audio in the browser to draw a real waveform costs a fetch of
 * the whole file plus a decode, which is the wrong trade in a list. Pass
 * precomputed `peaks` (0..1, ~200 buckets) from the API when you have them. With
 * none, the lane renders flat and still carries position and the threshold — an
 * honest "no waveform available" rather than a fabricated one.
 */

export interface RecordingPlayerProps {
  src: string;
  /** Total length in seconds. Used until metadata loads. */
  durationSeconds: number;
  /** Billable threshold in seconds, marked on the waveform and the bar. */
  thresholdSeconds?: number | null;
  /** Normalised amplitudes, 0..1. */
  peaks?: number[];
  className?: string;
}

const WAVE_HEIGHT = 48;

export function RecordingPlayer({
  src,
  durationSeconds,
  thresholdSeconds,
  peaks,
  className,
}: RecordingPlayerProps) {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [current, setCurrent] = React.useState(0);
  const [duration, setDuration] = React.useState(durationSeconds);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const safeDuration = duration > 0 ? duration : durationSeconds || 1;
  const progress = Math.min(1, current / safeDuration);
  const thresholdPct =
    thresholdSeconds && thresholdSeconds > 0
      ? Math.min(100, (thresholdSeconds / safeDuration) * 100)
      : null;

  const toggle = React.useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      try {
        setLoading(true);
        await el.play();
        setError(null);
      } catch {
        // Autoplay policy, a 403 on a signed URL, or a dead file.
        setError('Could not play this recording.');
      } finally {
        setLoading(false);
      }
    } else {
      el.pause();
    }
  }, []);

  /** Seek from a click or a keypress on the waveform. */
  const seekTo = React.useCallback(
    (seconds: number) => {
      const el = audioRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(seconds, safeDuration));
      el.currentTime = clamped;
      setCurrent(clamped);
    },
    [safeDuration]
  );

  const onWaveClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo(((e.clientX - rect.left) / rect.width) * safeDuration);
  };

  const onWaveKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Five-second nudges, matching what a transcript reviewer actually needs.
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      seekTo(current + 5);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seekTo(current - 5);
    } else if (e.key === 'Home') {
      e.preventDefault();
      seekTo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      seekTo(safeDuration);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      void toggle();
    }
  };

  const bars = peaks && peaks.length > 0 ? peaks : null;

  return (
    <div className={cn('rounded-card border border-rule bg-surface p-3', className)}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={e => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onError={() => setError('Recording unavailable.')}
      />

      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={() => void toggle()}
          disabled={Boolean(error)}
          aria-label={playing ? 'Pause recording' : 'Play recording'}
          className="h-9 w-9 shrink-0 rounded-full bg-money p-0 text-white hover:bg-money/90 disabled:opacity-40"
        >
          {loading ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : playing ? (
            <Pause aria-hidden className="h-4 w-4" />
          ) : (
            <Play aria-hidden className="h-4 w-4" />
          )}
        </Button>

        <div
          role="slider"
          tabIndex={0}
          aria-label="Recording position"
          aria-valuemin={0}
          aria-valuemax={Math.round(safeDuration)}
          aria-valuenow={Math.round(current)}
          aria-valuetext={`${formatDurationSeconds(current)} of ${formatDurationSeconds(safeDuration)}`}
          onClick={onWaveClick}
          onKeyDown={onWaveKeyDown}
          className="relative min-w-0 flex-1 cursor-pointer rounded-control focus-visible:outline-none"
          style={{ height: WAVE_HEIGHT }}
        >
          {bars ? (
            <div className="flex h-full items-center gap-px overflow-hidden">
              {bars.map((p, i) => {
                const played = i / bars.length <= progress;
                const h = Math.max(2, p * WAVE_HEIGHT);
                return (
                  <span
                    key={i}
                    className={cn('flex-1 rounded-[1px]', played ? 'bg-live' : 'bg-rule-strong')}
                    style={{ height: h }}
                  />
                );
              })}
            </div>
          ) : (
            // No peaks: a flat lane that still shows position. Not a fake wave.
            <div className="flex h-full items-center">
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                <div
                  className="absolute inset-y-0 left-0 bg-live"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* The billable threshold, marked across the full height. */}
          {thresholdPct !== null ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-[2px] -translate-x-1/2 bg-ink-2"
              style={{ left: `${thresholdPct}%` }}
              title={`Billable threshold — ${formatDurationSeconds(thresholdSeconds ?? 0)}`}
            />
          ) : null}

          {/* Playhead. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-money"
            style={{ left: `${progress * 100}%` }}
          />
        </div>

        <span className="t-data tabular shrink-0 text-ink-2">
          {formatDurationSeconds(current)} / {formatDurationSeconds(safeDuration)}
        </span>
      </div>

      {/* The same bar as every call row, expanded — one shape, everywhere. */}
      <div className="mt-3">
        <DurationBar
          seconds={safeDuration}
          thresholdSeconds={thresholdSeconds}
          scaleSeconds={Math.max(safeDuration, (thresholdSeconds ?? 0) * 1.5)}
          size="detail"
          showValue
        />
      </div>

      {error ? (
        <p role="alert" className="t-meta mt-2 text-dropped-ink">
          {error}
        </p>
      ) : null}

      {thresholdPct !== null && !error ? (
        <p className="t-meta mt-2 text-ink-3">
          Billable threshold {formatDurationSeconds(thresholdSeconds ?? 0)}, marked on the waveform.
        </p>
      ) : null}
    </div>
  );
}
