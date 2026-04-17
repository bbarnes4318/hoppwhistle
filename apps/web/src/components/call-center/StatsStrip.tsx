import React from 'react';
import { KPICard } from '@/components/dashboard/kpi-card';

interface StatsStripProps {
  totalCallsCount: number;
  salesCount: number;
  conversionRate: string;
  followUpCount: number;
}

export function StatsStrip({
  totalCallsCount,
  salesCount,
  conversionRate,
  followUpCount,
}: StatsStripProps) {
  return (
    <div className="grid grid-cols-4 gap-4 flex-shrink-0">
      <KPICard
        title="Total Calls"
        value={totalCallsCount}
      />
      <KPICard
        title="Applications"
        value={salesCount}
      />
      <KPICard
        title="Conversion"
        value={`${conversionRate}%`}
      />
      <KPICard
        title="Follow-Ups"
        value={followUpCount}
      />
    </div>
  );
}
