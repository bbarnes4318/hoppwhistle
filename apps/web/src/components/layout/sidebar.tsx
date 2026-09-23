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

/*
 * ── Exactly one active item ──────────────────────────────────────────────────
 *
 * `isItemActive` matches a page and everything under it, so on /delivery/team
 * both Delivery and Team matched, and on /settings/users both Settings and
 * Team Members did. Two highlighted items is no highlight at all. Of every
 * item that matches, only the one with the LONGEST path is styled active —
 * across all groups, so a parent in one group cannot share the highlight with
 * its child in another. The drawer renders this same component, so the rule
 * holds on mobile too.
 */
function activeHrefFor(pathname: string | null, groups: NavGroup[]): string | null {
  let best: string | null = null;
  let bestLength = -1;
  for (const group of groups) {
    for (const item of group.items) {
      if (item.pending || !isItemActive(pathname, item.href)) continue;
      const length = item.href.split('?')[0].length;
      if (length > bestLength) {
        best = item.href;
        bestLength = length;
      }
    }
  }
  return best;
}

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
        className="flex h-9 items-center gap-3 rounded-control px-3 text-sm font-medium text-ink-3"
        title={`${item.name} — not built yet`}
        aria-disabled="true"
      >
        <Icon className="h-[18px] w-[18px] shrink-0 opacity-60" />
        <span className="truncate">{item.name}</span>
        <span className="ml-auto t-meta shrink-0 rounded-full bg-sunken px-2 text-ink-3">Soon</span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      title={item.title}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-9 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors duration-150 ease-out ne-motion',
        '[@media(pointer:coarse)]:h-10',
        active
          ? 'bg-brand-tint text-brand-ink before:absolute before:bottom-2 before:left-0 before:top-2 before:w-[3px] before:rounded-r-full before:bg-brand'
          : 'text-ink-2 hover:bg-sunken hover:text-ink'
      )}
    >
      <Icon
        className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-brand-ink' : 'text-ink-3')}
      />
      <span className="truncate">{item.name}</span>
    </Link>
  );
}

/**
 * While the session is still resolving.
 *
 * Deliberately not a spinner and deliberately not a nav: anything that looks
 * like navigation here is a guess about who the person is, and the guess that
 * was being made was "administrator or nobody".
 */
function ResolvingNotice() {
  return <div className="px-2 py-1.5 t-body text-ink-3" aria-busy="true" aria-live="polite" />;
}

/**
 * The server did not answer.
 *
 * Distinct from being signed out and distinct from holding no role. Those were
 * the same screen, so a rate-limited request read to the person as "my access
 * was revoked" -- and to anyone they reported it to as an authorization bug.
 */
function UnreachableNotice() {
  const { refetch, error } = useAuth();
  return (
    <div className="mx-1 rounded-card border border-rule bg-sunken p-3 t-body text-ink-2">
      <p className="font-medium text-ink">Your menu could not load</p>
      <p className="mt-1 t-meta text-ink-3">
        {error ?? 'The server did not answer.'} You are still signed in.
      </p>
      <button
        type="button"
        onClick={() => void refetch()}
        className="mt-2 rounded-control border border-rule-strong bg-surface px-3 py-1 t-meta font-medium text-ink shadow-card hover:bg-sunken"
      >
        Try again
      </button>
    </div>
  );
}

/**
 * The server answered, and this account holds no role.
 *
 * A real state with a real cause -- an invitation whose role row was missing,
 * or a demotion that removed one grant without adding another -- and it needs
 * an answer a person can act on, not a one-item menu that looks like the
 * product.
 */
function NoRoleNotice() {
  return (
    <div className="mx-1 rounded-card border border-rule bg-sunken p-3 t-body text-ink-2">
      <p className="font-medium text-ink">No role assigned</p>
      <p className="mt-1 t-meta text-ink-3">
        Your account is active but has not been given a role yet. Ask your agency administrator to
        assign one.
      </p>
    </div>
  );
}

/**
 * Role eyebrow. Publishers and buyers should never be unsure whose data this
 * is. A line of text with a brand dot, not a box: boxed, it read as a
 * disabled button.
 */
