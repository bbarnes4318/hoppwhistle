'use client';

import { AgreementList } from '@/components/agreements/agreement-list';
import { SalesGate } from '@/components/sales-crm/sales-gate';
import { surfaceFor } from '@/lib/sales-crm';

/**
 * The agreements this sales workspace's own suite has sent: Life Leads Plus's
 * for its owner, NetEnroll's for platform staff. The server picks the
 * workspace from the session; another workspace's envelopes are not found.
 */
export default function SalesAgreementsPage(): JSX.Element {
  return <SalesGate>{context => <AgreementList surface={surfaceFor(context)} />}</SalesGate>;
}
