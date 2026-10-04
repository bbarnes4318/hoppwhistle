'use client';

import { AlertTriangle, Bell, LogOut, Search, Settings, User } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { ErrorBoundary } from '@/components/error-boundary';
import {
  RolePreviewBanner,
  RolePreviewSwitcher,
} from '@/components/platform/role-preview-switcher';
import { TenantSwitcher } from '@/components/platform/tenant-switcher';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip } from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/use-auth';
import { useBrand } from '@/hooks/use-brand';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

import { CommandPalette, useCommandPalette } from './command-palette';
import { MobileNav } from './mobile-nav';
import { publishTopbarSlot, usePageTitleClaimed, useCurrentPageTitle } from './use-page-title';

/**
 * Topbar: the page header. The page's title on the left with its one-line
 * description under it; the page's own actions, then the command palette
 * trigger, notifications and the account menu on the right. A page's
 * <PageHeader> renders its description and actions into the slots here (see
 * `useTopbarSlots`), so every page is named in the same place at the same
 * size and the content area starts with the content.
 *
 * The search box is a button, not an input. It opens the palette, which is
 * where search actually happens — a second input that behaves differently from
 * cmd-K would be two search experiences pretending to be one.
 */
export function Topbar() {
  const { user, isBuyerOnly, isPublisherOnly, isAgentOnly, isWhiteLabelAgent } = useAuth();
  const { open, setOpen } = useCommandPalette();

  // A white-label owner's pages, and an agent's, are named as their own
  // sidebar names them: /dashboard is "Today" to both.
  const title = useCurrentPageTitle();
  // A page with a title of its own (a lead's name, an agreement's reference)
  // renders it into the heading in place of the nav name.
  const titleClaimed = usePageTitleClaimed();

  // The tab is named after the page, then the product, so a floor with six
  // NetEnroll tabs open can tell them apart. Set here because every page under
  // the dashboard is a client component and none carries its own metadata.
  //
  // The product is the agency's own name when it has a brand theme. Until the
  // session has said which, the tab carries the page alone rather than naming
  // a product it may be about to un-name.
  const { brand, productName, settled: brandSettled } = useBrand();
  React.useEffect(() => {
    if (!brandSettled) {
      if (title) document.title = title;
      return;
    }
    document.title = title ? `${title} · ${productName}` : productName;
  }, [title, productName, brandSettled]);

  // macOS shows ⌘K, everything else Ctrl K. Read after mount so the server and
  // the client render the same thing.
  const [isMac, setIsMac] = React.useState(false);
  React.useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  /*
   * A full page load, not a client-side replace. The session and platform
   * providers live in the root layout and hold who the LAST person was; a
   * router navigation keeps them mounted, so the next person to sign in on this
   * tab inherited the previous one's staff flag and saw the platform nav. A
   * real navigation discards every bit of in-memory state with the session.
   */
  const signOut = React.useCallback(() => {
    apiClient.clearToken();
    window.location.replace('/login');
  }, []);

  const titleSlot = React.useCallback(
    (el: HTMLElement | null) => publishTopbarSlot('title', el),
    []
  );
  const descriptionSlot = React.useCallback(
    (el: HTMLElement | null) => publishTopbarSlot('description', el),
    []
  );
  const actionsSlot = React.useCallback(
    (el: HTMLElement | null) => publishTopbarSlot('actions', el),
    []
  );

  const initials =
    [user?.firstName, user?.lastName]
      .filter(Boolean)
      .map(n => n?.[0]?.toUpperCase())
      .join('') ||
    user?.email?.[0]?.toUpperCase() ||
    '?';

  const accountTrigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          'bg-brand-tint t-meta font-semibold text-brand-ink',
          'ring-1 ring-inset ring-rule transition-colors duration-150 hover:ring-rule-strong',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        )}
        aria-label="Account menu"
      >
        {initials}
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <>
      <header className="flex h-[76px] shrink-0 items-center gap-2 border-b border-rule bg-surface px-4 sm:gap-3 sm:px-6 min-[1440px]:px-8">
        <MobileNav />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <h1 className="t-title flex min-w-0 items-center text-ink" data-page-title="">
            <span ref={titleSlot} className="min-w-0 truncate empty:hidden" />
            {titleClaimed ? null : <span className="min-w-0 truncate">{title}</span>}
          </h1>
          <div
            ref={descriptionSlot}
            data-page-description=""
            className="hidden min-w-0 truncate text-[13px] leading-5 text-ink-3 empty:hidden md:block [&>*]:block [&>*]:truncate [&>*:not(:last-child)]:hidden"
          />
        </div>

        {/* The page's own actions: a period switch, an export, "New ...".
            Docked from lg, where the search has folded to its icon; below that
            the page renders them at its top. */}
        <div
          ref={actionsSlot}
          data-page-actions=""
          className="hidden shrink-0 items-center gap-2 empty:hidden lg:flex"
        />
        <span
          aria-hidden
          className="hidden h-6 w-px shrink-0 bg-rule lg:block [[data-page-actions]:empty+&]:hidden"
        />

        {/* NetEnroll staff only, and rendered on every page: an operator must
            never be able to forget which agency's data they are looking at.
            Renders nothing for an agency user.

            Inside a boundary because this control sits in the layout: an
            uncaught error here unmounts the whole app from the root, which is
            how a single mis-read field locked every platform admin out of the
            portal. Contained, the operator keeps the sidebar, the topbar and
            every page — they lose only the switcher, and are told so. */}
        <ErrorBoundary
          label="The agency switcher"
          fallback={() => (
            <span
              role="alert"
              title={`The agency switcher could not be loaded. Everything else on this page still works. Please reload, and let ${brand ? 'your account manager' : 'NetEnroll'} know if it keeps happening.`}
              className="flex items-center gap-1.5 rounded-control border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive"
            >
              <AlertTriangle className="h-3 w-3" />
              Agency switcher unavailable
            </span>
          )}
        >
          <TenantSwitcher />
        </ErrorBoundary>

        {/* Beside the agency switcher, and only for staff who are inside an
            agency: which ROLE this agency is being looked at as. Same boundary
            treatment and the same reason — this control sits in the layout, so
            an uncaught error in it would unmount the whole app. */}
        <ErrorBoundary
          label="The role preview"
          fallback={() => (
            <span
              role="alert"
              title="The role preview could not be loaded. Everything else on this page still works."
              className="flex items-center gap-1.5 rounded-control border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive"
            >
              <AlertTriangle className="h-3 w-3" />
              Role preview unavailable
            </span>
          )}
        >
          <RolePreviewSwitcher />
        </ErrorBoundary>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            'hidden h-9 items-center gap-2 rounded-lg border border-rule bg-paper px-3 shadow-[inset_0_1px_0_rgba(16,24,40,0.02)] sm:flex [&>svg]:h-4 [&>svg]:w-4',
            // A page with actions docked beside it gets the room back below
            // 1600px: the icon button below stands in for the box.
            '[[data-page-actions]:not(:empty)~&]:max-[1599px]:hidden',
            'w-[220px] text-left t-body min-[1600px]:w-[280px] text-ink-3 transition-colors duration-150 hover:border-rule-strong hover:bg-surface hover:text-ink-2',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
          aria-label="Open command palette"
        >
          <Search aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate">Search</span>
          <kbd className="shrink-0 rounded-[6px] border border-rule bg-surface px-1.5 font-sans t-meta font-medium text-ink-3">
            {isMac ? '⌘' : 'Ctrl '}K
          </kbd>
        </button>

        {/* Below sm the labelled button is replaced by an icon, and so it is
            beside a page's docked actions below 1600px. */}
        <Tooltip
          content="Open command palette"
          className="sm:hidden [[data-page-actions]:not(:empty)~&]:max-[1599px]:inline-flex"
        >
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-control text-ink-2 [&_svg]:h-[18px] [&_svg]:w-[18px] transition-colors duration-150 hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open command palette"
          >
            <Search aria-hidden className="h-4 w-4" />
          </button>
        </Tooltip>

        <Tooltip content="Notifications">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-control text-ink-2 [&_svg]:h-[18px] [&_svg]:w-[18px] transition-colors duration-150 hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
            aria-label="Notifications"
          >
            <Bell aria-hidden className="h-4 w-4" />
          </button>
        </Tooltip>

        <DropdownMenu>
          {/* A white-label agent knows what their own initials open; the hover
              label is left off for them. The aria-label still names it. */}
          {isWhiteLabelAgent ? (
            accountTrigger
          ) : (
            <Tooltip content="Account menu" align="end">
              {accountTrigger}
            </Tooltip>
          )}
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="t-body">
              <span className="block truncate text-ink">
                {[user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Signed in'}
              </span>
              <span className="block truncate t-meta font-normal text-ink-3">{user?.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* Account (your own login and password) is every role's. Settings
                is the agency's, and a buyer or publisher portal login has none:
                linking them there only bounced them back to their portal. A
                agent (NetEnroll's own or a white-label agency's, e.g. Life Leads
                Plus) has everything they need under Account. */}
            <DropdownMenuItem asChild>
              <Link href="/account" className="t-body">
                <User aria-hidden className="mr-2 h-3.5 w-3.5" />
                Account
              </Link>
            </DropdownMenuItem>
            {isBuyerOnly || isPublisherOnly || isAgentOnly ? null : (
              <DropdownMenuItem asChild>
                <Link href="/settings" className="t-body">
                  <Settings aria-hidden className="mr-2 h-3.5 w-3.5" />
                  Settings
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="t-body">
              <LogOut aria-hidden className="mr-2 h-3.5 w-3.5" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Immediately below the top bar, full width, on every page, for as long as
          a preview lasts. Outside the <header> so it is a strip across the page
          rather than another chip in a crowded row — an operator must not be
          able to mistake a preview for the real thing, and must not have to hunt
          for the way out. Rendered inside a boundary for the same reason as the
          controls above. */}
      <ErrorBoundary label="The role-preview banner" fallback={() => null}>
        <RolePreviewBanner />
      </ErrorBoundary>

      <CommandPalette open={open} onOpenChange={setOpen} />
    </>
  );
}
