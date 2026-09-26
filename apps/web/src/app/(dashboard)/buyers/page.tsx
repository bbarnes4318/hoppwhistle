'use client';

import { useCallback, useEffect, useState } from 'react';

import { BillingView } from '@/components/billing/billing-view';
import { BuyersView } from '@/components/buyers/buyers-view';
import type { ReturnsPage } from '@/components/buyers/returns-types';
import { ReturnsView } from '@/components/buyers/returns-view';
import { HubTabs } from '@/components/hub/hub-tabs';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { useWhiteLabelView } from '@/hooks/use-white-label-view';
import { apiClient } from '@/lib/api';

/**
 * Buyers.
 *
 * Staff get the buyers screen they always had. A white-label owner gets it as
 * the first of three tabs: their buyers (with each one's portal logins), the
 * buyers' balances -- what used to be Billing -- and Returns, the calls buyers
 * have asked to give back, with the open count on the tab.
 */
export default function BuyersPage(): JSX.Element {
  const whiteLabel = useWhiteLabelView();
  return whiteLabel ? <BuyersHub /> : <BuyersView />;
}

function BuyersHub(): JSX.Element {
  const openCount = useOpenReturns();

  return (
    <HubTabs
      label="Buyers sections"
      defaultTab="buyers"
      tabs={[
        { key: 'buyers', label: 'Buyers', render: () => <BuyersView /> },
        { key: 'wallets', label: 'Buyer balances', render: () => <BillingView /> },
        {
          key: 'returns',
          label: openCount.value > 0 ? `Returns (${openCount.value})` : 'Returns',
          render: () => <ReturnsView onOpenCount={openCount.set} />,
        },
      ]}
    />
  );
}

/**
 * How many returns are waiting, for the tab label.
 *
 * Asked once when the hub opens; the Returns tab reports it again after every
 * load, so accepting one takes the count down without another request.
 */
function useOpenReturns(): { value: number; set: (count: number) => void } {
  const [value, setValue] = useState(0);
  const platform = usePlatformContext();

  useEffect(() => {
    if (platform.loading || platform.needsAgency) return;
    let cancelled = false;
    void apiClient.get<ReturnsPage>('/api/v1/returns?status=OPEN').then(response => {
      if (!cancelled && response.data?.meta) setValue(response.data.meta.openCount);
    });
    return () => {
      cancelled = true;
    };
  }, [platform.loading, platform.needsAgency]);

  const set = useCallback((count: number) => setValue(count), []);
  return { value, set };
}
