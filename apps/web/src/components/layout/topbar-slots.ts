'use client';

/**
 * The topbar's slots, on their own so that anything in the shell (the
 * softphone, a page) can render into the bar without importing the nav.
 * See "The topbar is the page header" in use-page-title.ts.
 */

import * as React from 'react';

export interface TopbarSlots {
  title: HTMLElement | null;
  description: HTMLElement | null;
  actions: HTMLElement | null;
  /**
   * A page's own section navigation, docked beside the title (the Quote
   * page's tabs). While it holds anything, the title and description are
   * visually hidden -- the active tab names the page -- so the page gets one
   * header row instead of two.
   */
  nav: HTMLElement | null;
  /** The softphone's status, docked in the bar instead of floating over the page. */
  presence: HTMLElement | null;
}

let slots: TopbarSlots = {
  title: null,
  description: null,
  actions: null,
  nav: null,
  presence: null,
};
const slotListeners = new Set<() => void>();

function subscribeSlots(listener: () => void): () => void {
  slotListeners.add(listener);
  return () => slotListeners.delete(listener);
}

const NO_SLOTS: TopbarSlots = {
  title: null,
  description: null,
  actions: null,
  nav: null,
  presence: null,
};

/** The topbar's ref callback for one slot. */
export function publishTopbarSlot(name: keyof TopbarSlots, element: HTMLElement | null): void {
  if (slots[name] === element) return;
  slots = { ...slots, [name]: element };
  slotListeners.forEach(listener => listener());
}

/** Where a page's header renders into the topbar; nulls when there is none. */
export function useTopbarSlots(): TopbarSlots {
  return React.useSyncExternalStore(
    subscribeSlots,
    () => slots,
    () => NO_SLOTS
  );
}

/** Whether `query` matches, re-read as the window changes. False on the server. */
export function useMediaQuery(query: string): boolean {
  return React.useSyncExternalStore(
    listener => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener?.('change', listener);
      return () => list.removeEventListener?.('change', listener);
    },
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches,
    () => false
  );
}
