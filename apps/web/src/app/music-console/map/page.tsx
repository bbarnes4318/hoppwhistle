'use client';

import dynamic from 'next/dynamic';
import React from 'react';

// Load the music campaign map component with SSR disabled to prevent server-side WebGL canvas crashes
const DynamicMusicCampaignMap = dynamic(
  () => import('@/features/music/components/music-campaign-map'),
  {
    ssr: false,
    loading: () => (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-[#09090B] text-slate-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--m-accent)] mb-2" />
        <span className="font-mono text-xs uppercase tracking-wider">Loading RPS Market Map...</span>
      </div>
    ),
  }
);

export default function MusicCampaignMapPage() {
  return (
    <div className="w-full h-full bg-[#09090B] text-[#FAFAFA]">
      <DynamicMusicCampaignMap />
    </div>
  );
}
