'use client';

import { Loader2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Notice } from '@/components/domain';
import {
  applicationFromQuote,
  CustomerApplicationDrawer,
  hasLiveApplication,
  type QuoteForApplication,
} from '@/components/fex/customer/customer-application-drawer';
import {
  CustomerQuotesPanel,
  featuredQuote,
} from '@/components/fex/customer/customer-quotes-panel';
import { CustomerActivityTimeline } from '@/components/leads/customer/customer-activity';
import { CustomerApplicationCard } from '@/components/leads/customer/customer-application-card';
import { CustomerCallsTable } from '@/components/leads/customer/customer-calls';
import { CustomerDetails } from '@/components/leads/customer/customer-details';
import { CustomerEditDrawer } from '@/components/leads/customer/customer-edit-drawer';
import { CustomerFollowUp } from '@/components/leads/customer/customer-follow-up';
import { CustomerHeader } from '@/components/leads/customer/customer-header';
import { CustomerRail } from '@/components/leads/customer/customer-rail';
import { assigneeLabel, openTasks } from '@/components/leads/customer/format';
import type { LeadSectionId } from '@/components/leads/customer/lead-fields';
import { deriveNextAction } from '@/components/leads/customer/next-action';
import { useAssignableUsers, useLeadTasks } from '@/components/leads/customer/use-lead-record';
import { Sheet } from '@/components/leads/customer/workspace';
import { leadDisplayName } from '@/components/leads/lead-detail-sheet';
import { usePhone } from '@/components/phone';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/use-toast';
import { useQuoteSession } from '@/contexts/quote-session-context';
import { useAuth } from '@/hooks/use-auth';
import { useCustomerQuotes } from '@/hooks/use-customer-quotes';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { fetchInsuranceLead } from '@/lib/api/leads';
import { fexApi, type FexQuoteSummary } from '@/lib/fex/api';
import { customerSessionKey } from '@/lib/fex/customer';

/**
 * One customer: the agent's workspace for them.
 *
 * Who they are and the next moves (Call, Quote, Write application) at the
 * top, the facts the quoter prices on beside where the work stands, then the
 * workspace itself in tabs:
 *
 *   Overview       the selected plan and the other quotes, the application,
 *                  the customer read-only, open tasks and recent calls
 *   Details        the complete record, grouped, each group editable
 *   Calls          the call history, full width
 *   Activity       the timeline, by day, filterable
 *   Notes & tasks  what is next and what was said
 *
 * Editing is a drawer over the page (`CustomerEditDrawer`), never a page of
 * open inputs. The tab is kept in the URL hash, so a reload or a link lands
 * on it; `#quotes` and `#applications` (from the quote workspace) land on
 * Overview at that panel.
 *
 * The server decides who may read it: an agent reaches only the customers
 * assigned to them, and anyone else's reads as not found.
 */

type Tab = 'overview' | 'details' | 'calls' | 'activity' | 'tasks';
const TABS: Tab[] = ['overview', 'details', 'calls', 'activity', 'tasks'];
const OVERVIEW_ANCHORS = new Set(['quotes', 'applications']);

function tabFromHash(): Tab {
  if (typeof window === 'undefined') return 'overview';
  const hash = window.location.hash.slice(1);
  return (TABS as string[]).includes(hash) ? (hash as Tab) : 'overview';
}

