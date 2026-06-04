'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { MusicSidebar } from './music-sidebar';
import { MusicAuthGuard } from './music-auth-guard';

interface MusicConsoleShellProps {
  children: React.ReactNode;
}

export function MusicConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDarkPage = pathname === '/music-console/map' || pathname === '/music-console/proof';

  return (
    <div
      className={`music-console flex h-screen w-screen overflow-hidden m-grid-bg transition-colors duration-200 ${
        isDarkPage ? 'm-dark-mode bg-[#09090B]' : 'bg-[#FAF9F6]'
      }`}
    >
      <MusicAuthGuard>
        {/* Sidebar stays fixed */}
        <div className="shrink-0">
          <MusicSidebar />
        </div>

        <div className="flex flex-1 flex-col h-screen overflow-hidden min-w-0">
          <header className="flex h-14 lg:h-16 shrink-0 items-center justify-between border-b border-[var(--m-border-2)] m-bg-surface px-6 z-10 transition-colors duration-200">
            <div className="flex flex-1 items-center min-w-0">
              {/* Optional Top Search / Controls could go here */}
            </div>
            <div className="flex items-center gap-4 text-sm m-text-muted shrink-0 ml-4 whitespace-nowrap">
              <span>Organization: Demo Label</span>
            </div>
          </header>

          {/* Main content can scroll vertically */}
          <main className="flex-1 overflow-y-auto relative z-0">
            <div className="max-w-[1320px] mx-auto w-full px-6 lg:px-8 py-6">{children}</div>
          </main>
        </div>
      </MusicAuthGuard>
    </div>
  );
}
