'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Poll a server view on an interval, but only while somebody is looking at it.
 *
 * ── What this is for ─────────────────────────────────────────────────────────
 *
 * The delivery portal is a screen an agency leaves open all day. The larger
 * launch agency has 45 licensed agents; the principal, the floor leads and a
 * wall display all sit on the same page. A fixed `setInterval` gives that
 * agency roughly 90 requests every 30 seconds against two endpoints that each
 * run a rating summary and a ledger read, whether or not a single one of those
 * tabs is in front of a human. Most of them are not: they are behind another
 * window, on a laptop with the lid shut, or on a machine somebody went home
 * from six hours ago.
 *
 * Three things fix that, and none of them changes what the page shows:
 *
 *   1. HIDDEN TABS DO NOT POLL. A backgrounded tab stops entirely and refreshes
 *      once, immediately, when it comes back -- so the first thing a returning
 *      principal sees is current rather than six hours stale. This is the whole
 *      saving: it scales with how many of those tabs are actually being read,
 *      not with how many are open.
 *
 *   2. THE INTERVAL IS JITTERED. Tabs opened together at the start of a shift
 *      otherwise stay in lockstep for the rest of the day, and the load arrives
 *      as a spike every N seconds rather than spread across it. Each tick picks
 *      its own offset within ±15%.
 *
 *   3. A SLOW RESPONSE DOES NOT QUEUE ANOTHER. The next tick is scheduled after
 *      the previous request settles, not on a fixed drumbeat, so a database
 *      under load gets one request per tab in flight rather than a growing
 *      backlog that makes it worse.
 *
 * The one thing this does NOT do is compute anything. It calls the loader it is
 * given and hands back what the server said; every figure on these pages is
 * server-derived, and a polling hook is not the place that stops being true.
 *
 * ── Why the scheduling is not inside the hook ────────────────────────────────
 *
 * `createLivePoller` below is plain TypeScript with no React in it, and the
 * hook is a thin wrapper that starts and stops it. The interesting behaviour --
 * skipping while hidden, catching up on return, never overlapping requests --
 * is then testable directly, driven by real fake timers, rather than through a
 * rendered component in a DOM this package does not otherwise need.
 */

/** ±15%, so tabs that started together drift apart instead of spiking. */
export function jittered(intervalMs: number, random: () => number = Math.random): number {
  return Math.round(intervalMs * (0.85 + random() * 0.3));
}

export interface LivePoller {
  /** Run once now, then keep the loop going. */
  start: () => void;
  /** Stop the loop. Any request already in flight is left to settle. */
  stop: () => void;
  /** Run now, unless one is already in flight. */
  refresh: () => void;
}

export interface LivePollerOptions {
  load: () => Promise<void>;
  intervalMs: number;
  /** Whether anyone is looking. Defaults to the document's visibility. */
  isVisible?: () => boolean;
  /** Called after every settled load, successful or not. */
  onSettled?: () => void;
  random?: () => number;
}

/**
 * The scheduling, with no React in it.
 *
 * A tick that lands while the page is hidden does no work but still schedules
 * the next one, so the loop stays alive even if a visibility event is missed --
 * a page that stopped for good because it did not hear the tab come back would
 * be a stale screen with no way to tell.
 */
export function createLivePoller(options: LivePollerOptions): LivePoller {
  const { load, intervalMs, onSettled, random } = options;
  const isVisible =
    options.isVisible ??
    ((): boolean => typeof document === 'undefined' || document.visibilityState !== 'hidden');

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let inFlight = false;

  async function run(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      await load();
    } catch {
      /*
       * A loader that throws must not take the loop down with it, and must not
       * leave an unhandled rejection behind either -- every tick is fired with
       * `void`, so a rejection here surfaces as an unhandled one in the console
       * of a page that is otherwise working.
       *
       * Nothing is reported from here on purpose. The callers set their own
       * error state from the response they got; a polling loop has no view to
       * render an error into, and the honest outcome of a failed refresh is
       * that the figures already on screen stay there until the next one.
       */
    } finally {
      inFlight = false;
      onSettled?.();
    }
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(() => void tick(), jittered(intervalMs, random));
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    if (isVisible()) await run();
    schedule();
  }

  return {
    start() {
      stopped = false;
      void run();
      schedule();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    refresh() {
      if (!stopped) void run();
    },
  };
}

export interface LivePoll {
  /** True until the first load settles. Refreshes do not flip it back. */
  loading: boolean;
  /** Force a refresh now -- a Refresh button, or after a mutation. */
  refresh: () => void;
}

export function useLivePoll(
  load: () => Promise<void>,
  options: { intervalMs: number; enabled?: boolean }
): LivePoll {
  const { intervalMs, enabled = true } = options;
  const [loading, setLoading] = useState(true);

  /*
   * The loader is rebuilt on every render by most callers, since they build it
   * with `useCallback`. Holding it in a ref means the polling effect does not
   * tear down and restart on each new identity -- which would reset the timer,
   * and with a loader that changes often would poll far faster than asked.
   */
  const loadRef = useRef(load);
  loadRef.current = load;

  const pollerRef = useRef<LivePoller | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const poller = createLivePoller({
      load: () => loadRef.current(),
      intervalMs,
      onSettled: () => setLoading(false),
    });
    pollerRef.current = poller;
    poller.start();

    // Back in front of a human: show them something current straight away
    // rather than at the next tick.
    const onVisibilityChange = (): void => {
      if (document.visibilityState !== 'hidden') poller.refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      poller.stop();
      pollerRef.current = null;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, intervalMs]);

  const refresh = useCallback(() => pollerRef.current?.refresh(), []);

  return { loading, refresh };
}