export default function CustomerPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();
  const { makeCall } = usePhone();
  const { user } = useAuth();
  const session = useQuoteSession();
  const quotes = useCustomerQuotes(id || null);
  const { canAssign, users } = useAssignableUsers();

  const [lead, setLead] = useState<InsuranceLeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [application, setApplication] = useState<{ quote: QuoteForApplication | null } | null>(
    null
  );
  const [editing, setEditing] = useState<{ focus: LeadSectionId | null } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [addingTask, setAddingTask] = useState(false);

  const load = useCallback(
    async (quiet = false) => {
      if (!id) return;
      if (!quiet) setLoading(true);
      try {
        setLead(await fetchInsuranceLead(id));
        setError(null);
      } catch (err) {
        setLead(null);
        setError(err instanceof Error ? err.message : 'Could not load this customer.');
      } finally {
        setLoading(false);
      }
    },
    [id]
  );
  const refresh = useCallback(() => void load(true), [load]);
  const tasks = useLeadTasks(id, refresh);

  useEffect(() => {
    void load();
  }, [load]);

  // The tab follows the hash: on arrival, and on Back/Forward.
  useEffect(() => {
    const sync = () => setTab(tabFromHash());
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  // Arriving at #quotes or #applications (from the quote workspace): there.
  useEffect(() => {
    if (loading || !lead) return;
    const hash = window.location.hash.slice(1);
    if (OVERVIEW_ANCHORS.has(hash)) {
      requestAnimationFrame(() =>
        document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      );
    }
  }, [loading, lead]);

  const changeTab = (next: string) => {
    const value = next as Tab;
    setTab(value);
    const url = `${window.location.pathname}${window.location.search}${
      value === 'overview' ? '' : `#${value}`
    }`;
    window.history.replaceState(window.history.state, '', url);
  };

  const showOnOverview = (anchor: 'quotes' | 'applications') => {
    changeTab('overview');
    requestAnimationFrame(() =>
      document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    );
  };

  const fe = lead?.vertical === 'FE';
  const written = lead ? hasLiveApplication(lead) : false;
  const resumable = Boolean(id && session?.getDraft(customerSessionKey(id)));
  const quoteHref = `/insurance-leads/${encodeURIComponent(id)}/quote`;
  const startQuote = () => router.push(quoteHref);

  /*
   * Write an application from a saved quote, loaded in full so the plan's own
   * application fields and the price it was quoted at are used, never today's.
   */
  const writeFromQuote = async (chosen: FexQuoteSummary | null) => {
    if (!chosen) {
      setApplication({ quote: null });
      return;
    }
    setPreparing(true);
    const detail = await fexApi.read(chosen.id);
    setPreparing(false);
    if (!detail.ok) {
      toast({
        title: 'The quote could not be loaded',
        description: `${detail.message} You can still write the application by hand.`,
        variant: 'destructive',
      });
    }
    setApplication({ quote: detail.ok ? applicationFromQuote(detail.data) : null });
  };

  /** The header's Write application: from the plan they chose, when there is one. */
  const writeApplication = () => {
    if (written) {
      showOnOverview('applications');
      return;
    }
    const chosen = fe && lead ? featuredQuote(quotes.quotes, lead) : null;
    void writeFromQuote(chosen && !chosen.applicationId ? chosen : null);
  };

  if (loading) {
    return (
      <div className="page-canvas">
        <div className="flex items-center justify-center gap-2 py-16 t-body text-ink-3">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          Loading customer…
        </div>
      </div>
    );
  }
  if (error || !lead) {
    return (
      <div className="page-canvas">
        <Notice tone="error">{error ?? 'This customer could not be found.'}</Notice>
      </div>
    );
  }

  const name = leadDisplayName(lead);
  const assignee = assigneeLabel(lead, user?.id, users);
  const callCount = lead.calls?.length ?? 0;
  const activityCount = lead.activities?.length ?? 0;
  const openCount = openTasks(lead).open.length;
  const featured = fe ? featuredQuote(quotes.quotes, lead) : null;
  const edit = (focus?: LeadSectionId) => setEditing({ focus: focus ?? null });
  /*
   * One filled button at a time. When the Overview already holds the next
   * step -- Write application on the selected plan, Create quote on an empty
   * list -- the header's actions stay outlined; otherwise Quote (or, outside
   * final expense, Write application) is the one to press.
   */
  const bodyLeads =
    fe &&
    !quotes.loading &&
    (quotes.quotes.length === 0 || Boolean(featured && !featured.applicationId && !written));
  const primary: 'quote' | 'application' | null =
    tab === 'overview' && (bodyLeads || (fe && quotes.loading))
      ? null
      : fe
        ? 'quote'
        : written
          ? null
          : 'application';

  const next = deriveNextAction(lead, {
    featured,
    written,
    neverQuoted: fe && !quotes.loading && !quotes.error && quotes.quotes.length === 0,
  });
  const scheduleFollowUp = () => edit('crm');
  const addTask = () => {
    changeTab('tasks');
    setAddingTask(true);
  };

  return (
    <div className="page-canvas">
      <Sheet>
        <CustomerHeader
          lead={lead}
          name={name}
          assignee={assignee}
          next={next}
          onCall={() => void makeCall(lead.phone)}
          onQuote={fe ? startQuote : undefined}
          resumable={resumable}
          onApplication={writeApplication}
          written={written}
          preparing={preparing}
          primary={primary}
          onScheduleFollowUp={scheduleFollowUp}
          onCompleteTask={taskId => void tasks.complete(taskId)}
          completingTask={Boolean(next.task && tasks.pendingId === next.task.id)}
          hideNextStep={
            tab === 'overview' && (next.kind === 'application' || next.kind === 'quote')
          }
        />

        <Tabs value={tab} onValueChange={changeTab} className="min-w-0">
          <TabsList
            aria-label={`${name}'s workspace`}
            className="gap-7 border-t border-rule bg-paper px-7"
          >
            <TabsTrigger value="overview" className="h-11">
              Overview
            </TabsTrigger>
            <TabsTrigger value="details" className="h-11">
              Details
            </TabsTrigger>
            <TabsTrigger value="calls" className="h-11">
              Calls <Count n={callCount} />
            </TabsTrigger>
            <TabsTrigger value="activity" className="h-11">
              Activity <Count n={activityCount} />
            </TabsTrigger>
            <TabsTrigger value="tasks" className="h-11">
              Notes &amp; tasks <Count n={openCount} tone={openCount ? 'brand' : 'muted'} />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0 focus-visible:ring-inset">
            <div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_minmax(320px,368px)]">
              <div className="min-w-0 pb-2">
                {fe ? (
                  <CustomerQuotesPanel
                    lead={lead}
                    quotes={quotes}
                    resumable={resumable}
                    preparing={preparing}
                    onNewQuote={startQuote}
                    onRequote={quoteId =>
                      router.push(`${quoteHref}?requote=${encodeURIComponent(quoteId)}`)
                    }
                    onWriteFromQuote={quote => void writeFromQuote(quote)}
                    onWriteApplication={quote => setApplication({ quote })}
                    onViewApplication={() => showOnOverview('applications')}
                  />
                ) : null}
                <CustomerApplicationCard
                  lead={lead}
                  quotes={quotes.quotes}
                  divided={fe}
                  // The selected plan already offers it; offer it here only when nothing does.
                  onWriteApplication={
                    written || (featured && !featured.applicationId)
                      ? undefined
                      : () => writeApplication()
                  }
                  writeFrom={
                    featured && !written
                      ? [featured.selectedCarrier, featured.selectedProduct]
                          .filter(Boolean)
                          .join(' — ')
                      : null
                  }
                />
              </div>
              <CustomerRail
                className="border-t border-rule xl:border-l xl:border-t-0"
                lead={lead}
                assignee={assignee}
                tasks={tasks}
                onOpenTasks={() => changeTab('tasks')}
                onAddTask={addTask}
                onOpenCalls={() => changeTab('calls')}
                onEdit={edit}
              />
            </div>
          </TabsContent>

          <TabsContent value="details" className="mt-0 focus-visible:ring-inset">
            <CustomerDetails lead={lead} assignee={assignee} canAssign={canAssign} onEdit={edit} />
          </TabsContent>

          <TabsContent value="calls" className="mt-0 focus-visible:ring-inset">
            <CustomerCallsTable calls={lead.calls ?? []} />
          </TabsContent>

          <TabsContent value="activity" className="mt-0 focus-visible:ring-inset">
            <CustomerActivityTimeline activities={lead.activities ?? []} />
          </TabsContent>

          <TabsContent value="tasks" className="mt-0 focus-visible:ring-inset">
            <CustomerFollowUp
              lead={lead}
              next={next}
              tasks={tasks}
              addingTask={addingTask}
              onAddingTask={setAddingTask}
              onScheduleFollowUp={scheduleFollowUp}
              onSaved={refresh}
            />
          </TabsContent>
        </Tabs>
      </Sheet>

      <CustomerEditDrawer
        lead={lead}
        open={editing !== null}
        focus={editing?.focus}
        onOpenChange={open => !open && setEditing(null)}
        onSaved={refresh}
      />

      {application ? (
        <CustomerApplicationDrawer
          lead={lead}
          quote={application.quote}
          open
          onOpenChange={open => !open && setApplication(null)}
          onRecorded={() => {
            refresh();
            quotes.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function Count({ n, tone = 'muted' }: { n: number; tone?: 'muted' | 'brand' }) {
  return (
    <span
      className={
        tone === 'brand'
          ? 'text-[12.5px] font-semibold tabular-nums text-brand-ink'
          : 'text-[12.5px] font-medium tabular-nums text-ink-3'
      }
    >
      {n}
    </span>
  );
}
