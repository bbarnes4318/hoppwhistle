'use client';

import { Building2, CalendarDays, KeyRound, ShieldCheck } from 'lucide-react';
import * as React from 'react';

import { Panel } from '@/components/domain';
import { Badge } from '@/components/ui/badge';

import { formatLongDate, initialsFor, roleLabels, signInMethodLabel } from './account-identity';

export interface AccountOverviewProps {
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  roles: readonly string[];
  organizationName: string | null;
  authMethod: string | null;
  hasPassword: boolean;
  createdAt: string | null;
  /** NetEnroll staff: shown as such rather than by an agency's roles. */
  isPlatformAdmin?: boolean;
}

/**
 * The head of the Account page: who is signed in, at a glance. A compact
 * identity card -- avatar, name, email, role -- with the three facts people come here to
 * check (who the login belongs to, how it signs in, how long it has existed)
 * in a strip beneath.
 */
export function AccountOverview({
  firstName,
  lastName,
  email,
  roles,
  organizationName,
  authMethod,
  hasPassword,
  createdAt,
  isPlatformAdmin = false,
}: AccountOverviewProps): JSX.Element {
  const name = [firstName, lastName].filter(Boolean).join(' ');
  const labels = isPlatformAdmin ? ['NetEnroll staff'] : roleLabels(roles);
  const memberSince = formatLongDate(createdAt);

  const facts: Array<{ icon: React.ElementType; label: string; value: string }> = [
    {
      icon: Building2,
      label: 'Organization',
      value: organizationName ?? (isPlatformAdmin ? 'NetEnroll' : 'Not set'),
    },
    { icon: KeyRound, label: 'Sign-in method', value: signInMethodLabel(authMethod, hasPassword) },
    { icon: CalendarDays, label: 'Member since', value: memberSince ?? 'Not recorded' },
  ];

  return (
    <Panel data-account-overview>
      <div className="p-5 min-[1440px]:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div
              aria-hidden
              className="flex h-14 w-14 shrink-0 select-none items-center justify-center rounded-full bg-brand-strong text-[20px] font-semibold tracking-tight text-white shadow-card"
            >
              {initialsFor(firstName, lastName, email)}
            </div>
            <div className="min-w-0">
              <h2 className="t-title truncate text-ink">{name || email}</h2>
              {name ? <p className="t-body truncate text-ink-2">{email}</p> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {labels.map(label => (
              <Badge key={label} variant="outline">
                {label}
              </Badge>
            ))}
            <Badge variant="success">
              <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
              Active
            </Badge>
          </div>
        </div>

        <dl className="mt-5 grid gap-px overflow-hidden rounded-card border border-rule bg-rule sm:grid-cols-3">
          {facts.map(fact => (
            <div key={fact.label} className="flex min-w-0 items-center gap-3 bg-surface px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-sunken text-ink-2">
                <fact.icon aria-hidden className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <dt className="t-caption text-ink-3">{fact.label}</dt>
                <dd className="truncate text-sm font-medium text-ink" title={fact.value}>
                  {fact.value}
                </dd>
              </div>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}
