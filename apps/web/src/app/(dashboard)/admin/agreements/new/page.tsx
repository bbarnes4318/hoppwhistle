'use client';

import { Suspense } from 'react';

import { NewAgreementForm } from '@/components/agreements/new-agreement-form';
import { PLATFORM_AGREEMENT_SURFACE } from '@/lib/agreements';

/**
 * A new set of NetEnroll agreements: the MSA (unless the agency already has
 * one) and the CPA and/or CPL Agreement, signed for NetEnroll at send.
 * Platform admins only. The form is shared with each sales workspace's suite.
 */
export default function NewAgreementPage(): JSX.Element {
  return (
    <Suspense>
      <NewAgreementForm surface={PLATFORM_AGREEMENT_SURFACE} />
    </Suspense>
  );
}
