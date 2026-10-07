'use client';

/**
 * The quoter, bound to one CRM customer.
 *
 * The same `QuoteWorkspace` as the Quote page -- not a copy -- given the
 * customer's id, a draft built from their record, and somewhere to keep its
 * work. What binding adds:
 *
 *   - identity: the customer's name is the page title and their facts sit
 *     under it, so there is never a doubt who is being quoted
 *   - prefill: `insuranceLeadToFexDraft`, once; what the record lacks is named
 *     ("Ask: date of birth, tobacco") rather than guessed
 *   - persistence: every saved quote is filed on the customer by the server
 *     (`source: CRM`), with no "attach to customer" step to forget
 *   - continuity: the draft and the selected plan live in the QuoteSession
 *     under the customer, so stepping back to the record and returning, or
 *     going on to the application, loses nothing
 *   - enrichment: what the agent learned that the record is missing (a date
 *     of birth, tobacco) is offered back to it -- only into blank fields, only
 *     when the agent says so
 *   - the application, prefilled from the chosen plan, without leaving
 *
 * The customer id comes from the route path, not a query string, and the
 * server re-checks it on every save.
 */

import { ArrowLeft, Calculator, Check, History, Loader2, PhoneCall, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Notice } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { usePhone } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/use-toast';
import { useQuoteSession } from '@/contexts/quote-session-context';
import { useCustomerQuotes } from '@/hooks/use-customer-quotes';
import { useFexSettings } from '@/hooks/use-fex-quote';
import {
  fetchInsuranceLead,
  patchInsuranceLeadFields,
  type InsuranceLeadDetail,
} from '@/lib/api/leads';
import { fexApi, QUOTE_SOURCE, type FexQuoteDetail } from '@/lib/fex/api';
import {
  customerFactLine,
  customerName,
  customerSessionKey,
  customerUpdatesFromDraft,
  fexApplicantToDraft,
  insuranceLeadToFexDraft,
  type CustomerUpdate,
} from '@/lib/fex/customer';
import type { QuoteDraft } from '@/lib/fex/draft';
import { cn, formatPhoneNumber } from '@/lib/utils';

import { QuoteWorkspace } from '../quote-workspace';

import {
  applicationFromSelection,
  CustomerApplicationDrawer,
  hasLiveApplication,
} from './customer-application-drawer';

const ASK_LABEL: Record<string, string> = {
  state: 'state',
  sex: 'sex',
  dob: 'date of birth',
  tobacco: 'tobacco',
  face: 'coverage',
};

/** What a draft still needs from the agent, in the order it is asked. */
function stillToAsk(draft: QuoteDraft): string[] {
  const ask: string[] = [];
  if (!draft.state) ask.push(ASK_LABEL.state);
  if (!draft.sex) ask.push(ASK_LABEL.sex);
  const age = draft.ageOrDob.mode === 'age' ? draft.ageOrDob.age : draft.ageOrDob.dob;
  if (!age) ask.push(ASK_LABEL.dob);
  if (draft.tobacco === null) ask.push(ASK_LABEL.tobacco);
  if (draft.coverage.mode === 'face' ? !draft.coverage.face : !draft.coverage.budget) {
    ask.push(ASK_LABEL.face);
  }
  return ask;
}

