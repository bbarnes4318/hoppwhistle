import React from 'react';
import { KPICard } from '@/components/dashboard/kpi-card';

interface StatsStripProps {
  totalCallsCount: number;
  appointmentsCount: number;
  appointmentRate: string;
  followUpCount: number;
}

export function StatsStrip({
  totalCallsCount,
  appointmentsCount,
  appointmentRate,
  followUpCount,
}: StatsStripProps) {
  return (
    <div className="grid grid-cols-4 gap-4 flex-shrink-0">
      <KPICard
        title="Total Calls"
        value={totalCallsCount}
      />
      <KPICard
        title="Appointments"
        value={appointmentsCount}
      />
      <KPICard
        title="Appt. Rate"
        value={`${appointmentRate}%`}
      />
      <KPICard
        title="Follow-Ups"
        value={followUpCount}
      />
    </div>
  );
}
