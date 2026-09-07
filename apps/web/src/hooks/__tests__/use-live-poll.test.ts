import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLivePoller, jittered } from '../use-live-poll';

/**
 * The polling that has to survive a floor of 45 agents.
 *
 * ── What this is defending ───────────────────────────────────────────────────
 *
 * The delivery portal is left open all day. The larger launch agency has 45
 * licensed agents; the principal, the floor leads and a wall display all sit on
 * the same page, and each page polls two endpoints that run a rating summary and
 * a ledger read. A plain `setInterval` bills every one of those tabs whether or
 * not a human is in front of it -- and most are not: behind another window, on a
 * laptop with the lid shut, on a machine somebody went home from.
 *
 * The properties below are what turn that into load that scales with tabs being
 * READ rather than tabs being OPEN. They are asserted against the real
 * scheduler, driven by fake timers, rather than against a description of it.
 *
 * `createLivePoller` is the scheduling with no React in it, which is why this
 * suite can drive it directly in a plain Node environment.
 */

describe('createLivePoller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Deterministic jitter, so a tick is exactly the interval. */
  const noJitter = () => 0.5;

  it('loads once immediately and then on the interval', async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const poller = createLivePoller({
      load,
      intervalMs: 30_000,
      isVisible: () => true,
      random: noJitter,
    });

    poller.start();
    expect(load).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(3);

    poller.stop();
  });

  it('does no work at all while the tab is hidden', async () => {
    let visible = true;
    const load = vi.fn().mockResolvedValue(undefined);
    const poller = createLivePoller({
      load,
      intervalMs: 30_000,
      isVisible: () => visible,
      random: noJitter,
    });

    poller.start();
    expect(load).toHaveBeenCalledTimes(1);

    visible = false;
    // Four intervals' worth of a backgrounded tab.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(load).toHaveBeenCalledTimes(1);

    poller.stop();
  });

  it('keeps its loop alive while hidden, so it resumes on its own', async () => {
    /*
     * A hidden tick schedules the next one rather than ending the loop. A page
     * that stopped for good because it missed the visibility event would be a
     * stale screen with no way to tell it was stale.
     */
    let visible = true;
    const load = vi.fn().mockResolvedValue(undefined);
    const poller = createLivePoller({
      load,
      intervalMs: 30_000,
      isVisible: () => visible,
      random: noJitter,
    });

    poller.start();
    visible = false;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(load).toHaveBeenCalledTimes(1);

    // No event, no refresh -- just visible again by the time a tick lands.
    visible = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it('refreshes on demand, which is what a returning tab uses', async () => {
    let visible = true;
    const load = vi.fn().mockResolvedValue(undefined);
    const poller = createLivePoller({
      load,
      intervalMs: 30_000,
      isVisible: () => visible,
      random: noJitter,
    });

    poller.start();
    visible = false;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(load).toHaveBeenCalledTimes(1);

    // Coming back must not mean waiting up to another interval to see anything
    // current, on a screen whose whole point is that it is live.
    visible = true;
    poller.refresh();
    expect(load).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it('does not queue a second request while one is still in flight', async () => {
    /*
     * A fixed drumbeat against a slow database gives each tab a growing backlog
     * of requests, which makes the database slower. The next tick is scheduled
     * only after the previous request settles, and a refresh during one is
     * dropped rather than stacked.
     */
    let release: (() => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        })
    );
    const poller = createLivePoller({
      load,
      intervalMs: 30_000,
      isVisible: () => true,
      random: noJitter,
    });

    poller.start();
    expect(load).toHaveBeenCalledTimes(1);

    poller.refresh();
    poller.refresh();
    expect(load).toHaveBeenCalledTimes(1);

    // Even a tick landing mid-request does not stack one.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(1);

    // Flush the microtasks that resume `run()` and clear its in-flight flag.
    release?.();
    await vi.advanceTimersByTimeAsync(0);

    poller.refresh();
    expect(load).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it('stops entirely once stopped', async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const poller = createLivePoller({
      load,
      intervalMs: 30_000,
      isVisible: () => true,
      random: noJitter,
    });

    poller.start();
    poller.stop();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(load).toHaveBeenCalledTimes(1);

    // And a refresh after stopping does nothing: an unmounted page must not
    // keep fetching because something still holds a handle to it.
    poller.refresh();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reports every load as settled, including one that threw', async () => {
    // The page comes off its spinner either way. A failed load leaves the last
    // figures on screen, which is better than a permanent spinner.
    const settled = vi.fn();
    const load = vi.fn().mockRejectedValue(new Error('the network went away'));
    const poller = createLivePoller({
      load,
      intervalMs: 30_000,
      isVisible: () => true,
      onSettled: settled,
      random: noJitter,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalled();

    poller.stop();
  });
});

describe('jittered', () => {
  it('stays within ±15% of the interval', () => {
    // The point is spread, not drift: a tab must not quietly poll at half the
    // interval it asked for, or at twice it.
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const value = jittered(30_000, () => r);
      expect(value).toBeGreaterThanOrEqual(25_500);
      expect(value).toBeLessThanOrEqual(34_500);
    }
  });

  it('actually varies, so tabs opened together do not stay in lockstep', () => {
    const values = new Set([0.1, 0.4, 0.9].map(r => jittered(30_000, () => r)));
    expect(values.size).toBe(3);
  });
});
