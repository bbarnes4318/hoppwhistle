import { MusicSidebar } from '@/features/music/components/music-sidebar';
import { MusicAuthGuard } from '@/features/music/components/music-auth-guard';
import '@/features/music/styles/music-theme.css';

/**
 * Music Console Layout
 * Wraps all /music-console/* pages in the scoped .music-console
 * theme class, acting as a standalone portal separate from the base dashboard.
 */
export default function MusicConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MusicAuthGuard>
      <div className="music-console flex h-screen w-screen overflow-hidden m-grid-bg">
        {/* Sidebar stays fixed */}
        <div className="shrink-0">
          <MusicSidebar />
        </div>
        
        <div className="flex flex-1 flex-col h-screen overflow-hidden min-w-0">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--m-border-2)] m-bg-surface px-6 z-10">
            <div className="flex flex-1 items-center min-w-0">
              {/* Optional Top Search / Controls could go here */}
            </div>
            <div className="flex items-center gap-4 text-sm m-text-muted shrink-0 ml-4 whitespace-nowrap">
              {/* Optional profile / notifications */}
              <span>Organization: Demo Label</span>
            </div>
          </header>
          
          {/* Main content can scroll vertically */}
          <main className="flex-1 overflow-y-auto relative z-0">
            <div className="max-w-[1360px] mx-auto w-full px-8 md:px-12 py-8 md:py-12">
              {children}
            </div>
          </main>
        </div>
      </div>
    </MusicAuthGuard>
  );
}
