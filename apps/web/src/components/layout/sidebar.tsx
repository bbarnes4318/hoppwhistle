'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Logo } from '@/components/brand/logo';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

import {
  AGENCY_OWNER_NAV,
  AGENT_NAV,
  buyerNav,
  PLATFORM_NAV,
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
 *
 * ── Which nav, and in which order ────────────────────────────────────────────
 *
 * `isPlatformAdmin` is checked BEFORE `hasFullAccess`, and the order is the fix.
 * `hasFullAccess` is ADMIN-or-OWNER, and NetEnroll staff inside an agency carry
 * both (see ACTING_TENANT_ROLES on the API side) — so testing it first gave the
 * agency nav to the operators who need the platform one. Testing the capability
 * first gives each of the three full-access readings exactly one nav:
 *
 *   isPlatformAdmin → PLATFORM_NAV      NetEnroll staff
 *   hasFullAccess   → AGENCY_OWNER_NAV  an agency principal
 *
 * A platform operator PREVIEWING an agency as OWNER or AGENT lands correctly
 * here without a branch of its own: the API replaces their roles with exactly
 * the previewed one, `/api/auth/me` answers with it, so `isPlatformAdmin` is
 * still true for the banner but the nav they get is the one under preview. That
 * is the whole reason the preview replaces rather than merges.
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
          ? 'bg-brand-tint font-medium text-brand-ink'
          : 'text-ink-2 hover:bg-sunken hover:text-ink'
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-brand-ink' : 'text-ink-3')} />
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

/**
 * `rail` is the fixed column beside the page. `drawer` is the same nav rendered
 * inside the mobile panel, where the surrounding drawer already supplies the
 * header and the width.
 */
export function Sidebar({ variant = 'rail' }: { variant?: 'rail' | 'drawer' } = {}) {
  const pathname = usePathname();
  const {
    isPlatformAdmin,
    hasFullAccess,
    isBuyerOnly,
    isPublisherOnly,
    isAgentOnly,
    isReadonlyOnly,
    canViewRecordings,
    canViewReports,
  } = useAuth();

  const groups: NavGroup[] = React.useMemo(() => {
    if (isPlatformAdmin) return PLATFORM_NAV;
    if (hasFullAccess) return AGENCY_OWNER_NAV;
    if (isPublisherOnly) return publisherNav(canViewRecordings);
    if (isBuyerOnly) return buyerNav(canViewRecordings);
    if (isAgentOnly) return AGENT_NAV;
    if (isReadonlyOnly) {
      const items: NavItem[] = [PLATFORM_NAV[0].items[0]];
      if (canViewReports) {
        const reports = PLATFORM_NAV.find(g => g.label === 'Money')?.items.find(
          i => i.href === '/reports'
        );
        if (reports) items.push(reports);
      }
      return [{ items }];
    }
    // New user with no role yet, and the catch-all: one safe destination.
    return [{ items: [PLATFORM_NAV[0].items[0]] }];
  }, [
    isPlatformAdmin,
    hasFullAccess,
    isPublisherOnly,
    isBuyerOnly,
    isAgentOnly,
    isReadonlyOnly,
    canViewRecordings,
    canViewReports,
  ]);

  const drawer = variant === 'drawer';

  return (
    <div
      className={cn(
        'flex h-full flex-col bg-surface',
        drawer ? 'w-full' : 'w-52 shrink-0 border-r border-rule'
      )}
    >
      {/* In the drawer the panel already has a header, so the brand row would
          be a second one. */}
      {drawer ? null : (
        <div className="flex h-12 shrink-0 items-center border-b border-rule px-4">
          <Link href="/dashboard" className="rounded-control" aria-label="NetEnroll home">
            {/* The whole lockup, tagline included: at 128px the
                PAY-PER-APPLICATION line still reads. h-12 matches the topbar
                beside it (topbar.tsx), so the two bottom rules meet in a
                single line across the top of the page -- the lockup is sized
                to fit that, not the other way round. */}
            <Logo width={128} />
          </Link>
        </div>
      )}

      <nav aria-label="Main" className="custom-scrollbar flex-1 overflow-y-auto p-2">
        {/* Whose product this is, said at the top of the column. An agency
            principal gets one for the same reason a publisher does: the screen
            they are on is an agency's, not NetEnroll's. */}
        {!isPlatformAdmin && hasFullAccess ? <PortalBadge label="Agency portal" /> : null}
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
