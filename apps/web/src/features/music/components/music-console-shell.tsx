'use client';

import { usePathname } from 'next/navigation';
import React from 'react';

import { MusicAuthGuard } from './music-auth-guard';
import { MusicSidebar } from './music-sidebar';

import { cn } from '@/lib/utils';

export function MusicConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Breadcrumb mapping
  const getBreadcrumbName = () => {
    if (pathname === '/music-console') return 'Dashboard';
    if (pathname?.startsWith('/music-console/campaigns')) return 'Fan Campaigns';
    if (pathname?.startsWith('/music-console/map')) return 'Campaign Map';
    if (pathname?.startsWith('/music-console/fans')) return 'Fan Database';
    if (pathname?.startsWith('/music-console/proof')) return 'Voice Proof';
    if (pathname?.startsWith('/music-console/reports')) return 'Campaign Reports';
    if (pathname?.startsWith('/music-console/settings')) return 'Settings';
    return 'Overview';
  };

  return (
    <div className="music-console m-dark-mode flex h-screen w-screen overflow-hidden transition-colors duration-200 bg-[var(--m-bg)]">
      <MusicAuthGuard>
        {/* Sidebar stays fixed */}
        <div className="shrink-0 h-full">
          <MusicSidebar />
        </div>

        <div className="flex flex-1 flex-col h-screen overflow-hidden min-w-0">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--m-border-2)] bg-[var(--m-surface)] px-6 transition-colors duration-200">
            <div className="flex flex-1 items-center min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--m-text-2)]">
                <span className="text-[var(--m-muted)] tracking-wider uppercase text-[10px]">RPS Media Network OS</span>
                <span className="text-[var(--m-dim)]">/</span>
                <span className="text-[var(--m-text)] font-bold">{getBreadcrumbName()}</span>
              </div>
            </div>
            {/* Live Status Area */}
            <div className="flex items-center gap-3 shrink-0 ml-4">
              <div className="flex items-center gap-3 shrink-0 text-[10px] font-semibold text-[var(--m-text-2)]">
                {/* Network Live */}
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[rgba(16,185,129,0.06)] border border-[rgba(16,185,129,0.15)] rounded text-[#10b981]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#10b981] animate-pulse" />
                  <span className="text-[9px] uppercase tracking-wider">Network: Live</span>
                </div>
                
                {/* Stations */}
                <div className="hidden sm:flex items-center gap-1 px-2 py-0.5 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded text-[var(--m-text)]">
                  <span className="text-[9px] text-[var(--m-muted)] uppercase tracking-wider">Stations:</span>
                  <span className="font-bold">25</span>
                </div>

                {/* Media Inventory */}
                <div className="hidden md:flex items-center gap-1 px-2 py-0.5 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded text-[var(--m-text)]">
                  <span className="text-[9px] text-[var(--m-muted)] uppercase tracking-wider">Inventory:</span>
                  <span className="font-bold text-[#00a3ff]">Active</span>
                </div>

                {/* Label */}
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded shadow-xs text-[var(--m-text)]">
                  <span className="text-[9px] text-[var(--m-muted)] uppercase tracking-wider">Node:</span>
                  <span className="font-bold text-[10px]">Demo Label / RPS Records</span>
                </div>
              </div>
            </div>
          </header>

          {/* Main content scrolls vertically, except for Map page which is full viewport */}
          <main className={cn("flex-1 relative bg-[var(--m-bg)]", (pathname === '/music-console/map' || pathname === '/music-console/customer-demo') ? "h-[calc(100vh-56px)] overflow-hidden flex flex-col" : "overflow-y-auto")}>
            {(pathname === '/music-console/map' || pathname === '/music-console/customer-demo') ? (
              <div className="w-full h-full flex-grow flex flex-col">{children}</div>
            ) : (
              <div className="max-w-[1600px] mx-auto w-full px-5 lg:px-6 py-5">{children}</div>
            )}
          </main>
        </div>
      </MusicAuthGuard>
    </div>
  );
}
