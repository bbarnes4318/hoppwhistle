'use client';

import { AgreementDetail } from '@/components/agreements/agreement-detail';
import { PLATFORM_AGREEMENT_SURFACE } from '@/lib/agreements';

/** One of NetEnroll's envelopes. Platform admins only. */
export default function AgreementDetailPage(): JSX.Element {
  return <AgreementDetail surface={PLATFORM_AGREEMENT_SURFACE} />;
}
