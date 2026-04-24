import '@/features/music/styles/music-theme.css';

/**
 * Music Console Layout
 * Wraps all /music-console/* pages in the scoped .music-console
 * theme class. The base Hopwhistle dashboard layout is unaffected.
 */
export default function MusicConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="music-console m-grid-bg">
      {children}
    </div>
  );
}
