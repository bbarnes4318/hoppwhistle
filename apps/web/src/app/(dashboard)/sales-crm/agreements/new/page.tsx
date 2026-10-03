'use client';

import { Suspense } from 'react';

import { NewAgreementForm } from '@/components/agreements/new-agreement-form';
import { SalesGate } from '@/components/sales-crm/sales-gate';
import { surfaceFor } from '@/lib/sales-crm';

/**
 * A new agreement from this workspace's own suite, usually opened from a
 * prospect (`?prospectId=`). Refused by the API until the suite has approved
 * templates and complete settings.
 */
export default function NewSalesAgreementPage(): JSX.Element {
  return (
    <SalesGate>
      {context => (
        <Suspense>
          <NewAgreementForm surface={surfaceFor(context)} />
        </Suspense>
      )}
    </SalesGate>
  );
}
