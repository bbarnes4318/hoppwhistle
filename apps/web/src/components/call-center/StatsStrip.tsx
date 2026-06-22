import React from 'react';
import { KPICard } from '@/components/dashboard/kpi-card';

interface StatsStripProps {
  totalCallsCount: number;
  appointmentsCount: number;
  appointmentRate: string;
  followUpCount: number;
  salesCount: number;
  conversionRate: string;
}

export function StatsStrip({
  totalCallsCount,
  appointmentsCount,
  appointmentRate,
  followUpCount,
  salesCount,
  conversionRate,
}: StatsStripProps) {
  return (
    <div className="grid grid-cols-5 gap-4 flex-shrink-0">
      <KPICard
        title="Total Calls"
        value={totalCallsCount}
      />
      <KPICard
        title="Sales / Apps"
        value={salesCount}
      />
      <KPICard
        title="Appointments"
        value={appointmentsCount}
      />
      <KPICard
        title="Follow-Ups"
        value={followUpCount}
      />
      <KPICard
        title="Conv. Rate"
        value={`${conversionRate}%`}
      />
    </div>
  );
}
