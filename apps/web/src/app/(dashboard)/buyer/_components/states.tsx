import { AlertTriangle, Building2 } from 'lucide-react';
import * as React from 'react';

import { EmptyState, Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/domain';

/**
 * The two things a panel can be instead of data: broken, or out of scope.
 * Both say which panel they belong to, because on a six-panel page an
 * unattributed "Something went wrong" tells you nothing about what to retry.
 */

export function PanelError({ title, message }: { title: string; message: string }) {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{title}</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <EmptyState
          variant="error"
          icon={AlertTriangle}
          headline={`${title} could not load`}
          body={message}
        />
      </PanelBody>
    </Panel>
  );
}

/**
 * Admins and owners can open these pages without being attached to a buyer
 * record. Saying so is important: an empty call list would otherwise read as
 * "you received no calls" rather than "you are not looking at a buyer".
 */
export function NoBuyerScope() {
  return (
    <Panel>
      <PanelBody>
        <EmptyState
          size="page"
          icon={Building2}
          headline="No buyer account attached"
          body="These pages show one buyer's calls, spend and balance. Your user is not linked to a buyer record, so there is nothing to scope them to."
          action={{ label: 'Open the admin buyer list', href: '/buyers' }}
        />
      </PanelBody>
    </Panel>
  );
}
