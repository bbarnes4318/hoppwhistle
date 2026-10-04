'use client';

import { FileText, MonitorSmartphone, PhoneForwarded, ShieldCheck, UserRound } from 'lucide-react';
import * as React from 'react';

import { roleLabels } from '@/components/account/account-identity';
import { AccountOverview } from '@/components/account/account-overview';
import {
  AccountSectionNav,
  type AccountSectionLink,
} from '@/components/account/account-section-nav';
import { ChangePasswordPanel } from '@/components/account/change-password-panel';
import { LicensedStatesPanel } from '@/components/account/licensed-states-panel';
import { PoliciesPanel } from '@/components/account/policies-panel';
import { SessionsPanel } from '@/components/account/sessions-panel';
import { CopyButton, SettingRow, SettingRows } from '@/components/account/setting-row';
import {
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { CallRoutingPanel } from '@/components/phone/call-routing-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';

/**
 * Account: the signed-in person's own login, reached from the avatar menu and,
 * for an agent, from the Account group of their sidebar.
 *
 * Open to every role. Buyers and publishers are otherwise kept inside their own
 * portal section by the dashboard layout, which lets this one page through for
 * them (see `app/(dashboard)/layout.tsx`); it is not on STAFF_ONLY_ROUTES, so
 * nobody else is redirected off it either.
 *
 * ── Layout ───────────────────────────────────────────────────────────────────
 *
 * An identity card across the top, then the settings in sections -- Profile,
 * Calling (agents only), Security, Sessions, Policies -- with a sticky table of
 * contents at the left from `lg`. Every section is an anchor, so
 * `/account#security` is a link someone can be sent.
 */
export default function AccountPage(): JSX.Element {
  const { user, status, isAgent, isAdminOrOwner, isPlatformAdmin, isReadOnlyPreview, refetch } =
    useAuth();

  const sections = React.useMemo<AccountSectionLink[]>(
    () => [
      { id: 'profile', label: 'Profile', icon: UserRound },
      ...(isAgent ? [{ id: 'calling', label: 'Calling', icon: PhoneForwarded }] : []),
      { id: 'security', label: 'Security', icon: ShieldCheck },
      { id: 'sessions', label: 'Sessions', icon: MonitorSmartphone },
      { id: 'policies', label: 'Policies', icon: FileText },
    ],
    [isAgent]
  );

  if (!user) {
    return (
      <div className="page-canvas">
        <PageHeader description="Your profile, sign-in security and sessions." />
        {status === 'failed' ? (
          <Notice
            tone="error"
            title="Your account could not be loaded."
            action={
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Try again
              </Button>
            }
          />
        ) : (
          <AccountSkeleton />
        )}
      </div>
    );
  }

  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
  const licensedStates = [...(user.licensedStates ?? [])].sort();
  const roles = isPlatformAdmin ? ['NetEnroll staff'] : roleLabels(user.roles);

  return (
    <div className="page-canvas">
      <PageHeader description="Your profile, sign-in security and sessions." />

      <div className="mx-auto grid w-full max-w-[1200px] gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] xl:gap-10">
        <AccountSectionNav sections={sections} />

        <div className="grid min-w-0 gap-6">
          <section id="profile" aria-label="Profile" className="grid scroll-mt-6 gap-6">
            <AccountOverview
              firstName={user.firstName}
              lastName={user.lastName}
              email={user.email}
              roles={user.roles}
              organizationName={user.organizationName ?? user.actingTenantName ?? null}
              authMethod={user.authMethod ?? null}
              hasPassword={user.hasPassword !== false}
              createdAt={user.createdAt ?? null}
              isPlatformAdmin={isPlatformAdmin}
            />

            <Panel data-profile-details>
              <PanelHeader>
                <PanelTitle className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-ink-3" aria-hidden />
                  Profile details
                </PanelTitle>
                <PanelDescription>
                  {isAdminOrOwner || isPlatformAdmin
                    ? 'How you appear to your team and in the audit log.'
                    : 'How you appear to your team. Your administrator manages your name and email.'}
                </PanelDescription>
              </PanelHeader>
              <PanelBody>
                <SettingRows>
                  <SettingRow label="Full name">
                    {name ? (
                      <span className="truncate">{name}</span>
                    ) : (
                      <span className="text-ink-3">Not set</span>
                    )}
                  </SettingRow>
                  <SettingRow label="Email address" hint="You sign in with this address.">
                    <span className="truncate">{user.email}</span>
                    <CopyButton value={user.email} label="email address" />
                  </SettingRow>
                  <SettingRow label={roles.length > 1 ? 'Roles' : 'Role'}>
                    {roles.length ? (
                      <span className="flex flex-wrap gap-1.5">
                        {roles.map(role => (
                          <Badge key={role} variant="secondary">
                            {role}
                          </Badge>
                        ))}
                      </span>
                    ) : (
                      <span className="text-ink-3">No role assigned</span>
                    )}
                  </SettingRow>
                  {user.position ? (
                    <SettingRow label="Position">
                      <span className="truncate">{user.position}</span>
                    </SettingRow>
                  ) : null}
                  <SettingRow label="User ID" hint="Quote this when you contact support.">
                    <span className="t-data truncate text-ink-2">{user.id}</span>
                    <CopyButton value={user.id} label="user ID" />
                  </SettingRow>
                </SettingRows>
              </PanelBody>
            </Panel>
          </section>

          {isAgent ? (
            <section id="calling" aria-label="Calling" className="grid scroll-mt-6 gap-6">
              <LicensedStatesPanel
                states={licensedStates}
                editable={!isAdminOrOwner && !isPlatformAdmin}
                readOnly={isReadOnlyPreview}
              />

              <CallRoutingPanel />
            </section>
          ) : null}

          <section id="security" aria-label="Security" className="grid scroll-mt-6 gap-6">
            <ChangePasswordPanel
              hasPassword={user.hasPassword !== false}
              readOnly={isReadOnlyPreview}
              username={user.email}
            />
          </section>

          <section id="sessions" aria-label="Sessions" className="grid scroll-mt-6 gap-6">
            <SessionsPanel
              sessionExpiresAt={user.sessionExpiresAt ?? null}
              readOnly={isReadOnlyPreview}
            />
          </section>

          <section id="policies" aria-label="Policies" className="grid scroll-mt-6 gap-6">
            <PoliciesPanel />
          </section>
        </div>
      </div>
    </div>
  );
}

function AccountSkeleton(): JSX.Element {
  return (
    <div
      className="mx-auto grid w-full max-w-[1200px] gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] xl:gap-10"
      aria-busy="true"
      aria-label="Loading your account"
    >
      <div className="hidden gap-2 lg:grid lg:content-start">
        {[0, 1, 2, 3].map(i => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
      <div className="grid gap-6">
        <Skeleton className="h-[220px] rounded-card" />
        <Skeleton className="h-[280px] rounded-card" />
        <Skeleton className="h-[320px] rounded-card" />
      </div>
    </div>
  );
}
