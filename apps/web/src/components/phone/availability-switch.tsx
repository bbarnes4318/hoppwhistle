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
    <div className={cn('flex items-center gap-1.5', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={available}
        aria-label={available ? 'Taking calls. Turn off.' : 'Not taking calls. Turn on.'}
        onClick={() => void toggle()}
        disabled={saving}
        title={
          available
            ? 'You are on the queue. Click to stop receiving calls.'
            : 'You are off the queue. No calls will ring your phone.'
        }
        className={cn(
          'relative inline-flex h-4 w-7 flex-shrink-0 items-center rounded-full transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          available ? 'bg-live' : 'bg-ink-3',
          saving && 'opacity-60'
        )}
      >
        <span
          className={cn(
            'inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform',
            available ? 'translate-x-3.5' : 'translate-x-0.5'
          )}
        />
      </button>

      <span
        className={cn(
          'text-[10px] font-medium leading-none',
          available ? 'text-live-ink' : 'text-ink-3'
        )}
      >
        {saving ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : available ? (
          'Taking calls'
        ) : (
          <span className="inline-flex items-center gap-1">
            <PhoneOff className="h-3 w-3" />
            Off
          </span>
        )}
      </span>

      {error ? (
        <span className="text-[10px] font-medium text-destructive" role="alert">
          Could not save
        </span>
      ) : null}
    </div>
  );
}
