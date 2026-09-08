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
 * Five things fix that, and none of them changes what the page shows:
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
 *   4. A REFUSAL THAT WILL NOT CHANGE STOPS THE LOOP. An agency-scoped
 *      endpoint answering 409 NO_ACTING_TENANT to an operator who has entered
 *      no agency is not a transient failure -- it is the correct answer, and it
 *      will be the correct answer in five seconds too. Retrying it produces
 *      dozens of refused requests per page load and nothing else. A loader that
 *      reports `'refused'` ends the loop; entering an agency reloads the page,
 *      which is what starts it again.
 *
 *   5. A TRANSIENT FAILURE BACKS OFF. A loader that reports `'failed'` doubles
 *      the wait, up to a ceiling, and returns to the normal interval on the
 *      next success. A server having a bad minute should not be polled harder
 *      for it.
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

/**
 * What a load reports back.
 *
 * `undefined` means "nothing to say", which is treated as success -- callers
 * written before this existed return `Promise<void>` and keep working.
 */
export type PollOutcome = 'ok' | 'refused' | 'failed';

/** No more than this between attempts, however long the backoff has run. */
const MAX_BACKOFF_MS = 5 * 60_000;

/** ±15%, so tabs that started together drift apart instead of spiking. */
export function jittered(intervalMs: number, random: () => number = Math.random): number {
  return Math.round(intervalMs * (0.85 + random() * 0.3));
}

export interface LivePoller {
  /** Run once now, then keep the loop going. */
  start: () => void;
  /** Stop the loop. Any request already in flight is left to settle. */
  stop: () => void;
  /**
   * Run now, unless one is already in flight -- or unless the loop has been
   * stopped by a terminal refusal, which no amount of asking again will change.
   */
  refresh: () => void;
  /** True once a loader reported `'refused'`. The loop is over. */
  refused: () => boolean;
}

export interface LivePollerOptions {
  load: () => Promise<PollOutcome | void>;
  intervalMs: number;
  /** Whether anyone is looking. Defaults to the document's visibility. */
  isVisible?: () => boolean;
  /** Called after every settled load, successful or not. */
  onSettled?: () => void;
  /** Called once, when a loader reports a refusal that ends the loop. */
  onRefused?: () => void;
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
  const { load, intervalMs, onSettled, onRefused, random } = options;
  const isVisible =
    options.isVisible ??
    ((): boolean => typeof document === 'undefined' || document.visibilityState !== 'hidden');

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let inFlight = false;
  let refused = false;
  /** Multiplies the interval while the loader keeps reporting failure. */
  let backoff = 1;

  async function run(): Promise<void> {
    if (inFlight || refused) return;
    inFlight = true;
    try {
      const outcome = await load();

      if (outcome === 'refused') {
        // Terminal. Not an error, and not something to try again: the server
        // answered correctly and will answer the same way next time.
        refused = true;
        backoff = 1;
        stop();
        onRefused?.();
        return;
      }

      backoff = outcome === 'failed' ? Math.min(backoff * 2, 64) : 1;
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
      backoff = Math.min(backoff * 2, 64);
    } finally {
      inFlight = false;
      onSettled?.();
    }
  }

  function schedule(): void {
    if (stopped || refused) return;
    const wait = Math.min(jittered(intervalMs, random) * backoff, MAX_BACKOFF_MS);
    timer = setTimeout(() => void tick(), wait);
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    if (isVisible()) await run();
    schedule();
  }

  function stop(): void {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return {
    start() {
      if (refused) return;
      stopped = false;
      // Scheduled after the first load settles, not beside it, so the wait
      // reflects what that load reported. Scheduling first meant the tick after
      // a failure was still at the plain interval and the backoff only took
      // effect from the second one.
      void run().then(() => schedule());
    },
    stop,
    refresh() {
      if (!stopped && !refused) void run();
    },
    refused: () => refused,
  };
}

export interface LivePoll {
  /** True until the first load settles. Refreshes do not flip it back. */
  loading: boolean;
  /** Force a refresh now -- a Refresh button, or after a mutation. */
  refresh: () => void;
  /**
   * True once the server refused in a way that will not change while this page
   * is open. The loop has stopped; a caller can say so rather than showing a
   * figure that is never going to arrive.
   */
  refused: boolean;
}

export function useLivePoll(
  load: () => Promise<PollOutcome | void>,
  options: { intervalMs: number; enabled?: boolean }
): LivePoll {
  const { intervalMs, enabled = true } = options;
  const [loading, setLoading] = useState(true);
  const [refused, setRefused] = useState(false);

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
      onRefused: () => setRefused(true),
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

  return { loading, refresh, refused };
}
