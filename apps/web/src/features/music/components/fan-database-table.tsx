'use client';

import type { Fan } from '../types';
import {
  audienceSourceLabel,
  formatCompactNumber,
  segmentLabel,
  segmentStyle,
} from '../lib/utils';

import { cn } from '@/lib/utils';

interface FanDatabaseTableProps {
  fans: Fan[];
}

export function FanDatabaseTable({ fans }: FanDatabaseTableProps) {
  return (
    <div className="rounded-lg border border-violet-500/20 bg-card/50 backdrop-blur-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-violet-500/10 bg-violet-950/20">
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider">Fan</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider">Location</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider">Segment</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider">Source</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider text-right">Engagement</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider text-right">Interactions</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider text-right">Pre-Saves</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider text-right">Tickets</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider text-center">Opted In</th>
            </tr>
          </thead>
          <tbody>
            {fans.map((f, i) => {
              const ss = segmentStyle(f.segment);
              return (
                <tr key={f.id} className={cn('border-b border-zinc-800/50 transition-colors hover:bg-violet-500/5', i % 2 === 0 ? 'bg-transparent' : 'bg-zinc-900/20')}>
                  <td className="px-4 py-3">
                    <div>
                      <span className="font-medium text-zinc-200">{f.name}</span>
                      <div className="text-zinc-500 text-[10px]">{f.email}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{f.city}, {f.state}</td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium', ss.bg, ss.text)}>
                      {segmentLabel(f.segment)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-[11px]">{audienceSourceLabel(f.source)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-zinc-800">
                        <div className="h-1.5 rounded-full bg-violet-500 transition-all" style={{ width: `${f.engagementScore}%` }} />
                      </div>
                      <span className="font-mono text-zinc-300 w-7 text-right">{f.engagementScore}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-300 font-mono">{f.totalInteractions}</td>
                  <td className="px-4 py-3 text-right text-violet-400 font-mono">{f.preSaves}</td>
                  <td className="px-4 py-3 text-right text-cyan-400 font-mono">{f.ticketsPurchased}</td>
                  <td className="px-4 py-3 text-center">
                    {f.optedIn
                      ? <span className="text-emerald-400 text-[10px] font-bold">●</span>
                      : <span className="text-red-400 text-[10px] font-bold">●</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
