'use client';

import { ChangePasswordPanel } from '@/components/account/change-password-panel';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/domain';
import { useAuth } from '@/hooks/use-auth';

/**
 * Account: the signed-in person's own login, reached from the avatar menu.
 *
 * Open to every role. Buyers and publishers are otherwise kept inside their own
 * portal section by the dashboard layout, which lets this one page through for
 * them (see `app/(dashboard)/layout.tsx`); it is not on STAFF_ONLY_ROUTES, so
 * nobody else is redirected off it either.
 */
export default function AccountPage(): JSX.Element {
  const { user } = useAuth();
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ');

  return (
    <div className="page-canvas">
      <Panel>
        <PanelHeader>
          <PanelTitle>Your login</PanelTitle>
        </PanelHeader>
        <PanelBody>
          <dl className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            {name ? (
              <>
                <dt className="t-meta text-ink-3">Name</dt>
                <dd className="t-body text-ink">{name}</dd>
              </>
            ) : null}
            <dt className="t-meta text-ink-3">Email</dt>
            <dd className="t-body text-ink">{user?.email ?? ''}</dd>
          </dl>
        </PanelBody>
      </Panel>

      <ChangePasswordPanel />
    </div>
  );
}
