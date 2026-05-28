'use client';

import { usePathname } from 'next/navigation';

import { MusicAuthGuard } from '@/features/music/components/music-auth-guard';
import { MusicSidebar } from '@/features/music/components/music-sidebar';
import '@/features/music/styles/music-theme.css';

/**
 * Music Console Layout
 * Wraps all /music-console/* pages in the scoped .music-console theme.
 * Dynamically switches viewport scrolling based on active route to ensure
 * the cockpit remains 100vh-locked while list subpages scroll normally.
 */
export default function MusicConsoleLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDashboard = pathname === '/music-console';

  return (
    <div className="music-console flex h-screen w-screen overflow-hidden m-grid-bg">
      <MusicAuthGuard>
        {/* Sidebar stays fixed */}
        <div className="shrink-0">
          <MusicSidebar />
        </div>

        <div className="flex flex-1 flex-col h-screen overflow-hidden min-w-0">
          <header className="flex h-14 lg:h-16 shrink-0 items-center justify-between border-b border-[var(--m-border-2)] m-bg-surface px-6 z-10">
            <div className="flex flex-1 items-center min-w-0">
              {/* Optional Top Search / Controls could go here */}
            </div>
            <div className="flex items-center gap-4 text-sm m-text-muted shrink-0 ml-4 whitespace-nowrap">
              <span>Organization: Demo Label</span>
            </div>
          </header>

          {isDashboard ? (
            /* Cockpit Mode: page has full height and handles its own layout padding */
            <main className="flex-1 overflow-hidden relative z-0 flex flex-col min-h-0">
              {children}
            </main>
          ) : (
            /* Subpage Mode: standard scrollable container with responsive max-width */
            <main className="flex-1 overflow-y-auto relative z-0">
              <div className="max-w-[1320px] mx-auto w-full px-6 lg:px-8 py-6">{children}</div>
            </main>
          )}
        </div>
      </MusicAuthGuard>
    </div>
  );
}
