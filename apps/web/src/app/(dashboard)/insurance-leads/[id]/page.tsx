'use client';

import { ArrowLeft, Loader2, PhoneCall } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Notice, Panel } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { LeadDetailBody, leadDisplayName } from '@/components/leads/lead-detail-sheet';
import { usePhone } from '@/components/phone';
import { Button } from '@/components/ui/button';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { fetchInsuranceLead } from '@/lib/api/leads';
import { formatPhoneNumber } from '@/lib/utils';

/**
 * One customer, on a page of its own.
 *
 * The same record the CRM grid opens in a sheet -- every field, the tasks, the
 * applications written for them and the calls with their number -- through
 * the one `LeadDetailBody`, so nothing here is a second copy of a field. The
 * Applications page opens a row here, and so does anything that wants a
 * customer to have an address.
 *
 * The server decides who may read it: an agent reaches only the customers
 * assigned to them, and anyone else's reads as not found.
 */
export default function CustomerPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { makeCall } = usePhone();

  const [lead, setLead] = useState<InsuranceLeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="page-canvas">
      <div>
        <Link
          href="/insurance-leads"
          className="inline-flex items-center gap-1.5 t-meta font-medium text-ink-2 hover:text-ink"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
          Back to CRM
        </Link>
      </div>

      {lead && (
        <PageHeader
          description={
            <span>
              <span className="t-section text-ink">{leadDisplayName(lead)}</span>
              {lead.phone ? (
                <span className="ml-2 tabular-nums text-ink-3">
                  {formatPhoneNumber(lead.phone)}
                </span>
              ) : null}
            </span>
          }
          actions={
            lead.phone ? (
              <Button className="gap-1.5" onClick={() => void makeCall(lead.phone)}>
                <PhoneCall aria-hidden className="h-4 w-4" />
                Call
              </Button>
            ) : null
          }
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 t-body text-ink-3">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          Loading customer…
        </div>
      ) : error || !lead ? (
        <Notice tone="error">{error ?? 'This customer could not be found.'}</Notice>
      ) : (
        <Panel className="min-w-0 overflow-hidden">
          <LeadDetailBody lead={lead} onRefresh={() => void load(true)} />
        </Panel>
      )}
    </div>
  );
}
