'use client';

/**
 * Project Cortex | Buffer Washout Chart
 *
 * Shows Total Inbound (Gray) vs Billable/Qualified (Neon Cyan).
 * The gap represents traffic lost to the Buffer Timer.
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
  inbound: number;
  billable: number;
  washout: number; // inbound - billable
}

interface BufferWashoutChartProps {
  data?: DataPoint[];
  className?: string;
}

// Mock data showing inbound vs billable
const mockData: DataPoint[] = [
  { time: '06:00', inbound: 45, billable: 32, washout: 13 },
  { time: '07:00', inbound: 89, billable: 64, washout: 25 },
  { time: '08:00', inbound: 145, billable: 108, washout: 37 },
  { time: '09:00', inbound: 210, billable: 162, washout: 48 },
  { time: '10:00', inbound: 320, billable: 248, washout: 72 },
  { time: '11:00', inbound: 410, billable: 312, washout: 98 },
  { time: '12:00', inbound: 380, billable: 285, washout: 95 },
  { time: '13:00', inbound: 460, billable: 352, washout: 108 },
  { time: '14:00', inbound: 520, billable: 398, washout: 122 },
  { time: '15:00', inbound: 580, billable: 445, washout: 135 },
  { time: '16:00', inbound: 650, billable: 502, washout: 148 },
  { time: '17:00', inbound: 690, billable: 534, washout: 156 },
];

export function BufferWashoutChart({ data = mockData, className }: BufferWashoutChartProps) {
  const chartData = useMemo(() => data, [data]);

  // Calculate conversion rate
  const totalInbound = chartData.reduce((sum, d) => sum + d.inbound, 0);
  const totalBillable = chartData.reduce((sum, d) => sum + d.billable, 0);
  const conversionRate = totalInbound > 0 ? ((totalBillable / totalInbound) * 100).toFixed(1) : 0;

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl bg-panel/60 backdrop-blur-sm border border-white/5 p-4 min-h-0',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <h3 className="font-mono text-xs text-neon-cyan uppercase tracking-widest">
            BUFFER WASHOUT
          </h3>
          <span className="px-2 py-0.5 rounded bg-neon-mint/10 border border-neon-mint/30 font-mono text-[10px] text-neon-mint">
            {conversionRate}% CONVERSION
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-text-muted" />
            <span className="font-mono text-[10px] text-text-muted">INBOUND</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-neon-cyan" />
            <span className="font-mono text-[10px] text-neon-cyan">BILLABLE</span>
          </div>
        </div>
      </div>

      {/* Chart Container */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              {/* Inbound gradient (gray) */}
              <linearGradient id="inboundGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#4A5568" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#4A5568" stopOpacity={0} />
              </linearGradient>
              {/* Billable gradient (cyan) */}
              <linearGradient id="billableGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00E5FF" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#00E5FF" stopOpacity={0} />
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
              formatter={(value: number, name: string) => {
                const label = name === 'inbound' ? 'INBOUND' : 'BILLABLE';
                return [`${value} calls`, label];
              }}
            />

            {/* Inbound Area (Gray - bottom layer shows the gap) */}
            <Area
              type="monotone"
              dataKey="inbound"
              stroke="#4A5568"
              strokeWidth={2}
              fill="url(#inboundGradient)"
              name="inbound"
            />

            {/* Billable Area (Cyan - the converted calls) */}
            <Area
              type="monotone"
              dataKey="billable"
              stroke="#00E5FF"
              strokeWidth={2}
              fill="url(#billableGradient)"
              name="billable"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Bottom Stats */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="font-mono text-lg font-bold text-text-muted">{totalInbound}</p>
            <p className="font-mono text-[10px] text-text-muted uppercase">INBOUND</p>
          </div>
          <div className="text-center">
            <p className="font-display text-lg font-bold text-neon-cyan">{totalBillable}</p>
            <p className="font-mono text-[10px] text-neon-cyan uppercase">BILLABLE</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-display text-lg font-bold text-status-warning">
            {totalInbound - totalBillable}
          </p>
          <p className="font-mono text-[10px] text-status-warning uppercase">WASHOUT</p>
        </div>
      </div>
    </div>
  );
}

export default BufferWashoutChart;
