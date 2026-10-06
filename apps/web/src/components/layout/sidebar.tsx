'use client';

import { AlertTriangle, Lock, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
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
  firstUpgradeGroupOf,
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
function LockedNavItem({
  item,
  drawer,
  collapsed = false,
  hint,
}: {
  item: NavItem;
  drawer: boolean;
  collapsed?: boolean;
  hint?: RailHintHandlers;
}) {
  // A white-labelled agency's people do not know NetEnroll by name.
  const { brand } = useBrand();
  const { isChild, parentBrandName } = useAuth();
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
          onFocus={hint?.show(`${item.name} — upgrade`)}
          onBlur={hint?.hide}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          className={cn(
            collapsed
              ? 'group relative flex h-10 w-10 items-center justify-center rounded-control text-ink-3'
              : 'group flex h-10 w-full items-center gap-3 rounded-lg pl-3 pr-1.5 text-left text-[13px] font-medium text-ink-3',
            // The label-to-pill gap is the flex gap; `ml-auto` only pushes.
            '[@media(pointer:coarse)]:h-11',
            'transition-colors duration-150 ease-out ne-motion hover:bg-sunken',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            open && 'bg-sunken'
          )}
        >
          <Icon className="h-[18px] w-[18px] shrink-0 opacity-60" />
          {collapsed ? (
            <Lock
              className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 text-brand-ink"
              aria-hidden="true"
            />
          ) : null}
          {/*
            Two tight lines rather than an ellipsis for the longest names --
            "VOIP Carrier Routing" and "Onboard an Agency" do not fit beside the
            pill in a 248px rail, and 2 x 1.2 x 14px still sits inside the h-9
            row, so the item keeps a normal item's height.
          */}
          <span
            className={cn(
              'line-clamp-2 min-w-0 break-words leading-[1.2] opacity-80',
              collapsed && 'sr-only'
            )}
          >
            {item.name}
          </span>
          {/*
            The lock rides inside the pill rather than beside the label: the
            rail is 248px, and a lock of its own cost the label the room it
            needed -- "Publishers" read "Publish…".
          */}
          <span
            className={cn(
              'ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full bg-brand-tint px-1.5 py-0.5 text-[11px] font-semibold leading-none text-brand-ink',
              collapsed && 'hidden'
            )}
          >
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
          {isChild
            ? `Contact ${parentBrandName ?? 'your parent agency'} to turn this on for your agency.`
            : `Ask your ${brand ? '' : 'NetEnroll '}account manager to turn this on for your agency.`}
        </p>
      </PopoverContent>
    </Popover>
  );
}

