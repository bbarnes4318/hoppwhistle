'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { CustomerQuoteWorkspace } from '@/components/fex/customer/customer-quote-workspace';

/**
 * Quote one CRM customer: `/insurance-leads/:id/quote`.
 *
 * The customer is in the path, so the binding survives a reload, a shared
 * link and the back button; the server checks on every save that the
 * customer is the agent's. `?requote=<quoteId>` starts from a saved quote's
 * answers, re-run at today's rates as a new quote.
 */
export default function CustomerQuotePage(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <CustomerQuoteRoute />
    </Suspense>
  );
}

function CustomerQuoteRoute(): JSX.Element {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  return (
    <CustomerQuoteWorkspace leadId={params?.id ?? ''} requoteId={search?.get('requote') ?? null} />
  );
}
