'use client';

import { HubTabs } from '@/components/hub/hub-tabs';
import { PublishersView } from '@/components/publishers/publishers-view';
import { PayoutsView } from '@/components/white-label/payouts-view';
import { useWhiteLabelView } from '@/hooks/use-white-label-view';

/**
 * Publishers.
 *
 * Staff get the publishers screen they always had. A white-label owner gets it
 * as the first of two tabs: their publishers (with each one's portal logins)
 * and Payouts, what they owe each publisher and what they have paid.
 */
export default function PublishersPage(): JSX.Element {
  const whiteLabel = useWhiteLabelView();
  if (!whiteLabel) return <PublishersView />;

  return (
    <HubTabs
      label="Publishers sections"
      defaultTab="publishers"
      tabs={[
        { key: 'publishers', label: 'Publishers', render: () => <PublishersView /> },
        { key: 'payouts', label: 'Payouts', render: () => <PayoutsView /> },
      ]}
    />
  );
}
