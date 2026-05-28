'use client';

import dynamic from 'next/dynamic';
import React from 'react';

// Load CampaignGeoIntelligenceMap with SSR disabled since maplibre-gl and deck.gl require client window context.
const DynamicCampaignGeoIntelligenceMap = dynamic(
  () => import('@/features/campaign-map/components/CampaignGeoIntelligenceMap'),
  {
    ssr: false,
    loading: () => (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-950 text-slate-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500 mb-2" />
        <span>Loading WebGL Canvas Component...</span>
      </div>
    ),
  }
);

export default function CampaignMapPage() {
  return <DynamicCampaignGeoIntelligenceMap />;
}
