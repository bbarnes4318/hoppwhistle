import { Telescope } from 'lucide-react';
import Link from 'next/link';

import { ResearchConfigForm } from '@/features/industry-research/ResearchConfigForm';

export const metadata = { title: 'New Industry Research' };

export default function Page() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href="/tools/industry-research"
          className="mb-2 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          ← All research
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Telescope className="h-6 w-6 text-primary" /> New industry research
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure a forensic industry-entry investigation. Nothing runs until you launch it.
        </p>
      </div>
      <ResearchConfigForm />
    </div>
  );
}
