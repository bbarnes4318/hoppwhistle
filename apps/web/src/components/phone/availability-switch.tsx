'use client';

import { Loader2, PhoneOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * The agent's own on/off switch: am I taking calls right now.
 *
 * ── What this replaces ───────────────────────────────────────────────────────
 *
 * Nothing that worked. There were two controls that looked like they did this:
 *
 *   * the Available/Away/On-call dropdown in the call-centre header, bound to a
 *     React `useState` in `CallCenterPortal` and never sent anywhere at all;
 *     and
 *   * `AgentStatusSelector` below, which does reach the server -- but writes
 *     the Redis presence key that `services/routing.ts` deliberately ignores,
 *     and which the softphone overwrites with an unconditional 'available' on
 *     every SIP registration and reconnect. An agent who set themselves away
 *     there had their choice undone by the next transport blip.
 *
 * So an agent at lunch kept being rung, and the call went to somebody who could
 * not take it instead of to somebody who could.
 *
 * ── Why it sits beside the status selector rather than replacing it ──────────
 *
 * They answer different questions and both are worth showing. The selector
 * reports what the SOFTPHONE is doing -- registered, on a call, disconnected --
 * which is real and is what the live view and the availability-seconds figure
 * are built on. This is what the PERSON decided, it is durable, and it is the
 * one routing obeys.
 *
 * ── Optimistic, and it puts itself back ──────────────────────────────────────
 *
 * The switch moves immediately, because a control that lags makes somebody
 * press it twice -- and pressing this one twice puts them back on the queue
 * they were trying to leave. If the write fails it reverts and says so, rather
 * than leaving the agent believing they are off while calls keep arriving.
 *
 * ── It stays live during a call ──────────────────────────────────────────────
 *
 * The control it replaced in the call-centre header disabled itself while a
 * call was up. That is exactly the moment an agent reaches for it: "this is my
 * last one." Turning off does not touch the call in progress -- it only stops
 * the NEXT one -- so there is no reason to lock it.
 */
interface AvailabilitySwitchProps {
  /**
   * Told the current reading whenever it changes, including the first read and
   * a revert after a failed write. `null` means "not an agent, or unreadable",
   * which is not the same as off: the caller must not render it as off.
   */
  onChange?: (available: boolean | null) => void;
  className?: string;
}

export function AvailabilitySwitch({
  onChange,
  className,
}: AvailabilitySwitchProps = {}): JSX.Element | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  /*
   * Held in a ref so a caller passing an inline arrow does not re-fire the
   * notification on every render of its parent.
   */
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    onChangeRef.current?.(available);
  }, [available]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await apiClient.get<{ availableForCalls: boolean }>(
          '/api/v1/agent/availability'
        );
        if (!active) return;
        /*
         * Defaults to ON when the read gives nothing. The column defaults to
         * true and an agent whose state could not be read is on the queue;
         * rendering OFF would tell them calls are stopped when they are not.
         */
        setAvailable(response.data?.availableForCalls ?? true);
      } catch {
        // Not an agent, or the endpoint refused. Render nothing rather than a
        // switch that cannot work.
        if (active) setAvailable(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (available === null || saving) return;
    const next = !available;

    setAvailable(next);
    setSaving(true);
    setError(false);
    try {
      const response = await apiClient.put<{ availableForCalls: boolean }>(
        '/api/v1/agent/availability',
        { availableForCalls: next }
      );
      if (response.error) throw new Error(response.error.message);
    } catch {
      /*
       * Put it back. An agent left looking "off" while the server still has
       * them on the queue is the worst outcome here: they stop expecting calls
       * and the calls keep coming.
       */
      setAvailable(!next);
      setError(true);
    } finally {
      setSaving(false);
    }
  }, [available, saving]);

  // Not an agent: no switch.
  if (available === null) return null;

  return (
    <AvailabilityToggle
      available={available}
      saving={saving}
      error={error}
      onToggle={() => void toggle()}
      className={className}
    />
  );
}

export interface AvailabilityToggleProps {
  available: boolean;
  saving?: boolean;
  /** The last write failed and was reverted. */
  error?: boolean;
  onToggle: () => void;
  className?: string;
}

/**
 * The switch itself, with no request behind it, so /design-preview can show
 * it without an agent session.
 */
export function AvailabilityToggle({
  available,
  saving = false,
  error = false,
  onToggle,
  className,
}: AvailabilityToggleProps): JSX.Element {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={available}
        aria-label={available ? 'Taking calls. Turn off.' : 'Not taking calls. Turn on.'}
        onClick={onToggle}
        disabled={saving}
        title={
          available
            ? 'You are on the queue. Click to stop receiving calls.'
            : 'You are off the queue. No calls will ring your phone.'
        }
        className={cn(
          'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full',
          'transition-colors duration-150 ease-out ne-motion',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          // The hit area grows to 44px on touch screens; the track stays small.
          'before:absolute before:-inset-3 before:content-[""] [@media(pointer:fine)]:before:hidden',
          available ? 'bg-live' : 'bg-rule-strong',
          saving && 'opacity-60'
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-surface shadow-card',
            'transition-transform duration-150 ease-out ne-motion',
            available ? 'translate-x-[18px]' : 'translate-x-0.5'
          )}
        />
      </button>

      <span
        className={cn(
          'text-xs font-medium leading-none',
          available ? 'text-live-ink' : 'text-ink-2'
        )}
      >
        {saving ? (
          <Loader2
            className="h-3 w-3 animate-spin motion-reduce:animate-none"
            aria-label="Saving"
          />
        ) : available ? (
          'Taking calls'
        ) : (
          <span className="inline-flex items-center gap-1">
            <PhoneOff className="h-3 w-3" aria-hidden />
            Not taking calls
          </span>
        )}
      </span>

      {error ? (
        <span className="text-xs font-medium text-dropped-ink" role="alert">
          Could not save
        </span>
      ) : null}
    </div>
  );
}
