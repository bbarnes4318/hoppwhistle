'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { MusicSidebar } from './music-sidebar';
import { MusicAuthGuard } from './music-auth-guard';
import { cn } from '@/lib/utils';

interface MusicConsoleShellProps {
  children: React.ReactNode;
}

export function MusicConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDarkPage = pathname === '/music-console/map' || pathname === '/music-console/proof';

  // Breadcrumb mapping
  const getBreadcrumbName = () => {
    if (pathname === '/music-console') return 'Dashboard';
    if (pathname?.startsWith('/music-console/campaigns')) return 'Fan Campaigns';
    if (pathname?.startsWith('/music-console/map')) return 'Campaign Map';
    if (pathname?.startsWith('/music-console/fans')) return 'Fan Database';
    if (pathname?.startsWith('/music-console/proof')) return 'Proof Log';
    if (pathname?.startsWith('/music-console/reports')) return 'Campaign Reports';
    if (pathname?.startsWith('/music-console/settings')) return 'Settings';
    return 'Overview';
  };

  return (
    <div
      className={`music-console flex h-screen w-screen overflow-hidden transition-colors duration-200 ${
        isDarkPage ? 'm-dark-mode bg-[#09090B]' : 'bg-[var(--m-bg)]'
      }`}
    >
      <MusicAuthGuard>
        {/* Sidebar stays fixed */}
        <div className="shrink-0 h-full">
          <MusicSidebar />
        </div>

        <div className="flex flex-1 flex-col h-screen overflow-hidden min-w-0">
          <header className="flex h-14 lg:h-16 shrink-0 items-center justify-between border-b border-[var(--m-border-2)] bg-[var(--m-surface)] px-8 transition-colors duration-200">
            <div className="flex flex-1 items-center min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--m-text-2)]">
                <span className="text-[var(--m-muted)] tracking-wider uppercase text-[10px]">Console Workspace</span>
                <span className="text-[var(--m-dim)]">/</span>
                <span className="text-[var(--m-text)] font-bold">{getBreadcrumbName()}</span>
              </div>
            </div>
            {/* Styled Tenant / Organization Status Badge */}
            <div className="flex items-center gap-3 shrink-0 ml-4">
              <div className="flex items-center gap-2 px-3 py-1 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded text-xs font-semibold text-[var(--m-text-2)] shadow-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-[#8B5CF6] animate-pulse" />
                <span className="text-[9px] text-[var(--m-muted)] uppercase tracking-wider">Organization:</span>
                <span className="font-bold text-[var(--m-text)] text-[10px]">Demo Label</span>
              </div>
            </div>
          </header>

          {/* Main content scrolls vertically, except for Map page which is full viewport */}
          <main className={cn("flex-1 relative bg-[var(--m-bg)]", pathname === '/music-console/map' ? "h-[calc(100vh-56px)] lg:h-[calc(100vh-64px)] overflow-hidden flex flex-col" : "overflow-y-auto")}>
            {pathname === '/music-console/map' ? (
              <div className="w-full h-full flex-grow flex flex-col">{children}</div>
            ) : (
              <div className="max-w-7xl mx-auto w-full px-8 lg:px-10 py-8">{children}</div>
            )}
          </main>
        </div>
      </MusicAuthGuard>
    </div>
  );
}
