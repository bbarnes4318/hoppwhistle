import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Hopwhistle Music — Streaming Analytics & Promotion Platform',
  description:
    'Real-time streaming analytics, fan engagement intelligence, and campaign management for the music industry. Powered by Hopwhistle.',
};

export default function MusicLandingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
