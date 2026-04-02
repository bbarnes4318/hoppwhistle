'use client';

import { Activity, CheckCircle2, XCircle, Zap, TestTube, Radio, type LucideIcon } from 'lucide-react';

import type { InsuranceLeadStats } from '@/lib/api/leads';

interface StatsCardsProps {
  stats: InsuranceLeadStats | null;
  loading: boolean;
}

interface StatCard {
  label: string;
  value: number;
  sub: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
}

export function LeadStatsCards({ stats, loading }: StatsCardsProps) {
  const cards: StatCard[] = [
    {
      label: 'Total Leads',
      value: stats?.totalLeads ?? 0,
      sub: `${stats?.acaLeads ?? 0} ACA · ${stats?.feLeads ?? 0} FE`,
      icon: Activity,
      color: 'text-slate-300',
      bgColor: 'bg-slate-500/10',
    },
    {
      label: 'Valid',
      value: stats?.validSubmissions ?? 0,
      sub: `of ${stats?.totalSubmissions ?? 0} submissions`,
      icon: CheckCircle2,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
    },
    {
      label: 'Invalid',
      value: stats?.invalidSubmissions ?? 0,
      sub: 'validation failures',
      icon: XCircle,
      color: 'text-red-400',
      bgColor: 'bg-red-500/10',
    },
    {
      label: 'Matched',
      value: stats?.matchedSubmissions ?? 0,
      sub: `${stats?.unmatchedSubmissions ?? 0} unmatched · ${stats?.errorSubmissions ?? 0} errors`,
      icon: Zap,
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
    },
    {
      label: 'Test',
      value: stats?.testSubmissions ?? 0,
      sub: 'test mode submissions',
      icon: TestTube,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    },
    {
      label: 'Live',
      value: stats?.liveSubmissions ?? 0,
      sub: 'live mode submissions',
      icon: Radio,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg border border-white/5 bg-slate-900/50 p-4 backdrop-blur-sm"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className={`rounded-md p-1.5 ${card.bgColor}`}>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </div>
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
              {card.label}
            </span>
          </div>
          {loading ? (
            <div className="h-8 w-16 animate-pulse rounded bg-slate-800" />
          ) : (
            <>
              <div className={`text-2xl font-semibold ${card.color}`}>
                {card.value.toLocaleString()}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{card.sub}</div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
