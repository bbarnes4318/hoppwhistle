'use client';

import { ArrowLeft, Calculator, FileCheck2, FileText, Loader2, PhoneCall } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Notice, Panel } from '@/components/domain';
import {
  applicationFromQuote,
  CustomerApplicationDrawer,
  hasLiveApplication,
  type QuoteForApplication,
} from '@/components/fex/customer/customer-application-drawer';
import { CustomerQuotesPanel } from '@/components/fex/customer/customer-quotes-panel';
import { PageHeader } from '@/components/layout/page-header';
import { CustomerApplicationsPanel } from '@/components/leads/customer-applications-panel';
import { CustomerSnapshot } from '@/components/leads/customer-snapshot';
import { LeadDetailBody, leadDisplayName } from '@/components/leads/lead-detail-sheet';
import { usePhone } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { useQuoteSession } from '@/contexts/quote-session-context';
import { useCustomerQuotes } from '@/hooks/use-customer-quotes';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { fetchInsuranceLead } from '@/lib/api/leads';
import { fexApi } from '@/lib/fex/api';
import { customerFactLine, customerSessionKey } from '@/lib/fex/customer';
import { formatPhoneNumber } from '@/lib/utils';

/**
 * One customer: the agent's workspace for them.
 *
 * The sales work first -- Call, Quote and Write application at the top; a
 * snapshot of who they are and where they stand; what they have been quoted
 * and what was written -- and the full record (every field, tasks, calls and
 * the timeline, through the same `LeadDetailBody` the CRM sheet uses) beside
 * it. Quote opens the customer's own quote workspace
 * (`/insurance-leads/:id/quote`), prefilled from this record, and every quote
 * saved there comes back here.
 *
 * The server decides who may read it: an agent reaches only the customers
 * assigned to them, and anyone else's reads as not found.
 */
export default function CustomerPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();
  const { makeCall } = usePhone();
  const session = useQuoteSession();
  const quotes = useCustomerQuotes(id || null);

  const [lead, setLead] = useState<InsuranceLeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [application, setApplication] = useState<{ quote: QuoteForApplication | null } | null>(
    null
  );
  const [preparing, setPreparing] = useState(false);

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

  useEffect(() => {
    void load();
  }, [load]);

  // Arriving at #quotes or #applications (from the quote workspace): there.
  useEffect(() => {
    if (loading || !lead) return;
    const hash = window.location.hash.slice(1);
    if (hash === 'quotes' || hash === 'applications') {
      requestAnimationFrame(() =>
        document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      );
    }
  }, [loading, lead]);

  const fe = lead?.vertical === 'FE';
  const written = lead ? hasLiveApplication(lead) : false;
  const resumable = Boolean(id && session?.getDraft(customerSessionKey(id)));
  const quoteHref = `/insurance-leads/${encodeURIComponent(id)}/quote`;
  const startQuote = () => router.push(quoteHref);

  /*
   * Write application: from the latest quote the agent chose, when there is
   * one -- loaded in full so the plan's own application fields and the price
   * it was quoted at are used, never today's.
   */
  const writeApplication = async () => {
    if (written) {
      document.getElementById('applications')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const chosen = quotes.quotes.find(q => q.selectedCarrier && !q.applicationId);
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

  return (
    <div className="page-canvas">
      {/* The customer's name is the page's title, in the topbar; the way back,
          their number and who they are sit under it. */}
      <PageHeader
        title={lead ? leadDisplayName(lead) : undefined}
        description={
          <span className="inline-flex min-w-0 items-center gap-2">
            <Link
              href="/insurance-leads"
              className="inline-flex shrink-0 items-center gap-1 font-medium text-ink-2 hover:text-ink"
            >
              <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
              Back to CRM
            </Link>
            {lead ? (
              <>
                <span aria-hidden className="text-ink-3">
                  ·
                </span>
                <span className="truncate tabular-nums">
                  {[
                    lead.phone ? formatPhoneNumber(lead.phone) : null,
                    fe ? customerFactLine(lead) : null,
                  ]
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
              {fe ? (
                <Button className="gap-1.5" onClick={startQuote}>
                  <Calculator aria-hidden className="h-4 w-4" />
                  {resumable ? 'Resume quote' : 'Quote'}
                </Button>
              ) : null}
              {fe ? (
                <Button
                  variant="outline"
                  className="gap-1.5"
                  disabled={preparing}
                  onClick={() => void writeApplication()}
                >
                  {preparing ? (
                    <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                  ) : written ? (
                    <FileText aria-hidden className="h-4 w-4" />
                  ) : (
                    <FileCheck2 aria-hidden className="h-4 w-4" />
                  )}
                  {written ? 'View application' : 'Write application'}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 t-body text-ink-3">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          Loading customer…
        </div>
      ) : error || !lead ? (
        <Notice tone="error">{error ?? 'This customer could not be found.'}</Notice>
      ) : (
        <div className="space-y-4">
          <CustomerSnapshot lead={lead} />
          {/* Sales work on the left, the record on the right; one column
              below 1280px, sales work first. */}
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(400px,460px)]">
            <div className="min-w-0 space-y-4">
              {fe ? (
                <CustomerQuotesPanel
                  lead={lead}
                  quotes={quotes}
                  resumable={resumable}
                  onNewQuote={startQuote}
                  onRequote={quoteId =>
                    router.push(`${quoteHref}?requote=${encodeURIComponent(quoteId)}`)
                  }
                  onWriteApplication={quote => setApplication({ quote })}
                  onViewApplication={() =>
                    document
                      .getElementById('applications')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                />
              ) : null}
              <CustomerApplicationsPanel
                lead={lead}
                quotes={quotes.quotes}
                onWriteApplication={fe && !written ? () => void writeApplication() : undefined}
              />
            </div>
            <Panel className="min-w-0 overflow-hidden" aria-label="Customer record">
              <div className="border-b border-rule px-4 py-3">
                <h2 className="text-[15px] font-semibold text-ink">Customer record</h2>
              </div>
              <LeadDetailBody
                lead={lead}
                onRefresh={() => void load(true)}
                hideApplications
                hideMarkApplication={fe}
              />
            </Panel>
          </div>
        </div>
      )}

      {lead && application ? (
        <CustomerApplicationDrawer
          lead={lead}
          quote={application.quote}
          open
          onOpenChange={open => !open && setApplication(null)}
          onRecorded={() => {
            void load(true);
            quotes.reload();
          }}
        />
      ) : null}
    </div>
  );
}
