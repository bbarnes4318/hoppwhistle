'use client';

import { HubTabs } from '@/components/hub/hub-tabs';
import { PlanBillingView } from '@/components/settings/plan-billing-view';
import { SettingsView } from '@/components/settings/settings-view';
import { StatementsPanel } from '@/components/statements/statements-panel';
import { useAuth } from '@/hooks/use-auth';
import { useWhiteLabelView } from '@/hooks/use-white-label-view';

/**
 * Settings.
 *
 * Everybody gets the settings screen they always had. A white-label owner gets
 * one row of tabs: each settings panel as a tab of its own, opening on
 * Webhooks, beside Plan & Billing -- Rate, Delivery and Settlements, which used
 * to be three entries of their own in that nav. `?tab=plan` (and
 * `&section=settlements`) is where the old URLs redirect; `?tab=general` and
 * `?tab=api-keys`, tabs this page used to have, land on Webhooks like any tab
 * it does not have. There is no API keys tab: an agency has no API keys of its
 * own to manage, and the tab only ever showed a made-up one.
 *
 * Workspace, the demo-mode switch, is a platform admin's alone, here as
 * everywhere; an agency never sees it.
 *
 * A downline agency's owner gets its settings beside a Statements tab: the
 * monthly statement its white-label issues it.
 */
export default function SettingsPage(): JSX.Element {
  const whiteLabel = useWhiteLabelView();
  const { isPlatformAdmin, isChild, isOwner } = useAuth();
  if (!whiteLabel) {
    // A downline agency's owner reads the statement its white-label issues it here.
    if (isChild && isOwner) {
      return (
        <HubTabs
          label="Settings sections"
          defaultTab="settings"
          tabs={[
            { key: 'settings', label: 'Settings', render: () => <SettingsView /> },
            {
              key: 'statements',
              label: 'Statements',
              render: () => (
                <StatementsPanel
                  partyType="CHILD_AGENCY"
                  description="Your calls, applications, agents and number charges, month by month."
                />
              ),
            },
          ]}
        />
      );
    }
    return <SettingsView />;
  }

  return (
    <HubTabs
      label="Settings sections"
      defaultTab="webhooks"
      tabs={[
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
