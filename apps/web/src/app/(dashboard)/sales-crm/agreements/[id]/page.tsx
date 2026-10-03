'use client';

import { AgreementDetail } from '@/components/agreements/agreement-detail';
import { SalesGate } from '@/components/sales-crm/sales-gate';
import { surfaceFor } from '@/lib/sales-crm';

/** One envelope of this workspace's suite. */
export default function SalesAgreementDetailPage(): JSX.Element {
  return <SalesGate>{context => <AgreementDetail surface={surfaceFor(context)} />}</SalesGate>;
}
