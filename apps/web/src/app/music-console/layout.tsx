import { StaffOnlyGuard } from '@/components/auth/staff-only-guard';
import { MusicConsoleShell } from '@/features/music/components/music-console-shell';
import '@/features/music/styles/music-theme.css';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * Music Console Layout
 * Wraps all /music-console/* pages in the scoped .music-console
 * theme class, acting as a standalone portal separate from the base dashboard.
 * Defers client pathname checks and frame overrides to MusicConsoleShell client wrapper.
 *
 * `StaffOnlyGuard` sits OUTSIDE the shell, not inside it beside `MusicAuthGuard`.
 * The console is NetEnroll's own direct-to-fan product and is listed in
 * `lib/staff-only-routes.ts`, but it is mounted outside the `(dashboard)` route
 * group and so never met that layout's redirect. Guarding outside the shell
 * means an agency principal who opens the URL mounts no sidebar, no live status
 * poll and no map tiles on the way to being sent home -- `MusicAuthGuard`
 * inside answers a different question (is anyone signed in at all) and would
 * have let all of that render first.
 */
export default function MusicConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <StaffOnlyGuard>
      <MusicConsoleShell>{children}</MusicConsoleShell>
    </StaffOnlyGuard>
  );
}
