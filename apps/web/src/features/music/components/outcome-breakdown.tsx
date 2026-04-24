'use client';

import type { OutcomeBreakdown } from '../types';
import { outcomeLabel } from '../lib/utils';

export function OutcomeBreakdownCard({ data }: { data: OutcomeBreakdown[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="rounded-lg border border-violet-500/20 bg-card/50 p-4 backdrop-blur-sm">
      <h3 className="mb-4 text-sm font-semibold text-zinc-200">Verified Action Breakdown</h3>
      <div className="space-y-3">
        {data.map(item => (
          <div key={item.outcome} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-zinc-300">{outcomeLabel(item.outcome)}</span>
              </div>
              <div className="flex items-center gap-3 text-zinc-500">
                <span>{item.count}</span>
                <span className="text-zinc-400 font-medium font-mono">{item.percentage}%</span>
              </div>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-800">
              <div
                className="h-1.5 rounded-full transition-all duration-700"
                style={{ width: `${(item.count / total) * 100}%`, backgroundColor: item.color, opacity: 0.7 }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
