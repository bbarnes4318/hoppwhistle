'use client';

/**
 * Quote: underwrite and price final expense across every carrier.
 *
 * Every agent's and every agency's -- standard, not an upgrade. Five tabs for
 * everyone (the quoter, saved quotes, the two lookups and the carrier data),
 * and two more for an agency's principal and NetEnroll staff: how the agency
 * quotes, and its quoter settings. The tab is in the URL (`?tab=`), so a
 * reload or a shared link opens the same one; an unknown tab, or one this
 * person may not open, is the quoter.
 *
 * The engine runs on the server. Nothing this page loads carries a rate table,
 * a rule record or a prescription list.
 */

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { createPortal } from 'react-dom';

import { CarrierCoverage } from '@/components/fex/carriers/carrier-coverage';
import { QuoteHistory } from '@/components/fex/history/quote-history';
import { QuoteInsights } from '@/components/fex/insights/quote-insights';
import { ConditionLookup } from '@/components/fex/lookup/condition-lookup';
import { DrugLookup } from '@/components/fex/lookup/drug-lookup';
import { QuoteWorkspace } from '@/components/fex/quote-workspace';
import { QuoteSettings } from '@/components/fex/settings/quote-settings';
import { useMediaQuery, useTopbarSlots } from '@/components/layout/topbar-slots';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import { useFexSettings } from '@/hooks/use-fex-quote';
import { emptyDraft } from '@/lib/fex/draft';
import { quoteTabsFor, type QuoteTabKey } from '@/lib/fex/tabs';
import { cn } from '@/lib/utils';

export default function QuotePage(): JSX.Element {
  const router = useRouter();
  const { hasFullAccess, isPlatformAdmin } = useAuth();
  const tabs = quoteTabsFor(hasFullAccess || isPlatformAdmin);

  const [requested, setRequested] = React.useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tab')
  );
  const tab: QuoteTabKey = tabs.find(t => t.key === requested)?.key ?? 'quote';

  const choose = (next: string) => {
    setRequested(next);
    const query = new URLSearchParams(window.location.search);
    if (next === 'quote') query.delete('tab');
    else query.set('tab', next);
    const search = query.toString();
    router.replace(`${window.location.pathname}${search ? `?${search}` : ''}`, { scroll: false });
  };

  /*
   * From lg up the tabs ARE the page header: they render into the topbar
   * beside search, so the quoter starts directly under one 52px bar instead
   * of under a title, a description and a tab strip. A portal, so they stay
   * this Tabs' own triggers. Below lg, or with no topbar, they sit at the top
   * of the page as before.
   */
  const { nav } = useTopbarSlots();
  const wide = useMediaQuery('(min-width: 1024px)');
  const docked = wide && nav !== null;

  const tabList = (
    <TabsList
      aria-label="Quote sections"
      className={cn(docked ? 'h-full gap-5 border-b-0' : 'gap-5')}
    >
      {tabs.map(t => (
        <TabsTrigger
          key={t.key}
          value={t.key}
          className={cn('text-[13px]', docked ? 'h-full' : 'h-9')}
        >
          {t.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );

  return (
    // The page fills <main> and scrolls inside itself (it is a full-screen
    // route in the layout). From lg up the quoter fits one screen: its form
    // and results scroll on their own and the page itself never does; every
    // other tab scrolls as a page. Below md, pb-24 keeps the last line clear
    // of the floating softphone (from md up it sits in the topbar).
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-3 pb-24 pt-2 md:px-4 md:pb-6 lg:overflow-hidden lg:px-3 lg:pb-3 lg:pt-3">
      <Tabs value={tab} onValueChange={choose} className="flex flex-col lg:min-h-0 lg:flex-1">
        {docked ? createPortal(tabList, nav) : tabList}
        <TabsContent value="quote" className={cn('lg:min-h-0 lg:flex-1', docked ? 'mt-0' : 'mt-3')}>
          <QuoteTab />
        </TabsContent>
        <TabsContent value="history" className={SCROLLING_TAB}>
          <QuoteHistory />
        </TabsContent>
        <TabsContent value="conditions" className={SCROLLING_TAB}>
          <ConditionLookup />
        </TabsContent>
        <TabsContent value="drugs" className={SCROLLING_TAB}>
          <DrugLookup />
        </TabsContent>
        <TabsContent value="carriers" className={SCROLLING_TAB}>
          <CarrierCoverage />
        </TabsContent>
        {tabs.some(t => t.key === 'insights') ? (
          <TabsContent value="insights" className={SCROLLING_TAB}>
            <QuoteInsights />
          </TabsContent>
        ) : null}
        {tabs.some(t => t.key === 'settings') ? (
          <TabsContent value="settings" className={SCROLLING_TAB}>
            <QuoteSettings />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

/** A tab that reads as a page: from lg up it scrolls under the tab bar. */
const SCROLLING_TAB =
  'mt-3 lg:-mr-2 lg:mt-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-1 lg:pb-6 lg:pr-2';

function QuoteTab(): JSX.Element {
  const { settings, loading } = useFexSettings();
  if (loading && !settings) {
    return (
      <div
        className="grid h-full gap-3 lg:grid-cols-[minmax(320px,340px)_1fr] xl:grid-cols-[minmax(350px,380px)_1fr]"
        aria-busy="true"
      >
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return (
    <QuoteWorkspace variant="page" source="PAGE" initialDraft={emptyDraft(settings?.agency)} />
  );
}
