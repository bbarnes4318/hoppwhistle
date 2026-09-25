'use client';

import { useEffect, useRef, useState } from 'react';

import type { SoftphoneState } from './format';
import { keypadKeyFor, resolveShortcut, type ShortcutAction } from './shortcuts';

/**
 * Seconds since `since`, ticking once a second while `since` is set.
 *
 * For the ring and hold timers. The talk timer does not need it: the provider
 * already counts `currentCall.duration` from the answer.
 */
export function useElapsedSeconds(since: Date | number | null | undefined): number {
  const start = since == null ? null : typeof since === 'number' ? since : since.getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (start == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [start]);

  return start == null ? 0 : Math.max(0, Math.floor((now - start) / 1000));
}

/**
 * When `active` last turned true — the moment a call went on hold, say — or
 * null while it is false. The provider does not keep a hold start time, and
 * the hold timer is presentation, so it is remembered here rather than there.
 */
export function useSinceTrue(active: boolean): number | null {
  const [since, setSince] = useState<number | null>(active ? Date.now() : null);
  useEffect(() => {
    setSince(active ? Date.now() : null);
  }, [active]);
  return since;
}

/**
 * The tab title alternates while a call rings, so an agent on another tab
 * sees it in the tab strip. The original title comes back when it stops.
 */
export function useRingingTitle(active: boolean, caller: string): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const original = document.title;
    let flip = false;
    const tick = (): void => {
      flip = !flip;
      document.title = flip ? `Incoming call · ${caller}` : 'Incoming call';
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      clearInterval(id);
      document.title = original;
    };
  }, [active, caller]);
}

export type MicPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * Whether the browser will let the page use the microphone.
 *
 * Read from the Permissions API rather than from the provider: the provider's
 * mic request swallows a refusal and carries on registering, so without this
 * a blocked mic is a phone that looks ready and connects silent calls. Firefox
 * and older Safari do not expose "microphone" here, which reads as unknown and
 * shows nothing.
 */
export function useMicPermission(): MicPermission {
  const [state, setState] = useState<MicPermission>('unknown');

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const update = (): void => {
      if (status && !cancelled) setState(status.state as MicPermission);
    };
    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then(s => {
        status = s;
        update();
        s.addEventListener('change', update);
      })
      .catch(() => {
        /* Not supported in this browser: leave it unknown. */
      });
    return () => {
      cancelled = true;
      status?.removeEventListener('change', update);
    };
  }, []);

  return state;
}

/**
 * The softphone's single-key shortcuts. One window listener for the panel, so
 * the letters mean the same thing wherever focus is (outside a text field).
 */
export function useSoftphoneShortcuts(
  state: SoftphoneState,
  enabled: boolean,
  onAction: (action: ShortcutAction) => void
): void {
  const handler = useRef(onAction);
  handler.current = onAction;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      const action = resolveShortcut(e, state);
      if (!action) return;
      e.preventDefault();
      handler.current(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, enabled]);
}

/**
 * Physical-keyboard entry for a visible keypad: digits, * and #, Backspace and
 * Enter. Ignored inside other fields; the keypad's own number field handles
 * its keystrokes natively.
 */
export function useKeypadKeyboard(
  enabled: boolean,
  handlers: { onDigit: (d: string) => void; onBackspace: () => void; onEnter: () => void }
): string | null {
  const ref = useRef(handlers);
  ref.current = handlers;
  // The last key pressed, for a moment, so the matching on-screen key can
  // show the press — otherwise typing gives no feedback on the pad itself.
  const [pressed, setPressed] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let clear: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent): void => {
      const kind = keypadKeyFor(e);
      if (!kind) return;
      e.preventDefault();
      if (kind === 'digit') {
        ref.current.onDigit(e.key);
        setPressed(e.key);
        clearTimeout(clear);
        clear = setTimeout(() => setPressed(null), 150);
      } else if (kind === 'backspace') {
        ref.current.onBackspace();
      } else {
        ref.current.onEnter();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(clear);
      window.removeEventListener('keydown', onKey);
    };
  }, [enabled]);

  return pressed;
}
