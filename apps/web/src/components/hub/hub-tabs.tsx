'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * A hub: several screens that used to be sidebar entries, as tabs of one.
 *
 * ── The tab is in the URL ────────────────────────────────────────────────────
 *
 * `?tab=<key>`, so every tab can be linked to, bookmarked and reached by the
 * redirects in `lib/staff-only-routes.ts` (`/billing` lands on
 * `/buyers?tab=wallets`). Changing tab replaces the URL rather than pushing
 * it: the back button leaves the hub instead of stepping through its tabs.
 * An unknown or missing key is the default tab.
 *
 * ── Each tab is a whole view ─────────────────────────────────────────────────
 *
 * What a tab renders is the same component the old page renders -- see
 * `components/<area>/<name>-view.tsx` -- with its own canvas, header and
 * polling. Only the active tab is mounted, so a hub fires the requests of the
 * one screen being looked at and no other.
 */

export interface HubTab {
  key: string;
  label: React.ReactNode;
  /** Rendered only while this tab is active. */
  render: () => React.ReactNode;
}

export interface HubTabsProps {
  tabs: HubTab[];
  defaultTab: string;
  /** What the tab strip is, for a screen reader: "Buyers sections". */
  label: string;
}

/**
 * `useSearchParams` needs a Suspense boundary for the page around it to build,
 * so the hub carries its own and no page using it has to remember.
 */
export function HubTabs(props: HubTabsProps): JSX.Element {
  return (
    <React.Suspense fallback={null}>
      <HubTabsInner {...props} />
    </React.Suspense>
  );
}

/** The active tab: `?tab=` when it names one of these, the default otherwise. */
export function activeTabOf(
  requested: string | null | undefined,
  tabs: HubTab[],
  fallback: string
) {
  return requested && tabs.some(tab => tab.key === requested) ? requested : fallback;
}

function HubTabsInner({ tabs, defaultTab, label }: HubTabsProps): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = activeTabOf(searchParams?.get('tab'), tabs, defaultTab);

  function select(key: string): void {
    if (key === active) return;
    // A fresh query: another tab's filters and `section` do not follow it.
    router.replace(`${pathname ?? ''}?${new URLSearchParams({ tab: key }).toString()}`, {
      scroll: false,
    });
  }

  return (
    <Tabs value={active} onValueChange={select} className="flex min-w-0 flex-col">
      <div className="px-4 pt-4 sm:px-6 sm:pt-6 min-[1440px]:px-8 min-[1440px]:pt-8">
        <TabsList aria-label={label}>
          {tabs.map(tab => (
            <TabsTrigger key={tab.key} value={tab.key} data-hub-tab={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map(tab => (
        <TabsContent key={tab.key} value={tab.key} className="mt-0 min-w-0">
          {tab.key === active ? tab.render() : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}
