'use client';

import { AgreementList } from '@/components/agreements/agreement-list';
import { PLATFORM_AGREEMENT_SURFACE } from '@/lib/agreements';

/**
 * NetEnroll's agreements. Platform admins only -- the route is in
 * STAFF_ONLY_ROUTES and every API call behind it is `requirePlatformAdmin`.
 * The screen itself is shared with each sales workspace's own agreement suite
 * (`/sales-crm/agreements`); this page pins it to NetEnroll's.
 */
export default function AgreementsPage(): JSX.Element {
  return <AgreementList surface={PLATFORM_AGREEMENT_SURFACE} />;
}
