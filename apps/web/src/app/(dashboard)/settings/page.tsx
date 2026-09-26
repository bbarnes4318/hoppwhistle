'use client';

import { HubTabs } from '@/components/hub/hub-tabs';
import { PlanBillingView } from '@/components/settings/plan-billing-view';
import { SettingsView } from '@/components/settings/settings-view';
import { useWhiteLabelView } from '@/hooks/use-white-label-view';

/**
 * Settings.
 *
 * Everybody gets the settings screen they always had. A white-label owner gets
 * it as the General tab, beside Plan & Billing: Rate, Delivery and
 * Settlements, which used to be three entries of their own in that nav.
 */
export default function SettingsPage(): JSX.Element {
  const whiteLabel = useWhiteLabelView();
  if (!whiteLabel) return <SettingsView />;

  return (
    <HubTabs
      label="Settings sections"
      defaultTab="general"
      tabs={[
        { key: 'general', label: 'General', render: () => <SettingsView /> },
        { key: 'plan', label: 'Plan & Billing', render: () => <PlanBillingView /> },
      ]}
    />
  );
}
