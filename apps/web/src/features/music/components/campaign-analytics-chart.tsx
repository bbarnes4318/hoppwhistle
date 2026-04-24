'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { CampaignTimeSeriesPoint } from '../types';

export function CampaignAnalyticsChart({ data }: { data: CampaignTimeSeriesPoint[] }) {
  return (
    <div className="rounded-lg border border-violet-500/20 bg-card/50 p-4 backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Fan Interaction Trend</h3>
          <p className="text-xs text-zinc-500">14-day campaign activity</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full bg-violet-400" />Contacted</div>
          <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full bg-cyan-400" />Answers</div>
          <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full bg-emerald-400" />Verified</div>
          <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full bg-fuchsia-400" />Pre-Saves</div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="mcContactedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="mcAnswersGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="mcVerifiedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10B981" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(224,30%,18%)" vertical={false} />
          <XAxis dataKey="date" stroke="hsl(215,20%,40%)" tick={{ fontSize: 10, fill: 'hsl(215,20%,50%)' }} tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} />
          <YAxis stroke="hsl(215,20%,40%)" tick={{ fontSize: 10, fill: 'hsl(215,20%,50%)' }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ backgroundColor: 'hsl(224,35%,12%)', border: '1px solid hsl(262,40%,30%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(215,20%,90%)' }} />
          <Area type="monotone" dataKey="fansContacted" stroke="#8B5CF6" strokeWidth={2} fill="url(#mcContactedGrad)" name="Contacted" />
          <Area type="monotone" dataKey="humanAnswers" stroke="#06B6D4" strokeWidth={1.5} fill="url(#mcAnswersGrad)" name="Answers" />
          <Area type="monotone" dataKey="verifiedEngagements" stroke="#10B981" strokeWidth={1.5} fill="url(#mcVerifiedGrad)" name="Verified" />
          <Area type="monotone" dataKey="preSaves" stroke="#D946EF" strokeWidth={1.5} fill="none" name="Pre-Saves" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
