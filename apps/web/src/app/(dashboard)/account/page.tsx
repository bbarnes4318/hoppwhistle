'use client';

import { FileText, Shield } from 'lucide-react';

import { ChangePasswordPanel } from '@/components/account/change-password-panel';
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { CallRoutingPanel } from '@/components/phone/call-routing-panel';
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
 * The legal documents are here as well as under Settings because an agent no
 * longer has Settings in their sidebar -- for them it was the agency's DNC
 * administration -- and the policies that govern their account are theirs to
 * read. They are public pages; nothing here is the agency's.
 */
const DOCUMENTS = [
  { href: '/legal/privacy', name: 'Privacy Policy', icon: Shield },
  { href: '/legal/terms', name: 'Terms of Service', icon: FileText },
  { href: '/legal/data-retention', name: 'Data Retention Policy', icon: FileText },
  { href: '/legal/call-recording', name: 'Call Recording Policy', icon: FileText },
] as const;

export default function AccountPage(): JSX.Element {
  const { user } = useAuth();
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ');

  return (
    <div className="page-canvas">
      <PageHeader description="Your login, your password, and the policies that cover your account." />

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

      <CallRoutingPanel />

      <ChangePasswordPanel />

      <Panel data-legal-documents>
        <PanelHeader>
          <PanelTitle>Policies</PanelTitle>
          <PanelDescription>Privacy, terms, data retention and call recording</PanelDescription>
        </PanelHeader>
        <PanelBody>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {DOCUMENTS.map(doc => (
              <li key={doc.href}>
                <a
                  href={doc.href}
                  className="flex min-h-[44px] min-w-0 items-center gap-3 rounded-card border border-rule bg-surface px-3 py-2.5 transition-shadow duration-150 ease-out hover:shadow-raised"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand-ink">
                    <doc.icon className="h-4 w-4" />
                  </span>
                  <span className="truncate text-sm font-medium text-ink">{doc.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </PanelBody>
      </Panel>
    </div>
  );
}
