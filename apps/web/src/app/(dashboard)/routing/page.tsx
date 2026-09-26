'use client';

import { CampaignsView } from '@/components/campaigns/campaigns-view';
import { HubTabs } from '@/components/hub/hub-tabs';
import { NumbersView } from '@/components/numbers/numbers-view';

/**
 * Routing: where every call goes.
 *
 * Campaigns and phone numbers, as two tabs of one entry. A campaign's detail
 * is still `/campaigns/[id]`, which the campaign list links to as it always
 * has.
 */
export default function RoutingPage(): JSX.Element {
  return (
    <HubTabs
      label="Routing sections"
      defaultTab="campaigns"
      tabs={[
        { key: 'campaigns', label: 'Campaigns', render: () => <CampaignsView /> },
        { key: 'numbers', label: 'Numbers', render: () => <NumbersView /> },
      ]}
    />
  );
}
