'use client';

import { FanDatabaseTable } from '@/features/music/components/fan-database-table';
import { fans } from '@/features/music/data/demo-music-data';
import { formatCompactNumber, segmentLabel } from '@/features/music/lib/utils';
import type { FanSegment } from '@/features/music/types';

export default function MusicFansPage() {
  const activeFans = fans.filter(f => f.optedIn);
  const avgEngagement = Math.round(fans.reduce((s, f) => s + f.engagementScore, 0) / fans.length);
  const totalPreSaves = fans.reduce((s, f) => s + f.preSaves, 0);

  // Segment distribution
  const segmentCounts: Record<string, number> = {};
  for (const f of fans) {
    segmentCounts[f.segment] = (segmentCounts[f.segment] ?? 0) + 1;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Fan Database</h1>
        <p className="text-sm text-zinc-500">
          Opted-in fan profiles with engagement scoring, segmentation, and audience source attribution
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="rounded-lg border border-violet-500/20 bg-card/50 p-4 backdrop-blur-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Total Fans</p>
          <p className="mt-1 text-2xl font-bold text-zinc-100">{fans.length}</p>
        </div>
        <div className="rounded-lg border border-violet-500/20 bg-card/50 p-4 backdrop-blur-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Opted In</p>
          <p className="mt-1 text-2xl font-bold text-emerald-400">{activeFans.length}</p>
        </div>
        <div className="rounded-lg border border-violet-500/20 bg-card/50 p-4 backdrop-blur-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Avg Engagement</p>
          <p className="mt-1 text-2xl font-bold text-violet-400">{avgEngagement}%</p>
        </div>
        <div className="rounded-lg border border-violet-500/20 bg-card/50 p-4 backdrop-blur-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Total Pre-Saves</p>
          <p className="mt-1 text-2xl font-bold text-fuchsia-400">{totalPreSaves}</p>
        </div>
        <div className="rounded-lg border border-violet-500/20 bg-card/50 p-4 backdrop-blur-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Segments</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(segmentCounts).map(([seg, count]) => (
              <span key={seg} className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[9px] font-mono text-zinc-400">
                {segmentLabel(seg as FanSegment)} {count}
              </span>
            ))}
          </div>
        </div>
      </div>

      <FanDatabaseTable fans={fans} />
    </div>
  );
}
