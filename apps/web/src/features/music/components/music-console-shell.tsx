'use client';

import { usePathname } from 'next/navigation';
import React from 'react';

import { cn } from '@/lib/utils';

import { MusicAuthGuard } from './music-auth-guard';
import { MusicSidebar } from './music-sidebar';

export function MusicConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Breadcrumb mapping
  const getBreadcrumbName = () => {
    if (pathname === '/music-console') return 'Dashboard';
    if (pathname?.startsWith('/music-console/campaigns')) return 'Fan Campaigns';
    if (pathname?.startsWith('/music-console/map')) return 'Campaign Map';
    if (pathname?.startsWith('/music-console/voice')) return 'Voice AI';
    if (pathname?.startsWith('/music-console/fans')) return 'Fan Database';
    if (pathname?.startsWith('/music-console/proof')) return 'Voice Proof';
    if (pathname?.startsWith('/music-console/reports')) return 'Campaign Reports';
    if (pathname?.startsWith('/music-console/settings')) return 'Settings';
    return 'Overview';
  };

  return (
    <div className="music-console flex h-screen w-screen overflow-hidden transition-colors duration-200 bg-[var(--m-bg)]">
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
            {/* Live Status Capsule */}
            <div className="flex items-center gap-3 shrink-0 ml-4">
              <div className="flex items-center gap-3 px-3 py-1 bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded-full text-[10px] font-semibold text-[var(--m-text-2)] shadow-xs">
                {/* Network Live */}
                <div className="flex items-center gap-1.5 text-[#10b981] font-bold">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#10b981] animate-pulse" />
                  <span className="text-[9px] uppercase tracking-wider">LIVE</span>
                </div>
                
                <span className="h-3.5 w-[1px] bg-[var(--m-border-2)]" />

                {/* Stations */}
                <div className="hidden sm:flex items-center gap-1.5">
                  <span className="text-[9px] text-[var(--m-muted)] font-bold uppercase tracking-wider">STATIONS:</span>
                  <span className="font-extrabold text-[var(--m-text)]">25</span>
                </div>

                <span className="hidden sm:inline h-3.5 w-[1px] bg-[var(--m-border-2)]" />

                {/* Media Inventory */}
                <div className="hidden md:flex items-center gap-1.5">
                  <span className="text-[9px] text-[var(--m-muted)] font-bold uppercase tracking-wider">INVENTORY:</span>
                  <span className="font-extrabold text-[var(--m-accent)]">Active</span>
                </div>

                <span className="hidden md:inline h-3.5 w-[1px] bg-[var(--m-border-2)]" />

                {/* Label */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-[var(--m-muted)] font-bold uppercase tracking-wider">NODE:</span>
                  <span className="font-extrabold text-[var(--m-text)]">Demo Label / RPS Records</span>
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
