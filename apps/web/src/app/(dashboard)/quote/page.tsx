'use client';

/**
 * Quote: underwrite and price final expense across every carrier.
 *
 * Every agent's and every agency's -- standard, not an upgrade. Four sections
 * for everyone -- the quoter, saved quotes, Underwriting (the condition and
 * drug lookups) and the carrier data -- and two quieter ones for an agency's
 * principal and NetEnroll staff: how the agency quotes, and its quoter
 * settings. The tab is in the URL (`?tab=`), so a reload or a shared link
 * opens the same one; an unknown tab, or one this person may not open, is the
 * quoter.
 *
 * The engine runs on the server. Nothing this page loads carries a rate table,
 * a rule record or a prescription list.
 */

import { BarChart3 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { createPortal } from 'react-dom';

import { CarrierCoverage } from '@/components/fex/carriers/carrier-coverage';
import { QuoteHistory } from '@/components/fex/history/quote-history';
import { QuoteInsights } from '@/components/fex/insights/quote-insights';
import { ConditionLookup } from '@/components/fex/lookup/condition-lookup';
import { DrugLookup } from '@/components/fex/lookup/drug-lookup';
import { ChoiceGroup } from '@/components/fex/parts';
import { QuoteWorkspace } from '@/components/fex/quote-workspace';
import { QuoteSettings } from '@/components/fex/settings/quote-settings';
import { useMediaQuery, useTopbarSlots } from '@/components/layout/topbar-slots';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import { useFexSettings } from '@/hooks/use-fex-quote';
import { emptyDraft } from '@/lib/fex/draft';
import { quoteSectionsFor, quoteTabsFor, sectionOf, type QuoteTabKey } from '@/lib/fex/tabs';
import { cn } from '@/lib/utils';

export default function QuotePage(): JSX.Element {
  const router = useRouter();
  const { hasFullAccess, isPlatformAdmin } = useAuth();
  const principal = hasFullAccess || isPlatformAdmin;
  const tabs = quoteTabsFor(principal);
  const sections = quoteSectionsFor(principal);

  const [requested, setRequested] = React.useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tab')
  );
  const tab: QuoteTabKey = tabs.find(t => t.key === requested)?.key ?? 'quote';
  // Underwriting opens on the lookup last used here.
  const lastLookup = React.useRef<'conditions' | 'drugs'>(tab === 'drugs' ? 'drugs' : 'conditions');
  if (tab === 'conditions' || tab === 'drugs') lastLookup.current = tab;

  const choose = (next: string) => {
    setRequested(next);
    const query = new URLSearchParams(window.location.search);
    if (next === 'quote') query.delete('tab');
    else query.set('tab', next);
    const search = query.toString();
    router.replace(`${window.location.pathname}${search ? `?${search}` : ''}`, { scroll: false });
  };
  const chooseSection = (key: string) => choose(key === 'underwriting' ? lastLookup.current : key);

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

  /*
   * Four workspace sections at full weight; the principal's Insights after a
   * hairline, smaller and muted, so nothing in the bar competes with Quote.
   */
  // Quote settings live in the account menu, not the bar; its tab is still
  // here (and still the principal's only) for that link and old bookmarks.
  const barSections = sections.filter(s => s.key !== 'settings');
  const tabList = (
    <TabsList
      aria-label="Quote sections"
      // Docked in the topbar the list is exactly the bar's height: no
      // overflow in either direction, so no scrollbar (or its arrow handles)
      // is ever drawn beside the tabs.
      className={cn(
        docked ? 'h-full gap-6 overflow-visible border-b-0' : 'gap-6 overflow-y-hidden'
      )}
    >
      {barSections.map((s, i) => {
        const Icon = s.key === 'insights' ? BarChart3 : null;
        return (
          <React.Fragment key={s.key}>
            {s.secondary && !barSections[i - 1]?.secondary ? (
              <span aria-hidden className="h-4 w-px shrink-0 self-center bg-rule" />
            ) : null}
            <TabsTrigger
              value={s.key}
              className={cn(
                docked ? 'mb-0 h-full' : 'h-10',
                s.secondary
                  ? 'gap-1.5 text-[12.5px] text-ink-3 data-[state=active]:text-ink'
                  : 'text-[13.5px]'
              )}
            >
              {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
              {s.label}
            </TabsTrigger>
          </React.Fragment>
        );
      })}
    </TabsList>
  );

  return (
    // The page fills <main> and scrolls inside itself (it is a full-screen
    // route in the layout). From lg up the quoter fits one screen: its form
    // and results scroll on their own and the page itself never does; every
    // other tab scrolls as a page. Below md, pb-24 keeps the last line clear
    // of the floating softphone (from md up it sits in the topbar).
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-3 pb-24 pt-2 md:px-4 md:pb-6 lg:overflow-hidden lg:px-3 lg:pb-3 lg:pt-3">
      <Tabs
        value={sectionOf(tab)}
        onValueChange={chooseSection}
        className="flex flex-col lg:min-h-0 lg:flex-1"
      >
        {docked ? createPortal(tabList, nav) : tabList}
        {/* The quoter stops growing at 1600px: past that a row only gains
            empty space between the plan and its price. */}
        <TabsContent
          value="quote"
          className={cn('w-full max-w-[1600px] lg:min-h-0 lg:flex-1', docked ? 'mt-0' : 'mt-3')}
        >
          <QuoteTab onOpenTab={choose} />
        </TabsContent>
        <TabsContent value="history" className={SCROLLING_TAB}>
          <QuoteHistory />
        </TabsContent>
        <TabsContent value="underwriting" className={SCROLLING_TAB}>
          <UnderwritingTab lookup={tab === 'drugs' ? 'drugs' : 'conditions'} onChoose={choose} />
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

/** Underwriting: the condition and drug lookups, one switch between them. */
function UnderwritingTab({
  lookup,
  onChoose,
}: {
  lookup: 'conditions' | 'drugs';
  onChoose: (key: 'conditions' | 'drugs') => void;
}): JSX.Element {
  return (
    <div>
      <ChoiceGroup
        label="Underwriting lookup"
        options={[
          { value: 'conditions' as const, label: 'Condition lookup' },
          { value: 'drugs' as const, label: 'Drug lookup' },
        ]}
        value={lookup}
        onChange={onChoose}
        className="mb-4 h-9 w-full max-w-[320px]"
      />
      {lookup === 'drugs' ? <DrugLookup /> : <ConditionLookup />}
    </div>
  );
}

function QuoteTab({ onOpenTab }: { onOpenTab: (tab: QuoteTabKey) => void }): JSX.Element {
  const { settings, loading } = useFexSettings();
  if (loading && !settings) {
    return (
      <div
        className="grid h-full gap-3 lg:grid-cols-[minmax(392px,416px)_1fr] xl:grid-cols-[452px_1fr]"
        aria-busy="true"
      >
        <Skeleton className="h-[560px] w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return (
    <QuoteWorkspace
      variant="page"
      source="PAGE"
      initialDraft={emptyDraft(settings?.agency)}
      onOpenTab={onOpenTab}
    />
  );
}
