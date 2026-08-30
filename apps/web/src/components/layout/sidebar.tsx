'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

import {
  ADMIN_NAV,
  AGENT_NAV,
  buyerNav,
  publisherNav,
  type NavGroup,
  type NavItem,
} from './nav-config';

/**
 * Sidebar.
 *
 * Admin's flat column of 14 becomes the brief's four groups. The group headers
 * are labels and nothing else — not buttons, not disclosure triangles. A new
 * person should be able to read the product's shape off this list in one look,
 * and a section they have to open first cannot do that.
 */

function isItemActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  // Strip the query so /publisher/calls?hasRecording=true matches its page.
  const path = href.split('?')[0];
  if (pathname === path) return true;
  // Guard against /calls matching /calls-something.
  return pathname.startsWith(`${path}/`);
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;

  if (item.pending) {
    return (
      <span
        className="flex items-center gap-2 rounded-control px-2 py-1.5 t-body text-ink-3"
        title={`${item.name} — not built yet`}
        aria-disabled="true"
      >
        <Icon className="h-4 w-4 shrink-0 opacity-60" />
        <span className="truncate">{item.name}</span>
        <span className="ml-auto t-meta shrink-0 rounded-control bg-sunken px-1 text-ink-3">
          Soon
        </span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      title={item.title}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2 rounded-control px-2 py-1.5 t-body transition-colors',
        active
          ? 'bg-money-tint font-medium text-money-ink'
          : 'text-ink-2 hover:bg-sunken hover:text-ink'
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-money' : 'text-ink-3')} />
      <span className="truncate">{item.name}</span>
    </Link>
  );
}

/** Role banner. Publishers and buyers should never be unsure whose data this is. */
function PortalBadge({ label }: { label: string }) {
  return (
    <div className="mb-2 rounded-control border border-rule bg-sunken px-2 py-1 text-center t-label text-ink-2">
      {label}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const {
    hasFullAccess,
    isBuyerOnly,
    isPublisherOnly,
    isAgentOnly,
    isReadonlyOnly,
    canViewRecordings,
    canViewReports,
  } = useAuth();

  const groups: NavGroup[] = React.useMemo(() => {
    if (hasFullAccess) return ADMIN_NAV;
    if (isPublisherOnly) return publisherNav(canViewRecordings);
    if (isBuyerOnly) return buyerNav(canViewRecordings);
    if (isAgentOnly) return AGENT_NAV;
    if (isReadonlyOnly) {
      const items: NavItem[] = [ADMIN_NAV[0].items[0]];
      if (canViewReports) {
        const reports = ADMIN_NAV.find(g => g.label === 'Money')?.items.find(
          i => i.href === '/reports'
        );
        if (reports) items.push(reports);
      }
      return [{ items }];
    }
    // New user with no role yet, and the catch-all: one safe destination.
    return [{ items: [ADMIN_NAV[0].items[0]] }];
  }, [
    hasFullAccess,
    isPublisherOnly,
    isBuyerOnly,
    isAgentOnly,
    isReadonlyOnly,
    canViewRecordings,
    canViewReports,
  ]);

  return (
    <div className="flex h-full w-52 shrink-0 flex-col border-r border-rule bg-surface">
      <div className="flex h-12 shrink-0 items-center border-b border-rule px-4">
        <Link href="/dashboard" className="rounded-control">
          <Image
            src="/hopwhistle.png"
            alt="Hopwhistle"
            width={100}
            height={32}
            className="h-6 w-auto"
            priority
          />
        </Link>
      </div>

      <nav aria-label="Main" className="custom-scrollbar flex-1 overflow-y-auto p-2">
        {isPublisherOnly ? <PortalBadge label="Publisher portal" /> : null}
        {isBuyerOnly ? <PortalBadge label="Buyer portal" /> : null}
        {isAgentOnly ? <PortalBadge label="Agent portal" /> : null}

        {groups.map((group, gi) => (
          <div key={group.label ?? `group-${gi}`} className={cn(gi > 0 && 'mt-4')}>
            {group.label ? <h2 className="px-2 pb-1 t-label text-ink-3">{group.label}</h2> : null}
            <ul className="space-y-0.5">
              {group.items.map(item => (
                <li key={`${item.name}-${item.href}`}>
                  <NavLink item={item} active={isItemActive(pathname, item.href)} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
