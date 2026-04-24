import { MusicSidebar } from '@/features/music/components/music-sidebar';
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
    <div className="music-console flex h-screen overflow-hidden m-grid-bg">
      <MusicSidebar />
      <div className="flex flex-1 flex-col h-screen overflow-hidden">
        <header className="flex h-16 items-center justify-between border-b border-[var(--m-border-2)] m-bg-surface px-6 z-10">
          <div className="flex flex-1 items-center">
            {/* Optional Top Search / Controls could go here */}
          </div>
          <div className="flex items-center gap-4 text-sm m-text-muted">
            {/* Optional profile / notifications */}
            <span>Organization: Demo Label</span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto relative z-0 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
