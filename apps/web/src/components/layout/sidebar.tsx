'use client';

import { Lock } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { BrandLockup } from '@/components/brand/brand-lockup';
import { Logo } from '@/components/brand/logo';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/hooks/use-auth';
import { useBrand } from '@/hooks/use-brand';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { cn } from '@/lib/utils';

import {
  FIRST_UPGRADE_GROUP,
  isLockedGroup,
  navFor,
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
 * A platform operator PREVIEWING an agency as OWNER or AGENT gets the nav under
 * preview: the API replaces their roles with exactly the previewed one, and
 * `navFor` skips the staff branch while a preview is on. It used to claim this
 * happened on its own, but `isPlatformAdmin` stays true for the whole preview
 * (the banner needs it), so testing it first handed the previewing operator
 * PLATFORM_NAV. See `navFor` in nav-config.ts, which the command palette reads
 * too.
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
      // A locked item never navigates, so it is never where the person is --
      // even on /call-center, which an owner can still reach by URL.
      if (item.pending || item.locked || !isItemActive(pathname, item.href)) continue;
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

/**
 * An upgrade in the sidebar: shown, explained, never navigated to.
 *
 * A button rather than a link, with `aria-disabled`, so it is reachable by
 * keyboard and announced as unavailable, and there is no href for a middle
 * click or a long-press to open. Hover on a pointer device, or a tap on a
 * touch one, opens a card saying what the feature is and who turns it on.
 *
 * It has to read as deliberate. The grey "Soon" chip `pending` uses says "not
 * built"; this says "not on your plan", in the brand colour, with a lock.
 */
function LockedNavItem({ item, drawer }: { item: NavItem; drawer: boolean }) {
  // A white-labelled agency's people do not know NetEnroll by name.
  const { brand } = useBrand();
  const Icon = item.icon;
  const [open, setOpen] = React.useState(false);
  const hovering = React.useRef(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  // A short grace period, so moving the pointer from the item onto the card
  // does not close the card on the way.
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  React.useEffect(() => cancelClose, []);

  // Hover only for a real mouse. On touch, pointerenter fires just before the
  // click, and opening on both would open-then-close on a single tap.
  const onPointerEnter = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    hovering.current = true;
    cancelClose();
    setOpen(true);
  };
  const onPointerLeave = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    hovering.current = false;
    closeSoon();
  };

  // A click while the pointer is already over the item would otherwise toggle
  // the card hover just opened straight back shut.
  const onOpenChange = (next: boolean) => {
    if (!next && hovering.current) return;
    setOpen(next);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-disabled="true"
          aria-haspopup="dialog"
          aria-label={`${item.name} — upgrade required`}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          className={cn(
            'group flex h-9 w-full items-center gap-3 rounded-control pl-3 pr-1.5 text-left text-sm font-medium text-ink-3',
            // The label-to-pill gap is the flex gap; `ml-auto` only pushes.
            '[@media(pointer:coarse)]:h-10',
            'transition-colors duration-150 ease-out ne-motion hover:bg-sunken',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            open && 'bg-sunken'
          )}
        >
          <Icon className="h-[18px] w-[18px] shrink-0 opacity-60" />
          {/*
            Two tight lines rather than an ellipsis for the longest names --
            "VOIP Carrier Routing" and "Onboard an Agency" do not fit beside the
            pill in a 248px rail, and 2 x 1.2 x 14px still sits inside the h-9
            row, so the item keeps a normal item's height.
          */}
          <span className="line-clamp-2 min-w-0 break-words leading-[1.2] opacity-80">
            {item.name}
          </span>
          {/*
            The lock rides inside the pill rather than beside the label: the
            rail is 248px, and a lock of its own cost the label the room it
            needed -- "Publishers" read "Publish…".
          */}
          <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full bg-brand-tint px-1.5 py-0.5 text-[11px] font-semibold leading-none text-brand-ink">
            <Lock className="h-2.5 w-2.5" aria-hidden="true" />
            Upgrade
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={drawer ? 'bottom' : 'right'}
        align="start"
        sideOffset={8}
        onPointerEnter={cancelClose}
        onPointerLeave={event => {
          if (event.pointerType === 'mouse') closeSoon();
        }}
        // The card explains; it does not take focus away from the menu.
        onOpenAutoFocus={event => event.preventDefault()}
        onEscapeKeyDown={() => {
          hovering.current = false;
          setOpen(false);
        }}
        className="w-72 max-w-[calc(100vw-32px)] p-4"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-semibold text-ink">
              {item.name}
              <Lock className="h-3 w-3 text-ink-3" aria-hidden="true" />
            </p>
            <p className="mt-1 t-body text-ink-2">{item.locked?.blurb}</p>
          </div>
        </div>
        <p className="mt-3 border-t border-rule pt-3 t-meta text-ink-3">
          Ask your {brand ? '' : 'NetEnroll '}account manager to turn this on for your agency.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function NavLink({
  item,
  active,
  drawer = false,
}: {
  item: NavItem;
  active: boolean;
  drawer?: boolean;
}) {
  const Icon = item.icon;

  if (item.locked) return <LockedNavItem item={item} drawer={drawer} />;

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
    user,
  } = useAuth();
  const platform = usePlatformContext();
  // Either source answers; the platform context is the one the preview banner
  // renders from. See `navFor` for why this matters to the nav.
  const previewing = platform.previewRole != null || user?.previewRole != null;

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
  const groups: NavGroup[] = React.useMemo(
    () =>
      navFor({
        isPlatformAdmin,
        previewing,
        hasFullAccess,
        isPublisherOnly,
        isBuyerOnly,
        isAgentOnly,
        isReadonlyOnly,
        canViewRecordings,
      }),
    [
      isPlatformAdmin,
      previewing,
      hasFullAccess,
      isPublisherOnly,
      isBuyerOnly,
      isAgentOnly,
      isReadonlyOnly,
      canViewRecordings,
    ]
  );

  const drawer = variant === 'drawer';
  const activeHref = activeHrefFor(pathname, groups);
  const { brand, settled: brandSettled } = useBrand();

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col bg-surface',
        drawer ? 'w-full' : 'sticky top-0 w-[248px] shrink-0 border-r border-rule'
      )}
      /*
       * An agency brand draws the rail in its navy. The attribute re-scopes the
       * design tokens for this subtree (globals.css), so nothing below it needs
       * to know. The drawer stays light: it opens inside a light panel.
       */
      data-brand-nav={brand && !drawer ? '' : undefined}
    >
      {/* In the drawer the panel already has a header, so the NetEnroll brand
          row would be a second one. An agency's own logo is the exception: it
          is the only place a white-labelled user sees whose portal this is, so
          the drawer carries it too, sized down. */}
      {drawer ? (
        brand ? (
          <div className="flex shrink-0 items-center border-b border-rule px-4 py-3">
            <BrandLockup brand={brand} tone="light" size="sm" />
          </div>
        ) : null
      ) : brand ? (
        /*
         * The agency's lockup, with room: an app-icon tile and the wordmark,
         * both cut from the supplied artwork (see BrandLockup). The block is
         * taller than the topbar on purpose -- the navy column is its own
         * surface, so its rule does not have to meet the topbar's.
         */
        <div className="flex h-[88px] shrink-0 items-center border-b border-rule px-5">
          <Link
            href="/dashboard"
            className="flex items-center rounded-control"
            aria-label={`${brand.name} home`}
          >
            <BrandLockup brand={brand} tone="dark" />
          </Link>
        </div>
      ) : (
        <div className="flex h-16 shrink-0 items-center border-b border-rule px-5">
          {/* Nothing until the session says whose portal this is: drawing
              NetEnroll's lockup and then swapping it for an agency's is the
              flash a white-labelled user must never see. */}
          {brandSettled ? (
            <Link href="/dashboard" className="rounded-control" aria-label="NetEnroll home">
              {/* The whole lockup, tagline included: at 128px the
                  PAY-PER-APPLICATION line still reads. h-16 matches the topbar
                  beside it (topbar.tsx), so the two bottom rules meet in a
                  single line across the top of the page. Only the nav below
                  scrolls; this block stays put. */}
              <Logo width={128} />
            </Link>
          ) : null}
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
          {(!isPlatformAdmin || previewing) && hasFullAccess ? (
            <PortalBadge label="Agency portal" />
          ) : null}
          {isPublisherOnly ? <PortalBadge label="Publisher portal" /> : null}
          {isBuyerOnly ? <PortalBadge label="Buyer portal" /> : null}
          {isAgentOnly ? <PortalBadge label="Agent portal" /> : null}

          {groups.map((group, gi) => (
            <React.Fragment key={group.label ?? `group-${gi}`}>
              {/*
                The line between what the agency has and what it could turn
                on. Everything below it is locked, so the working menu reads as
                complete on its own.
              */}
              {group.label === FIRST_UPGRADE_GROUP ? (
                <div className="mt-6 border-t border-rule px-3 pt-4">
                  <p className="text-[11px] font-semibold uppercase leading-none tracking-[0.06em] text-brand-ink">
                    Unlock more
                  </p>
                </div>
              ) : null}
              <div
                className={cn(gi > 0 && (group.label === FIRST_UPGRADE_GROUP ? 'mt-3' : 'mt-5'))}
              >
                {group.label ? (
                  <h2 className="flex items-center gap-1.5 px-3 pb-1.5 t-label text-ink-3">
                    {group.label}
                    {isLockedGroup(group) ? (
                      <Lock className="h-3 w-3 opacity-70" aria-label="Upgrade required" />
                    ) : null}
                  </h2>
                ) : null}
                <ul className="space-y-0.5">
                  {group.items.map(item => (
                    <li key={`${item.name}-${item.href}`}>
                      <NavLink item={item} active={item.href === activeHref} drawer={drawer} />
                    </li>
                  ))}
                </ul>
              </div>
            </React.Fragment>
          ))}
        </div>
      </nav>
    </div>
  );
}
