import { MusicConsoleShell } from '@/features/music/components/music-console-shell';
import '@/features/music/styles/music-theme.css';

/**
 * Music Console Layout
 * Wraps all /music-console/* pages in the scoped .music-console
 * theme class, acting as a standalone portal separate from the base dashboard.
 * Defers client pathname checks and frame overrides to MusicConsoleShell client wrapper.
 */
export default function MusicConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <MusicConsoleShell>
      {children}
    </MusicConsoleShell>
  );
}
