'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { useAuth } from '@/hooks/use-auth';
import { useWhiteLabelView } from '@/hooks/use-white-label-view';

import { AGENT_NAV, WHITE_LABEL_OWNER_NAV } from './nav-config';
import { pageTitleFor } from './page-title';

/**
 * The current page's name, as the viewer's own sidebar names it: the CRM is
 * "My customers" to an agent. The topbar and the page header both read it.
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
