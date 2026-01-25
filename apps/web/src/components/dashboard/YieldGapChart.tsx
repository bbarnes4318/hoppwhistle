'use client';

/**
 * Project Cortex | Yield Gap Chart
 *
 * Area chart showing revenue vs cost over time.
 * Uses ResponsiveContainer height="100%" for grid compatibility.
 */

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { cn } from '@/lib/utils';

interface DataPoint {
  time: string;
  revenue: number;
  cost: number;
  yield: number;
}

interface YieldGapChartProps {
  data?: DataPoint[];
  className?: string;
}

// Mock data for demo
const mockData: DataPoint[] = [
  { time: '06:00', revenue: 450, cost: 280, yield: 170 },
  { time: '07:00', revenue: 890, cost: 520, yield: 370 },
  { time: '08:00', revenue: 1450, cost: 840, yield: 610 },
  { time: '09:00', revenue: 2100, cost: 1200, yield: 900 },
  { time: '10:00', revenue: 3200, cost: 1850, yield: 1350 },
  { time: '11:00', revenue: 4100, cost: 2400, yield: 1700 },
  { time: '12:00', revenue: 4800, cost: 2800, yield: 2000 },
  { time: '13:00', revenue: 5600, cost: 3300, yield: 2300 },
  { time: '14:00', revenue: 6800, cost: 4000, yield: 2800 },
  { time: '15:00', revenue: 8200, cost: 4800, yield: 3400 },
  { time: '16:00', revenue: 10200, cost: 5900, yield: 4300 },
  { time: '17:00', revenue: 12450, cost: 7230, yield: 5220 },
];

export function YieldGapChart({ data = mockData, className }: YieldGapChartProps) {
  const chartData = useMemo(() => data, [data]);

  return (
    <div
      className={cn(
        'rounded-xl bg-panel/60 backdrop-blur-sm border border-white/5 p-4 min-h-0',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-mono text-xs text-neon-cyan uppercase tracking-widest">
          YIELD GAP STREAM
        </h3>
        <span className="font-mono text-[10px] text-neon-mint">LIVE</span>
      </div>

      {/* Chart Container - fills available space */}
      <div className="h-[calc(100%-2rem)] min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              {/* Revenue gradient */}
              <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00E5FF" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00E5FF" stopOpacity={0} />
              </linearGradient>
              {/* Cost gradient */}
              <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#CCFF00" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#CCFF00" stopOpacity={0} />
              </linearGradient>
              {/* Yield gradient */}
              <linearGradient id="yieldGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00FF9F" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#00FF9F" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />

            <XAxis
              dataKey="time"
              tick={{ fill: '#4A5568', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              tickLine={false}
            />

            <YAxis
              tick={{ fill: '#4A5568', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              tickLine={false}
              tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
            />

            <Tooltip
              contentStyle={{
                backgroundColor: '#151A21',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                fontFamily: 'JetBrains Mono',
                fontSize: '11px',
              }}
              labelStyle={{ color: '#A0AEC0' }}
              formatter={(value: number, name: string) => [
                `$${value.toLocaleString()}`,
                name.toUpperCase(),
              ]}
            />

            <Legend
              wrapperStyle={{ fontSize: '10px', fontFamily: 'JetBrains Mono' }}
              formatter={value => <span className="text-text-muted uppercase">{value}</span>}
            />

            {/* Cost Area (bottom layer) */}
            <Area
              type="monotone"
              dataKey="cost"
              stroke="#CCFF00"
              strokeWidth={2}
              fill="url(#costGradient)"
              name="cost"
            />

            {/* Revenue Area */}
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#00E5FF"
              strokeWidth={2}
              fill="url(#revenueGradient)"
              name="revenue"
            />

            {/* Yield Line (the gap) */}
            <Area
              type="monotone"
              dataKey="yield"
              stroke="#00FF9F"
              strokeWidth={2}
              fill="url(#yieldGradient)"
              name="yield"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default YieldGapChart;
