'use client';

import { Bell, LogOut, Search, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

import { CommandPalette, useCommandPalette } from './command-palette';
import { pageTitleFor } from './page-title';

/**
 * Topbar: page title in the display face, the command palette trigger,
 * notifications and the account menu.
 *
 * The search box is a button, not an input. It opens the palette, which is
 * where search actually happens — a second input that behaves differently from
 * cmd-K would be two search experiences pretending to be one.
 */
export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const { open, setOpen } = useCommandPalette();

  const title = pageTitleFor(pathname);

  // macOS shows ⌘K, everything else Ctrl K. Read after mount so the server and
  // the client render the same thing.
  const [isMac, setIsMac] = React.useState(false);
  React.useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  const signOut = React.useCallback(() => {
    apiClient.clearToken();
    router.replace('/login');
  }, [router]);

  const initials =
    [user?.firstName, user?.lastName]
      .filter(Boolean)
      .map(n => n?.[0]?.toUpperCase())
      .join('') ||
    user?.email?.[0]?.toUpperCase() ||
    '?';

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-rule bg-surface px-4">
        <h1 className="t-title min-w-0 flex-1 truncate text-ink">{title}</h1>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            'hidden items-center gap-2 rounded-control border border-rule bg-paper px-2 py-1.5 sm:flex',
            'w-[240px] text-left t-body text-ink-3 hover:border-rule-strong hover:text-ink-2',
            'focus-visible:outline-none'
          )}
          aria-label="Open command palette"
        >
          <Search aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate">Search</span>
          <kbd className="shrink-0 rounded-control border border-rule bg-surface px-1 t-meta text-ink-3">
            {isMac ? '⌘' : 'Ctrl '}K
          </kbd>
        </button>

        {/* Below sm the labelled button is replaced by an icon. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-control p-1.5 text-ink-3 hover:bg-sunken hover:text-ink focus-visible:outline-none sm:hidden"
          aria-label="Open command palette"
        >
          <Search aria-hidden className="h-4 w-4" />
        </button>

        <button
          type="button"
          className="rounded-control p-1.5 text-ink-3 hover:bg-sunken hover:text-ink focus-visible:outline-none"
          aria-label="Notifications"
        >
          <Bell aria-hidden className="h-4 w-4" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                'bg-sunken t-meta font-medium text-ink-2',
                'hover:bg-rule focus-visible:outline-none'
              )}
              aria-label="Account menu"
            >
              {initials}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
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

      <CommandPalette open={open} onOpenChange={setOpen} />
    </>
  );
}
