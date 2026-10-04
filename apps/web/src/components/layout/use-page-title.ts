'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { useAuth } from '@/hooks/use-auth';
import { useWhiteLabelView } from '@/hooks/use-white-label-view';

import { AGENT_NAV, WHITE_LABEL_OWNER_NAV } from './nav-config';
import { pageTitleFor } from './page-title';

/**
 * The current page's name, as the viewer's own sidebar names it: /dashboard is
 * "Today" to an agent and to a white-label owner, "Dashboard" to staff. The
 * topbar and the page header both read it.
 */
export function useCurrentPageTitle(): string {
  const pathname = usePathname();
  const { isAgentOnly } = useAuth();
  const whiteLabel = useWhiteLabelView();
  return pageTitleFor(
    pathname,
    whiteLabel ? WHITE_LABEL_OWNER_NAV : isAgentOnly ? AGENT_NAV : undefined
  );
}

/*
 * ── Who names the page ───────────────────────────────────────────────────────
 *
 * A page whose header carries its title claims it here, and the topbar stops
 * rendering its own copy: one title per page, at the top of the content where
 * the description and actions sit beside it. A page with no header keeps the
 * topbar's title, so no screen is ever left unnamed.
 */

let claims = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Claim the page title for as long as the caller is mounted and `active`. */
export function useClaimPageTitle(active: boolean): void {
  React.useEffect(() => {
    if (!active) return;
    claims += 1;
    emit();
    return () => {
      claims -= 1;
      emit();
    };
  }, [active]);
}

/** Whether something on the page is showing the title. */
export function usePageTitleClaimed(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => claims > 0,
    () => false
  );
}

/*
 * ── The topbar is the page header ────────────────────────────────────────────
 *
 * Every page is named in the topbar: its title, the one-line description under
 * it, and (on a wide screen) the page's own actions at the right of the bar. A
 * page's <PageHeader> renders those INTO the topbar through portals, so the
 * content area starts with the content and no screen spends a 70px band
 * restating its name under a bar that already had room for it.
 *
 * Portals, not a copy in a store: the description and actions stay part of the
 * page's React tree -- its state, its context, its handlers -- and only their
 * DOM moves. The topbar publishes the elements to render into; with no topbar
 * mounted (a page rendered on its own), every slot is null and the header
 * renders in place as it always did.
 */

export interface TopbarSlots {
  title: HTMLElement | null;
  description: HTMLElement | null;
  actions: HTMLElement | null;
}

let slots: TopbarSlots = { title: null, description: null, actions: null };
const slotListeners = new Set<() => void>();

function subscribeSlots(listener: () => void): () => void {
  slotListeners.add(listener);
  return () => slotListeners.delete(listener);
}

const NO_SLOTS: TopbarSlots = { title: null, description: null, actions: null };

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

/**
 * The widths at which a page's header docks into the topbar. The description
 * needs the bar's full width beside the title, so it docks from md, where the
 * sidebar appears; the actions need room beside the search, so from xl. Below
 * either, that part renders at the top of the page instead.
 */
export const DOCK_DESCRIPTION_QUERY = '(min-width: 768px)';
export const DOCK_ACTIONS_QUERY = '(min-width: 1280px)';
