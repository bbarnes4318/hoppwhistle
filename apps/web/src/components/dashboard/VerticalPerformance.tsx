'use client';

/**
 * Project Cortex | Vertical Performance Panel
 *
 * Compact vertical yield bars for single-view dashboard.
 */

import { cn } from '@/lib/utils';
import { VerticalBadge } from '@/components/ppcall';

interface VerticalStat {
  vertical: string;
  calls: number;
  revenue: number;
  cost: number;
  yield: number;
}

interface VerticalPerformanceProps {
  stats?: VerticalStat[];
  className?: string;
}

const mockStats: VerticalStat[] = [
  { vertical: 'medicare', calls: 234, revenue: 4560, cost: 2340, yield: 2220 },
  { vertical: 'mass-tort', calls: 45, revenue: 3750, cost: 1800, yield: 1950 },
  { vertical: 'roofing', calls: 156, revenue: 2340, cost: 1560, yield: 780 },
  { vertical: 'dme-cgm', calls: 67, revenue: 1800, cost: 1530, yield: 270 },
  { vertical: 'solar', calls: 89, revenue: 1200, cost: 720, yield: 480 },
];

export function VerticalPerformance({ stats = mockStats, className }: VerticalPerformanceProps) {
  const maxYield = Math.max(...stats.map(s => s.yield));

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl bg-panel/60 backdrop-blur-sm border border-white/5 p-4 min-h-0',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-mono text-xs text-neon-cyan uppercase tracking-widest">
          VERTICAL YIELD
        </h3>
        <span className="font-mono text-[10px] text-text-muted">{stats.length} ACTIVE</span>
      </div>

      {/* Vertical Bars - scrollable if needed */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
        {stats.map(stat => {
          const percentage = (stat.yield / maxYield) * 100;

          return (
            <div
              key={stat.vertical}
              className="flex items-center gap-3 p-2 rounded-lg bg-void/30 hover:bg-void/50 transition-colors"
            >
              {/* Vertical Badge */}
              <VerticalBadge vertical={stat.vertical} size="sm" showIcon />

              {/* Calls Count */}
              <span className="font-mono text-[10px] text-text-muted w-12 shrink-0">
                {stat.calls} calls
              </span>

              {/* Yield Bar */}
              <div className="flex-1 h-4 bg-panel rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-neon-cyan to-neon-mint rounded-full transition-all duration-500"
                  style={{ width: `${percentage}%` }}
                />
              </div>

              {/* Yield Value */}
              <span className="font-mono text-sm font-bold text-neon-mint tabular-nums min-w-[70px] text-right">
                +${stat.yield.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default VerticalPerformance;
