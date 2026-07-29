'use client';

import { Bell, LogOut, Search, Settings as SettingsIcon, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/use-auth';

export function Header() {
  const router = useRouter();
  const { user, tenantName, userRoles } = useAuth();
  const searchRef = useRef<HTMLInputElement>(null);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);

  // ⌘K / Ctrl-K focuses search — expected in any serious console
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.email || 'Account';
  const initials =
    (user?.firstName?.[0] || user?.email?.[0] || '?').toUpperCase() +
    (user?.lastName?.[0]?.toUpperCase() || '');

  const signOut = () => {
    localStorage.removeItem('token');
    router.replace('/login');
  };

  return (
    <header className="glass flex h-14 flex-shrink-0 items-center justify-between gap-4 border-b border-border px-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <input
            ref={searchRef}
            type="search"
            id="global-search"
            name="global-search"
            placeholder="Search calls, numbers, campaigns…"
            className="h-9 w-full rounded-md border border-border bg-surface/50 pl-9 pr-14 text-[13px] shadow-inset transition-all duration-150 ease-premium placeholder:text-muted-foreground/60 hover:border-border-strong focus-visible:border-primary/50 focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 [&::-webkit-search-cancel-button]:hidden"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 select-none rounded border border-border bg-surface-raised px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground/80 sm:block">
            {isMac ? '⌘' : 'Ctrl '}K
          </kbd>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1.5">
        {tenantName && (
          <div className="mr-1 hidden items-center gap-2 rounded-full border border-border bg-surface/60 py-1 pl-2.5 pr-3 lg:flex">
            <span className="pulse-dot" aria-hidden />
            <span className="max-w-[180px] truncate text-[11px] font-medium text-muted-foreground">
              {tenantName}
            </span>
          </div>
        )}

        <Button variant="ghost" size="icon-sm" aria-label="Notifications" className="relative">
          <Bell className="h-4 w-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Account menu"
              className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-raised text-[10px] font-bold text-foreground transition-all duration-150 ease-premium hover:border-primary/40 hover:shadow-ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {user ? initials : <User className="h-4 w-4" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <div className="truncate text-[13px] font-semibold text-foreground">
                {displayName}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">{user?.email}</div>
              {tenantName && (
                <div className="mt-2 truncate rounded border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground">
                  {tenantName}
                  {userRoles[0] ? ` · ${userRoles[0].charAt(0)}${userRoles[0].slice(1).toLowerCase()}` : ''}
                </div>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" className="cursor-pointer">
                <SettingsIcon className="mr-2 h-3.5 w-3.5" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={signOut} className="cursor-pointer text-destructive">
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