export function CustomerQuoteWorkspace({
  leadId,
  requoteId,
}: {
  leadId: string;
  /** A saved quote whose answers this quote starts from (Requote). */
  requoteId?: string | null;
}): JSX.Element {
  const router = useRouter();
  const session = useQuoteSession();
  const { makeCall } = usePhone();
  const { settings, loading: settingsLoading } = useFexSettings();
  const quotes = useCustomerQuotes(leadId);
  const key = customerSessionKey(leadId);

  const [lead, setLead] = React.useState<InsuranceLeadDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [requoted, setRequoted] = React.useState<FexQuoteDetail | null>(null);
  const [seed, setSeed] = React.useState<{ draft: QuoteDraft; at: number } | null>(null);
  const [applicationOpen, setApplicationOpen] = React.useState(false);

  const loadLead = React.useCallback(async () => {
    try {
      setLead(await fetchInsuranceLead(leadId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This customer could not be found.');
    }
  }, [leadId]);

  React.useEffect(() => {
    void loadLead();
  }, [loadLead]);

  /*
   * The draft to start from, decided once per visit: a Requote's saved
   * answers; else the work left in the session for this customer; else the
   * customer's record.
   */
  const seeding = React.useRef(false);
  React.useEffect(() => {
    if (!lead || seed || settingsLoading || seeding.current) return;
    seeding.current = true;
    const defaults = settings?.agency;
    if (requoteId) {
      void fexApi.read(requoteId).then(result => {
        if (!result.ok || result.data.insuranceLeadId !== lead.id) {
          toast({
            title: 'That quote could not be reopened',
            description: result.ok ? 'It belongs to another customer.' : result.message,
            variant: 'destructive',
          });
          setSeed({ draft: insuranceLeadToFexDraft(lead, defaults).draft, at: Date.now() });
        } else {
          const draft = fexApplicantToDraft(result.data.applicant, defaults);
          session?.setDraft(key, draft);
          session?.setSelection(key, null);
          setRequoted(result.data);
          setSeed({ draft, at: Date.now() });
        }
        // Seeded: a reload resumes the work rather than re-seeding over it.
        router.replace(`/insurance-leads/${encodeURIComponent(lead.id)}/quote`, { scroll: false });
      });
      return;
    }
    const kept = session?.getDraft(key);
    setSeed({ draft: kept ?? insuranceLeadToFexDraft(lead, defaults).draft, at: Date.now() });
  }, [lead, seed, settings, settingsLoading, requoteId, session, key, router]);

  // What the record is missing, recomputed as the agent types -- but not on
  // every keystroke: the offer settles first.
  const [draftNow, setDraftNow] = React.useState<QuoteDraft | null>(null);
  const pending = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDraftChange = React.useCallback((draft: QuoteDraft) => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => setDraftNow(draft), 400);
  }, []);
  React.useEffect(() => () => void (pending.current && clearTimeout(pending.current)), []);

  const update: CustomerUpdate | null =
    lead && draftNow ? customerUpdatesFromDraft(lead, draftNow) : null;
  const [updating, setUpdating] = React.useState(false);
  const saveToRecord = async () => {
    if (!lead || !update?.labels.length) return;
    setUpdating(true);
    try {
      await patchInsuranceLeadFields(lead.id, update.patch);
      toast({
        title: `${customerName(lead)}'s record updated`,
        description: `Added ${update.labels.join(', ').toLowerCase()}.`,
      });
      await loadLead();
    } catch (err) {
      toast({
        title: 'The customer record was not updated',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setUpdating(false);
    }
  };

  const selection = session?.getSelection(key) ?? null;
  const name = lead ? customerName(lead) : '';
  const first = lead?.firstName?.trim() || name;
  const written = lead ? hasLiveApplication(lead) : false;
  const customerHref = `/insurance-leads/${encodeURIComponent(leadId)}`;
  const ask = draftNow ? stillToAsk(draftNow) : seed ? stillToAsk(seed.draft) : [];

  const header = (
    <PageHeader
      title={lead ? name : undefined}
      description={
        <span className="inline-flex min-w-0 items-center gap-2">
          <Link
            href={customerHref}
            className="inline-flex shrink-0 items-center gap-1 font-medium text-ink-2 hover:text-ink"
          >
            <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
            Customer record
          </Link>
          {lead ? (
            <>
              <span aria-hidden className="text-ink-3">
                ·
              </span>
              <span className="truncate tabular-nums">
                {[customerFactLine(lead), lead.phone ? formatPhoneNumber(lead.phone) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </>
          ) : null}
        </span>
      }
      actions={
        lead ? (
          <>
            {lead.phone ? (
              <Button
                variant="outline"
                className="gap-1.5"
                disabled={lead.doNotCall}
                title={lead.doNotCall ? 'This customer is on Do Not Call' : undefined}
                onClick={() => void makeCall(lead.phone)}
              >
                <PhoneCall aria-hidden className="h-4 w-4" />
                Call
              </Button>
            ) : null}
            <Button variant="outline" className="gap-1.5" asChild>
              <Link href={`${customerHref}#quotes`}>
                <History aria-hidden className="h-4 w-4" />
                Quote history
                {quotes.total ? (
                  <span className="rounded-full bg-sunken px-1.5 text-[11px] font-semibold tabular-nums text-ink-2">
                    {quotes.total}
                  </span>
                ) : null}
              </Link>
            </Button>
          </>
        ) : null
      }
    />
  );

  if (error) {
    return (
      <div className="page-canvas">
        {header}
        <Notice tone="error" title="This customer cannot be quoted here">
          {error}
        </Notice>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-3 pb-24 pt-2 md:px-4 md:pb-6 lg:overflow-hidden lg:px-3 lg:pb-3 lg:pt-3">
      {header}

      {/* Whose quote this is, and where it goes: one quiet line over the
          quoter, never in its way. */}
      <div
        className="mb-3 flex min-h-[40px] w-full max-w-[1600px] shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-card border border-rule bg-surface px-3 py-1.5 shadow-[inset_3px_0_0_var(--brand-strong)]"
        data-testid="customer-quote-context"
      >
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <UserCheck className="h-4 w-4 text-brand-ink" aria-hidden />
          {lead ? (
            <>
              Quoting <span className="font-semibold text-ink">{name}</span>
              <span className="text-ink-3">
                · every saved quote is filed on {first}&apos;s record
              </span>
            </>
          ) : (
            <Skeleton className="h-3.5 w-56" />
          )}
        </span>
        {requoted ? (
          <span className="inline-flex items-center gap-1 rounded-[5px] bg-brand-tint px-1.5 py-0.5 text-[11.5px] font-medium text-brand-ink">
            <Calculator className="h-3 w-3" aria-hidden />
            Requote of{' '}
            {new Date(requoted.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}{' '}
            at today&apos;s rates — the original is unchanged
          </span>
        ) : null}
        {ask.length ? (
          <span className="text-[12.5px] text-ringing-ink">
            <span className="font-semibold">Ask:</span> {ask.join(', ')}
            {ask.includes('tobacco') && ask.length === 1 ? (
              <span className="text-ink-3"> · priced as non-tobacco until answered</span>
            ) : null}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {update?.labels.length ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={updating}
              onClick={() => void saveToRecord()}
            >
              {updating ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
              )}
              Add {update.labels.join(', ').toLowerCase()} to record
            </Button>
          ) : null}
        </span>
      </div>

      <div className={cn('w-full max-w-[1600px] lg:min-h-0 lg:flex-1')}>
        {lead && seed ? (
          <QuoteWorkspace
            key={`${leadId}:${seed.at}`}
            variant="page"
            source={QUOTE_SOURCE.CRM}
            sessionKey={key}
            insuranceLeadId={lead.id}
            prospectName={name}
            initialDraft={seed.draft}
            resetDraft={() => insuranceLeadToFexDraft(lead, settings?.agency).draft}
            onDraftChange={onDraftChange}
            onSaved={() => quotes.reload()}
            savedWhere={`It is on ${first}'s record.`}
            startLabel={written ? 'View application' : 'Write application'}
            onStartApplication={() => {
              if (written) router.push(`${customerHref}#applications`);
              else setApplicationOpen(true);
            }}
          />
        ) : (
          <div
            className="grid h-full gap-3 lg:grid-cols-[minmax(330px,352px)_1fr] xl:grid-cols-[minmax(368px,392px)_1fr]"
            aria-busy="true"
            aria-label="Loading the customer"
          >
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
      </div>

      {lead ? (
        <CustomerApplicationDrawer
          lead={lead}
          quote={selection ? applicationFromSelection(selection) : null}
          open={applicationOpen}
          onOpenChange={setApplicationOpen}
          onRecorded={() => {
            quotes.reload();
            router.push(`${customerHref}#applications`);
          }}
        />
      ) : null}
    </div>
  );
}
