'use client';

import { Users } from 'lucide-react';

export default function MusicFansPage() {
  return (
    <div className="relative z-10 p-6 md:p-8 space-y-6">
      <header className="border-b border-[var(--m-border-2)] pb-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <Users className="h-6 w-6 m-text-accent" /> Fan Database
        </h1>
        <p className="mt-1 text-sm m-text-muted max-w-xl">
          Opted-in fan profiles with engagement scoring, segmentation, and audience source attribution.
        </p>
      </header>
      <div className="m-card p-12 text-center">
        <p className="text-sm m-text-dim">Fan database module is under development. Upload and manage opted-in fan lists here.</p>
      </div>
    </div>
  );
}
