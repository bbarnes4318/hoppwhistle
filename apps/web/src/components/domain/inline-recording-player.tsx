'use client';

import { AlertCircle, Loader2, Pause, Play } from 'lucide-react';
import * as React from 'react';

import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

import { formatDurationSeconds } from './duration-bar';

/**
 * A call recording that fits in a table cell: play, a seekable track, and
 * elapsed over total in the data face.
 *
 * `RecordingPlayer` is the full treatment -- waveform, billable threshold --
 * for a call opened on its own. In a list of calls that is a panel per row; an
 * agent scanning their day wants to press play on the third call without the
 * table changing shape.
 *
 * The signed URL is fetched on the first press, not with the list: it is good
 * for fifteen minutes and most rows are never played. Only one recording in
 * the app plays at a time; starting one pauses whichever was playing.
 */
export interface InlineRecordingPlayerProps {
  recordingId: string;
  /** Known length, shown before the file loads. */
  durationSeconds: number | null;
  /** Who the recording is of, for the button's accessible name. */
  label?: string;
  /**
   * For a table that already has a Duration column: the total is left to that
   * column from 640px up, and the player shows only how far in it is.
   */
  compact?: boolean;
  className?: string;
}

/** The one recording playing anywhere in the app. */
let playing: HTMLAudioElement | null = null;

function claim(el: HTMLAudioElement): void {
  if (playing && playing !== el) playing.pause();
  playing = el;
}

/** Resolve a recording id to a URL an `<audio>` can play, as Calls does. */
async function playableUrl(recordingId: string): Promise<string> {
  const response = await apiClient.get<{ url: string }>(
    `/api/v1/recordings/${encodeURIComponent(recordingId)}/url`
  );
  if (response.error || !response.data?.url) {
    throw new Error(response.error?.message || 'Recording unavailable');
  }
  const url = response.data.url;
  return url.startsWith('/') ? `${window.location.origin}${url}` : url;
}

export function InlineRecordingPlayer({
  recordingId,
  durationSeconds,
  label,
  compact = false,
  className,
}: InlineRecordingPlayerProps): JSX.Element {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [state, setState] = React.useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>(
    'idle'
  );
  const [error, setError] = React.useState<string | null>(null);
  const [current, setCurrent] = React.useState(0);
  const [length, setLength] = React.useState(durationSeconds ?? 0);

  // Leaving the page stops the audio rather than orphaning it.
  React.useEffect(
    () => () => {
      const el = audioRef.current;
      if (el) {
        el.pause();
        if (playing === el) playing = null;
      }
    },
    []
  );

  const audio = (): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;
    const el = new Audio();
    el.preload = 'metadata';
    el.addEventListener('play', () => setState('playing'));
    el.addEventListener('pause', () => setState(s => (s === 'error' ? s : 'paused')));
    el.addEventListener('ended', () => {
      setState('paused');
      setCurrent(0);
      el.currentTime = 0;
    });
    el.addEventListener('timeupdate', () => setCurrent(el.currentTime));
    el.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setLength(el.duration);
    });
    el.addEventListener('error', () => {
      setState('error');
      setError('Recording unavailable');
    });
    audioRef.current = el;
    return el;
  };

  const start = async (): Promise<void> => {
    const el = audio();
    try {
      if (!el.src) {
        setState('loading');
        el.src = await playableUrl(recordingId);
      }
      claim(el);
      await el.play();
      setError(null);
    } catch (err) {
      // A refused URL, an expired token, or the browser's autoplay rules.
      setState('error');
      setError(err instanceof Error ? err.message : 'Could not play this recording');
    }
  };

  const toggle = (): void => {
    const el = audioRef.current;
    if (el && !el.paused) {
      el.pause();
      return;
    }
    void start();
  };

  const retry = (): void => {
    // A fresh URL: the old one may simply have expired.
    const el = audioRef.current;
    if (el) el.removeAttribute('src');
    setError(null);
    void start();
  };

  const safeLength = length > 0 ? length : 1;
  const progress = Math.min(1, current / safeLength);

  const seek = (seconds: number): void => {
    const el = audioRef.current;
    const clamped = Math.max(0, Math.min(seconds, safeLength));
    setCurrent(clamped);
    if (el && el.src) el.currentTime = clamped;
  };

  const onTrackKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      seek(current + 5);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seek(current - 5);
    } else if (e.key === 'Home') {
      e.preventDefault();
      seek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      seek(safeLength);
    }
  };

  const isPlaying = state === 'playing';
  const started = state !== 'idle' && state !== 'error';
  const who = label ? ` of ${label}` : '';

  if (state === 'error') {
    return (
      <div className={cn('flex items-center gap-2', className)} data-recording-state="error">
        <AlertCircle aria-hidden className="h-4 w-4 shrink-0 text-dropped-ink" />
        <span className="t-meta truncate text-dropped-ink" role="alert" title={error ?? undefined}>
          {error ?? 'Recording unavailable'}
        </span>
        <button
          type="button"
          onClick={retry}
          className="t-meta shrink-0 font-medium text-brand-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-control"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn('flex min-w-0 items-center gap-2.5', className)}
      data-recording-state={state}
    >
      <button
        type="button"
        onClick={toggle}
        disabled={state === 'loading'}
        aria-label={isPlaying ? `Pause recording${who}` : `Play recording${who}`}
        aria-pressed={isPlaying}
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
          'transition-colors duration-150 ease-out ne-motion',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
          isPlaying
            ? 'border-brand-strong bg-brand-strong text-white hover:bg-brand-strong-hover'
            : 'border-rule-strong bg-surface text-ink hover:border-brand-ink hover:text-brand-ink'
        )}
      >
        {state === 'loading' ? (
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
        ) : isPlaying ? (
          <Pause aria-hidden className="h-3.5 w-3.5" />
        ) : (
          <Play aria-hidden className="ml-0.5 h-3.5 w-3.5" />
        )}
      </button>

      <div
        role="slider"
        tabIndex={started ? 0 : -1}
        aria-label={`Recording position${who}`}
        aria-valuemin={0}
        aria-valuemax={Math.round(safeLength)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={`${formatDurationSeconds(current)} of ${formatDurationSeconds(safeLength)}`}
        aria-disabled={!started}
        onKeyDown={started ? onTrackKey : undefined}
        onClick={
          started
            ? e => {
                const rect = e.currentTarget.getBoundingClientRect();
                seek(((e.clientX - rect.left) / rect.width) * safeLength);
              }
            : undefined
        }
        className={cn(
          // Below 640px the cell is button and time; the track needs room to be usable.
          'group relative hidden h-6 min-w-[56px] flex-1 items-center rounded-control sm:flex',
          started ? 'cursor-pointer' : 'cursor-default',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        )}
      >
        <div className="relative h-1 w-full overflow-hidden rounded-full bg-rule-strong">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-brand-ink"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        {started ? (
          <span
            aria-hidden
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-brand-ink shadow-sm"
            style={{ left: `${progress * 100}%` }}
          />
        ) : null}
      </div>

      <span
        className="t-data shrink-0 whitespace-nowrap text-xs tabular-nums text-ink-2"
        aria-hidden
      >
        {started ? (
          <>
            {formatDurationSeconds(current)}
            <span className={cn('text-ink-3', compact && 'sm:hidden')}>
              {' '}
              / {formatDurationSeconds(safeLength)}
            </span>
          </>
        ) : length > 0 ? (
          <span className={cn(compact && 'sm:hidden')}>{formatDurationSeconds(length)}</span>
        ) : compact ? null : (
          '—'
        )}
      </span>
    </div>
  );
}