function PortalBadge({ label }: { label: string }) {
  return (
    <div className="mb-1 flex items-center gap-2 px-3 pb-2 pt-1 text-[11px] font-semibold uppercase leading-none tracking-[0.06em] text-brand-ink">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
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
    status,
    hasResolvedNoRole,
  } = useAuth();

  /*
   * Three states that used to look identical, and one of them was the incident.
   *
   * The dispatch below reads flags derived from `user`, and `user` was null
   * while the session was still resolving, when nobody was signed in, AND when
   * the request failed. All three fell through to the catch-all: a single
   * Dashboard entry, indistinguishable from an account whose roles had been
   * taken away. A 429 from the shared rate-limit bucket was enough to produce
   * it for somebody who had been working a second earlier.
   *
   * So: while resolving, render NO navigation -- an administrator's least of
   * all. When the server could not be reached, say that. Only when the server
   * has actually answered does the role dispatch run, and "answered with no
   * roles" gets its own message rather than a nav that implies one page.
   */
  const groups: NavGroup[] = React.useMemo(() => {
    if (isPlatformAdmin) return PLATFORM_NAV;
    if (hasFullAccess) return AGENCY_OWNER_NAV;
    if (isPublisherOnly) return publisherNav(canViewRecordings);
    if (isBuyerOnly) return buyerNav(canViewRecordings);
    if (isAgentOnly) return AGENT_NAV;
    if (isReadonlyOnly) {
      /*
       * Dashboard alone.
       *
       * This used to add /reports when the account held `reports:read`, and
       * that link now goes somewhere they are sent straight back from:
       * /reports joined STAFF_ONLY_ROUTES, and the dashboard layout redirects
       * a read-only account off every route on that list -- staff bypass the
       * dispatch entirely, a read-only account does not. Leaving the entry in
       * would have put a link in the sidebar whose only behaviour is to bounce.
       *
       * The capability is untouched: `reports:read` still means what it meant
       * and the API still answers it. What has gone is a menu item pointing at
       * a screen this principal can no longer open.
       */
      return [{ items: [PLATFORM_NAV[0].items[0]] }];
    }
    // Reached only once the server has answered and named no role we render a
    // nav for. `NoRoleNotice` is what the person sees; an empty list here keeps
    // a stale Dashboard link from sitting under it.
    return [];
  }, [
    isPlatformAdmin,
    hasFullAccess,
    isPublisherOnly,
    isBuyerOnly,
    isAgentOnly,
    isReadonlyOnly,
    canViewRecordings,
  ]);

  const drawer = variant === 'drawer';
  const activeHref = activeHrefFor(pathname, groups);

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col bg-surface',
        drawer ? 'w-full' : 'sticky top-0 w-[248px] shrink-0 border-r border-rule'
      )}
    >
      {/* In the drawer the panel already has a header, so the brand row would
          be a second one. */}
      {drawer ? null : (
        <div className="flex h-16 shrink-0 items-center border-b border-rule px-5">
          <Link href="/dashboard" className="rounded-control" aria-label="NetEnroll home">
            {/* The whole lockup, tagline included: at 128px the
                PAY-PER-APPLICATION line still reads. h-16 matches the topbar
                beside it (topbar.tsx), so the two bottom rules meet in a
                single line across the top of the page. Only the nav below
                scrolls; this block stays put. */}
            <Logo width={128} />
          </Link>
        </div>
      )}

      <nav aria-label="Main" className="custom-scrollbar flex-1 overflow-y-auto p-2">
        <div className="px-1 py-2">
          {status === 'resolving' ? <ResolvingNotice /> : null}
          {status === 'failed' ? <UnreachableNotice /> : null}
          {hasResolvedNoRole ? <NoRoleNotice /> : null}
          {/* Whose product this is, said at the top of the column. An agency
            principal gets one for the same reason a publisher does: the screen
            they are on is an agency's, not NetEnroll's. */}
          {!isPlatformAdmin && hasFullAccess ? <PortalBadge label="Agency portal" /> : null}
          {isPublisherOnly ? <PortalBadge label="Publisher portal" /> : null}
          {isBuyerOnly ? <PortalBadge label="Buyer portal" /> : null}
          {isAgentOnly ? <PortalBadge label="Agent portal" /> : null}

          {groups.map((group, gi) => (
            <div key={group.label ?? `group-${gi}`} className={cn(gi > 0 && 'mt-5')}>
              {group.label ? (
                <h2 className="px-3 pb-1.5 t-label text-ink-3">{group.label}</h2>
              ) : null}
              <ul className="space-y-0.5">
                {group.items.map(item => (
                  <li key={`${item.name}-${item.href}`}>
                    <NavLink item={item} active={item.href === activeHref} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </div>
  );
}
