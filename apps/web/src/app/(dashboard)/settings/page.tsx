'use client';

import { HubTabs } from '@/components/hub/hub-tabs';
import { PlanBillingView } from '@/components/settings/plan-billing-view';
import { SettingsView } from '@/components/settings/settings-view';
import { useAuth } from '@/hooks/use-auth';
import { useWhiteLabelView } from '@/hooks/use-white-label-view';

/**
 * Settings.
 *
 * Everybody gets the settings screen they always had. A white-label owner gets
 * one row of tabs: each settings panel as a tab of its own, opening on API
 * keys, beside Plan & Billing -- Rate, Delivery and Settlements, which used to
 * be three entries of their own in that nav. `?tab=plan` (and
 * `&section=settlements`) is where the old URLs redirect; `?tab=general`, the
 * tab this page used to have, lands on API keys like any tab it does not have.
 *
 * Workspace, the demo-mode switch, is a platform admin's alone, here as
 * everywhere; an agency never sees it.
 */
export default function SettingsPage(): JSX.Element {
  const whiteLabel = useWhiteLabelView();
  const { isPlatformAdmin } = useAuth();
  if (!whiteLabel) return <SettingsView />;

  return (
    <HubTabs
      label="Settings sections"
      defaultTab="api-keys"
      tabs={[
        { key: 'api-keys', label: 'API keys', render: () => <SettingsView section="api-keys" /> },
        { key: 'webhooks', label: 'Webhooks', render: () => <SettingsView section="webhooks" /> },
        { key: 'dnc', label: 'DNC lists', render: () => <SettingsView section="dnc" /> },
        { key: 'legal', label: 'Legal', render: () => <SettingsView section="legal" /> },
        { key: 'plan', label: 'Plan & Billing', render: () => <PlanBillingView /> },
        ...(isPlatformAdmin
          ? [
              {
                key: 'workspace',
                label: 'Workspace',
                render: () => <SettingsView section="workspace" />,
              },
            ]
          : []),
      ]}
    />
  );
}
