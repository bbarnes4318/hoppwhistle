'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Notice } from '@/components/domain';
import { useAuth } from '@/hooks/use-auth';
import { useWhiteLabelView } from '@/hooks/use-white-label-view';
import { apiClient, payload, type Envelope } from '@/lib/api';

/**
 * Where the campaign's money sits beside the agency's own bill.
 *
 * Two separate charges exist and this page sets only one of them:
 *
 *   - the campaign's billing model: what this agency charges its BUYERS and
 *     pays its PUBLISHERS, per billable call or per submitted application;
 *   - the platform's per-application billing of the AGENCY itself, switched on
 *     per agency by platform staff (`AgencyBillingProfile.billingEnrolledAt`)
 *     and read here off `/api/v1/delivery/mandate`.
 *
 * They bill different parties, so neither double-charges the other; this says
 * which one is in force and where the second is set, so nobody goes looking
 * for it on the campaign.
 */
export function CampaignBillingNotice({
  billingModel,
}: {
  billingModel: 'PER_CALL' | 'PER_APPLICATION';
}): JSX.Element {
  const { isChild } = useAuth();
  const whiteLabel = useWhiteLabelView();
  const enrolled = usePlatformEnrolment(!isChild);
  const planHref = whiteLabel ? '/settings?tab=plan' : '/rating';

  const campaignLine =
    billingModel === 'PER_APPLICATION'
      ? 'This campaign charges its buyers and pays its publishers only for submitted applications. Calls on it are never also charged per call.'
      : 'This campaign charges its buyers and pays its publishers per billable call.';

  let agencyLine: React.ReactNode;
  if (isChild) {
    agencyLine = 'Your agency is not billed by the platform; your parent agency bills you.';
  } else if (enrolled === true) {
    agencyLine = (
      <>
        Your agency is enrolled in the platform&apos;s per-application billing and pays for each
        submitted application, on every campaign. That rate is set per agency, not here:{' '}
        <Link href={planHref} className="underline">
          see Plan &amp; Billing
        </Link>
        .
      </>
    );
  } else if (enrolled === false) {
    agencyLine =
      'Your agency is not enrolled in the platform’s per-application billing. Platform staff switch it on per agency.';
  } else {
    agencyLine =
      'The platform’s own per-application billing of an agency is set per agency by platform staff, not on a campaign.';
  }

  return (
    <Notice tone="info" title="How this campaign is billed" data-testid="campaign-billing-notice">
      <span className="block">{campaignLine}</span>
      <span className="mt-1 block">{agencyLine}</span>
    </Notice>
  );
}

/** Whether this agency is enrolled; null when unknown (no agency, or the read failed). */
function usePlatformEnrolment(ask: boolean): boolean | null {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!ask) return;
    let live = true;
    void apiClient
      .get<Envelope<{ enrolled?: boolean }>>('/api/v1/delivery/mandate')
      .then(response => {
        const value = payload(response)?.enrolled;
        if (live) setEnrolled(typeof value === 'boolean' ? value : null);
      })
      .catch(() => {
        if (live) setEnrolled(null);
      });
    return () => {
      live = false;
    };
  }, [ask]);
  return enrolled;
}
