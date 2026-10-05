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
    <div className="flex min-h-full flex-col gap-4 p-4 md:p-6">
      <PageHeader description="Underwrite and price final expense across every carrier, with the reason for every result." />
      <Tabs value={tab} onValueChange={choose}>
        <TabsList aria-label="Quote sections">
          {tabs.map(t => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="quote">
          <QuoteTab />
        </TabsContent>
        <TabsContent value="history">
          <QuoteHistory />
        </TabsContent>
        <TabsContent value="conditions">
          <ConditionLookup />
        </TabsContent>
        <TabsContent value="drugs">
          <DrugLookup />
        </TabsContent>
        <TabsContent value="carriers">
          <CarrierCoverage />
        </TabsContent>
        {tabs.some(t => t.key === 'insights') ? (
          <TabsContent value="insights">
            <QuoteInsights />
          </TabsContent>
        ) : null}
        {tabs.some(t => t.key === 'settings') ? (
          <TabsContent value="settings">
            <QuoteSettings />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

function QuoteTab(): JSX.Element {
  const { settings, loading } = useFexSettings();
  if (loading && !settings) {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(380px,440px)_1fr]" aria-busy="true">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return (
    <QuoteWorkspace variant="page" source="PAGE" initialDraft={emptyDraft(settings?.agency)} />
  );
}
