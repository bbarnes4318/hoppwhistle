'use client';

import { AlertTriangle, Bell, LogOut, Search, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

import { CommandPalette, useCommandPalette } from './command-palette';
import { MobileNav } from './mobile-nav';
import { pageTitleFor } from './page-title';

/**
 * Topbar: 64px, the page title at the title step on the left; the command
 * palette trigger, notifications and the account menu on the right.
 *
 * The search box is a button, not an input. It opens the palette, which is
 * where search actually happens — a second input that behaves differently from
 * cmd-K would be two search experiences pretending to be one.
 */
export function Topbar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { open, setOpen } = useCommandPalette();

  const title = pageTitleFor(pathname);

  // The tab is named after the page, then the product, so a floor with six
  // NetEnroll tabs open can tell them apart. Set here because every page under
  // the dashboard is a client component and none carries its own metadata.
  React.useEffect(() => {
    document.title = title ? `${title} · NetEnroll` : 'NetEnroll';
  }, [title]);

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

  const initials =
    [user?.firstName, user?.lastName]
      .filter(Boolean)
      .map(n => n?.[0]?.toUpperCase())
      .join('') ||
    user?.email?.[0]?.toUpperCase() ||
    '?';

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-rule bg-surface px-4 sm:gap-3 sm:px-6 min-[1440px]:px-8">
        <MobileNav />
        <h1 className="t-title min-w-0 flex-1 truncate text-ink">{title}</h1>

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
              title="The agency switcher could not be loaded. Everything else on this page still works. Please reload, and let NetEnroll know if it keeps happening."
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
            'hidden h-9 items-center gap-2 rounded-control border border-rule bg-paper px-3 sm:flex [&>svg]:h-4 [&>svg]:w-4',
            'w-[260px] text-left t-body text-ink-3 transition-colors duration-150 hover:border-rule-strong hover:bg-surface hover:text-ink-2',
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

        {/* Below sm the labelled button is replaced by an icon. */}
        <Tooltip content="Open command palette" className="sm:hidden">
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
          <Tooltip content="Account menu" align="end">
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
          </Tooltip>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="t-body">
              <span className="block truncate text-ink">
                {[user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Signed in'}
              </span>
              <span className="block truncate t-meta font-normal text-ink-3">{user?.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" className="t-body">
                <User aria-hidden className="mr-2 h-3.5 w-3.5" />
                Settings
              </Link>
            </DropdownMenuItem>
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
