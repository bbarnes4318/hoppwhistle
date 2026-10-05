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

import { CarrierCoverage } from '@/components/fex/carriers/carrier-coverage';
import { QuoteHistory } from '@/components/fex/history/quote-history';
import { QuoteInsights } from '@/components/fex/insights/quote-insights';
import { ConditionLookup } from '@/components/fex/lookup/condition-lookup';
import { DrugLookup } from '@/components/fex/lookup/drug-lookup';
import { QuoteWorkspace } from '@/components/fex/quote-workspace';
import { QuoteSettings } from '@/components/fex/settings/quote-settings';
import { PageHeader } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import { useFexSettings } from '@/hooks/use-fex-quote';
import { emptyDraft } from '@/lib/fex/draft';
import { quoteTabsFor, type QuoteTabKey } from '@/lib/fex/tabs';

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

  return (
    // The page fills <main> and scrolls inside itself (it is a full-screen
    // route in the layout). From lg up the quoter fits one screen: its form
    // and results scroll on their own; every other tab scrolls as a page.
    // pb-24 keeps the last line clear of the floating softphone.
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-4 pb-24 pt-3 md:px-6 lg:overflow-hidden lg:pb-3">
      <PageHeader description="Underwrite and price final expense across every carrier, with the reason for every result." />
      <Tabs value={tab} onValueChange={choose} className="flex flex-col lg:min-h-0 lg:flex-1">
        <TabsList aria-label="Quote sections">
          {tabs.map(t => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="quote" className="mt-3 lg:min-h-0 lg:flex-1">
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
const SCROLLING_TAB = 'mt-3 lg:-mr-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pb-24 lg:pr-2';

function QuoteTab(): JSX.Element {
  const { settings, loading } = useFexSettings();
  if (loading && !settings) {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(340px,380px)_1fr]" aria-busy="true">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return (
    <QuoteWorkspace variant="page" source="PAGE" initialDraft={emptyDraft(settings?.agency)} />
  );
}
