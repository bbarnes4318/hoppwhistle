'use client';

import { Users } from 'lucide-react';
import { FanDatabaseTable } from '@/features/music/components/fan-database-table';

export default function MusicFansPage() {
  return (
    <div className="space-y-5">
      <header className="border-b border-[var(--m-border-2)] pb-4">
        <h1 className="text-[28px] font-bold tracking-tight flex items-center gap-3 m-text-text">
          <Users className="h-7 w-7 m-text-accent" /> Fan Database
        </h1>
        <p className="mt-2 text-sm m-text-muted max-w-xl">
          Opted-in fan profiles with engagement scoring, segmentation, and audience source attribution.
        </p>
      </header>
      
      <FanDatabaseTable />
    </div>
  );
}