function NavLink({
  item,
  active,
  drawer = false,
  collapsed = false,
  hint,
}: {
  item: NavItem;
  active: boolean;
  drawer?: boolean;
  /** The 56px rail: the icon alone, its name in a hint and to screen readers. */
  collapsed?: boolean;
  hint?: RailHintHandlers;
}) {
  const Icon = item.icon;

  if (item.locked)
    return <LockedNavItem item={item} drawer={drawer} collapsed={collapsed} hint={hint} />;

  if (item.pending) {
    return (
      <span
        className={cn(
          'flex h-10 items-center rounded-lg text-[13px] font-medium text-ink-3',
          collapsed ? 'w-10 justify-center' : 'gap-3 px-3'
        )}
        title={`${item.name} — not built yet`}
        aria-disabled="true"
      >
        <Icon className="h-[18px] w-[18px] shrink-0 opacity-60" />
        <span className={collapsed ? 'sr-only' : 'truncate'}>{item.name}</span>
        {collapsed ? null : (
          <span className="ml-auto t-meta shrink-0 rounded-full bg-sunken px-2 text-ink-3">
            Soon
          </span>
        )}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      title={collapsed ? undefined : item.title}
      aria-label={collapsed ? item.name : undefined}
      aria-current={active ? 'page' : undefined}
      onPointerEnter={collapsed ? hint?.show(item.name) : undefined}
      onPointerLeave={collapsed ? hint?.hide : undefined}
      onFocus={collapsed ? hint?.show(item.name) : undefined}
      onBlur={collapsed ? hint?.hide : undefined}
      className={cn(
        'group relative flex h-10 items-center rounded-lg text-[13px] transition-colors duration-150 ease-out ne-motion',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        collapsed ? 'w-10 justify-center' : 'gap-3 px-3 [@media(pointer:coarse)]:h-11',
        active
          ? // A lifted surface with an inset hairline and a 3px accent bar, not a
            // saturated block: the item is marked, the rail is not repainted.
            cn(
              'bg-brand-tint font-semibold text-ink shadow-[inset_0_0_0_1px_var(--rule-strong)] before:absolute before:bottom-2 before:top-2 before:w-[3px] before:rounded-r-full before:bg-brand',
              collapsed ? 'before:-left-2' : 'before:-left-3'
            )
          : 'font-medium text-ink-2 hover:bg-sunken hover:text-ink'
      )}
    >
      <Icon
        className={cn(
          'h-[18px] w-[18px] shrink-0 transition-colors',
          active ? 'text-brand' : 'text-ink-3 group-hover:text-ink-2'
        )}
      />
      {collapsed ? null : <span className="truncate">{item.name}</span>}
    </Link>
  );
}

/**
 * The collapsed rail's labels. The nav column scrolls, which clips anything
 * drawn outside it, so the name is painted once, `fixed`, beside the item the
 * pointer or focus is on. It is decoration: every item already carries its
 * name as its accessible label.
 */
interface RailHintHandlers {
  show: (label: string) => (event: React.SyntheticEvent<HTMLElement>) => void;
  hide: () => void;
}

function useRailHint(): [{ label: string; top: number } | null, RailHintHandlers] {
  const [hint, setHint] = React.useState<{ label: string; top: number } | null>(null);
  const handlers = React.useMemo<RailHintHandlers>(
    () => ({
      show: label => event => {
        const rect = event.currentTarget.getBoundingClientRect();
        setHint({ label, top: rect.top + rect.height / 2 });
      },
      hide: () => setHint(null),
    }),
    []
  );
  return [hint, handlers];
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
    <div className="mb-1 flex items-center gap-2 px-3 pb-3 pt-2 text-[10px] font-semibold uppercase leading-none tracking-[0.1em] text-ink-3">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
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
    isWhiteLabel,
    isBuyerOnly,
    isPublisherOnly,
    isAgentOnly,
    isManagerOnly,
    isReadonlyOnly,
    canViewRecordings,
    upgrades,
    isChild,
    isWhiteLabelAgent,
    salesWorkspace,
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
        isWhiteLabel,
        isPublisherOnly,
        isBuyerOnly,
        isAgentOnly,
        isManagerOnly,
        isReadonlyOnly,
        canViewRecordings,
        upgrades,
        isChild,
        isWhiteLabelAgent,
        salesWorkspace,
        brandTheme: user?.brand?.theme ?? null,
      }),
    [
      isPlatformAdmin,
      previewing,
      hasFullAccess,
      isWhiteLabel,
      isPublisherOnly,
      isBuyerOnly,
      isAgentOnly,
      isManagerOnly,
      isReadonlyOnly,
      canViewRecordings,
      upgrades,
      isChild,
      isWhiteLabelAgent,
      salesWorkspace,
      user?.brand?.theme,
    ]
  );

  const drawer = variant === 'drawer';
  // Read off the groups: `Call Network` is an upgrade group for a normal
  // agency and a working one on the white-label tier.
  const upgradeGroup = firstUpgradeGroupOf(groups);
  const activeHref = activeHrefFor(pathname, groups);
  const { brand, settled: brandSettled } = useBrand();

  /*
   * ── A 56px rail, opened on request ─────────────────────────────────────────
   *
   * The work in this product is horizontal -- the quoter's form, its carrier
   * list and the premium side by side -- and a 232px column of labels cost it
   * a fifth of a laptop screen on every page. So the rail is icons, with each
   * name in a hint, and it opens to its full width only when asked: OVER the
   * page, so the page never reflows, and it closes on navigation, Escape or a
   * click outside. The nav it draws is exactly `navFor`'s; nothing about who
   * sees what changes here.
   */
  const [expanded, setExpanded] = React.useState(false);
  const collapsed = !drawer && !expanded;
  const [hint, hintHandlers] = useRailHint();
  const railRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => setExpanded(false), [pathname]);
  React.useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      // A locked item's card is portalled outside the rail.
      if (target instanceof Element && target.closest('[data-radix-popper-content-wrapper]'))
        return;
      if (railRef.current && target && !railRef.current.contains(target)) setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [expanded]);
  React.useEffect(() => {
    if (!collapsed) hintHandlers.hide();
  }, [collapsed, hintHandlers]);

  const hasProblem = status === 'failed' || hasResolvedNoRole;

  const brandRow = drawer ? null : (
    /*
     * The brand, at the topbar's height so the two bottom rules meet in one
     * line. Collapsed it is the agency's square mark; open, its wordmark (an
     * agency's straight on its navy). Nothing until the session says whose
     * portal this is: drawing NetEnroll's and then swapping it for an
     * agency's is the flash a white-labelled user must never see.
     */
    <div
      className={cn(
        'flex shrink-0 items-center border-b border-rule',
        collapsed
          ? 'h-[52px] justify-center'
          : // A theme whose rail carries its full lockup (wordmark and tagline)
            // gets a taller row for it when the rail is open.
            brand?.lockupOnDark
            ? 'h-[116px] justify-center px-6'
            : 'h-[52px] px-4'
      )}
      data-brand-row=""
    >
      {brand ? (
        <Link
          href="/dashboard"
          className="flex items-center rounded-control"
          aria-label={`${brand.name} home`}
        >
          {collapsed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.markSmall}
              alt=""
              width={28}
              height={28}
              className="h-7 w-7 rounded-[6px] object-contain"
              draggable={false}
              data-testid="brand-mark"
            />
          ) : (
            <BrandLockup
              brand={brand}
              surface="dark"
              location="sidebar"
              className={brand.lockupOnDark ? undefined : 'w-[160px]'}
            />
          )}
        </Link>
      ) : brandSettled ? (
        <Link href="/dashboard" className="rounded-control" aria-label="NetEnroll home">
          {collapsed ? (
            // NetEnroll has no square mark: its monogram, in the lockup's own
            // two colours ("net" in ink, "Enroll" in the brand green).
            <span
              aria-hidden="true"
              translate="no"
              data-testid="logo-mark"
              className="flex h-8 w-8 items-center justify-center rounded-[7px] border border-rule bg-surface text-[15px] font-bold leading-none tracking-[-0.04em]"
            >
              <span className="text-ink">n</span>
              <span className="text-brand-ink">E</span>
            </span>
          ) : (
            <Logo width={112} />
          )}
        </Link>
      ) : null}
    </div>
  );

  const panel = (
    <div
      ref={drawer ? undefined : railRef}
      className={cn(
        'flex h-full min-h-0 flex-col bg-surface',
        drawer
          ? 'w-full'
          : cn(
              'absolute inset-y-0 left-0 z-40 border-r border-rule transition-[width] duration-150 ease-out ne-motion motion-reduce:transition-none',
              expanded ? cn(brand?.lockupOnDark ? 'w-[264px]' : 'w-[232px]', 'shadow-pop') : 'w-14'
            )
      )}
      /*
       * An agency brand draws the rail in its navy. The attribute re-scopes the
       * design tokens for this subtree (globals.css), so nothing below it needs
       * to know. In the drawer the panel itself carries the attribute
       * (mobile-nav.tsx), so the whole drawer is the same navy.
       */
      data-brand-nav={brand && !drawer ? '' : undefined}
      data-rail={drawer ? undefined : expanded ? 'expanded' : 'collapsed'}
    >
      {brandRow}

      <nav
        aria-label="Main"
        className={cn(
          'custom-scrollbar flex-1 overflow-y-auto overflow-x-hidden pb-3',
          collapsed ? 'px-2 pt-3' : drawer ? 'px-3 pb-4 pt-6' : 'px-3 pt-4'
        )}
      >
        <div className={cn(collapsed && 'flex flex-col items-center')}>
          {status === 'resolving' ? <ResolvingNotice /> : null}
          {collapsed && hasProblem ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={status === 'failed' ? 'Your menu could not load' : 'No role assigned'}
              className="mb-2 flex h-10 w-10 items-center justify-center rounded-control text-ringing-ink hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <AlertTriangle className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          ) : null}
          {!collapsed && status === 'failed' ? <UnreachableNotice /> : null}
          {!collapsed && hasResolvedNoRole ? <NoRoleNotice /> : null}
          {!collapsed && isPublisherOnly ? <PortalBadge label="Publisher portal" /> : null}
          {!collapsed && isBuyerOnly ? <PortalBadge label="Buyer portal" /> : null}

          {groups.map((group, gi) => {
            const startsUpgrades = upgradeGroup !== null && group.label === upgradeGroup;
            return (
              <React.Fragment key={group.label ?? `group-${gi}`}>
                {/*
                  The line between what the agency has and what it could turn
                  on. Everything below it is locked, so the working menu reads
                  as complete on its own.
                */}
                {startsUpgrades && !collapsed ? (
                  <div className="mt-7 border-t border-rule px-3 pt-4">
                    <p className="text-[10px] font-semibold uppercase leading-none tracking-[0.1em] text-ink-3">
                      Unlock more
                    </p>
                  </div>
                ) : null}
                <div
                  className={cn(
                    collapsed
                      ? // Collapsed, a group is a hairline above its icons.
                        gi > 0 && 'mt-2 w-8 border-t border-rule pt-2'
                      : gi > 0 && (startsUpgrades ? 'mt-3' : drawer ? 'mt-7' : 'mt-5'),
                    collapsed && 'flex flex-col items-center'
                  )}
                >
                  {group.label ? (
                    <h2
                      className={cn(
                        collapsed
                          ? 'sr-only'
                          : 'flex items-center gap-1.5 px-3 pb-2 text-[10px] font-semibold uppercase leading-none tracking-[0.1em] text-ink-3'
                      )}
                    >
                      {group.label}
                      {isLockedGroup(group) ? (
                        <Lock className="h-3 w-3 opacity-70" aria-label="Upgrade required" />
                      ) : null}
                    </h2>
                  ) : null}
                  <ul className={cn(collapsed ? 'flex flex-col items-center gap-1' : 'space-y-1')}>
                    {group.items.map(item => (
                      <li key={`${item.name}-${item.href}`}>
                        <NavLink
                          item={item}
                          active={item.href === activeHref}
                          drawer={drawer}
                          collapsed={collapsed}
                          hint={hintHandlers}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </nav>

      {drawer ? null : (
        <div
          className={cn(
            'flex shrink-0 border-t border-rule py-2',
            collapsed ? 'justify-center' : 'px-3'
          )}
        >
          <button
            type="button"
            onClick={() => setExpanded(open => !open)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
            onPointerEnter={collapsed ? hintHandlers.show('Expand navigation') : undefined}
            onPointerLeave={collapsed ? hintHandlers.hide : undefined}
            onFocus={collapsed ? hintHandlers.show('Expand navigation') : undefined}
            onBlur={collapsed ? hintHandlers.hide : undefined}
            className={cn(
              'flex h-9 items-center gap-2 rounded-control text-[13px] font-medium text-ink-3 transition-colors duration-150 hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              collapsed ? 'w-10 justify-center' : 'w-full px-3'
            )}
          >
            {expanded ? (
              <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden="true" />
            ) : (
              <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden="true" />
            )}
            {expanded ? <span>Collapse</span> : null}
          </button>
        </div>
      )}
    </div>
  );

  if (drawer) return panel;

  return (
    // The rail's own 56px column. The panel inside it is positioned, so
    // opening it lays it over the page rather than pushing the page over.
    <div className="relative h-full w-14 shrink-0">
      {panel}
      {collapsed && hint ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed left-[62px] z-50 -translate-y-1/2 whitespace-nowrap rounded-[6px] bg-ink px-2 py-1 text-xs font-medium text-surface shadow-pop"
          style={{ top: hint.top }}
        >
          {hint.label}
        </div>
      ) : null}
    </div>
  );
}
