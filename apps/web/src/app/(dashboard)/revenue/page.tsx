'use client';

import { HubTabs } from '@/components/hub/hub-tabs';
import { ReportsView } from '@/components/reports/reports-view';
import { StatementsView } from '@/components/statements/statements-view';
import { SalesView } from '@/components/white-label/sales-view';

/**
 * Revenue: what a white-label agency's calls sold for.
 *
 * The Sales view, the Reports view and the monthly Statements, as tabs of one
 * entry. `/sales` and `/reports` still render each on its own for everybody the
 * white-label redirects do not apply to.
 */
export default function RevenuePage(): JSX.Element {
  return (
    <HubTabs
      label="Revenue sections"
      defaultTab="overview"
      tabs={[
        { key: 'overview', label: 'Overview', render: () => <SalesView /> },
        { key: 'reports', label: 'Reports', render: () => <ReportsView /> },
        { key: 'statements', label: 'Statements', render: () => <StatementsView /> },
      ]}
    />
  );
}
