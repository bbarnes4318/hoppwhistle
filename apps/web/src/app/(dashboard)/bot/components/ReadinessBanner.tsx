'use client';

import { AlertTriangle, CheckCircle, Info } from 'lucide-react';

import { cn } from '@/lib/utils';

interface ReadinessBannerProps {
  isReady: boolean;
  blockingIssues: string[];
  warnings: string[];
}

export function ReadinessBanner({ isReady, blockingIssues, warnings }: ReadinessBannerProps) {
  if (isReady && warnings.length === 0) {
    return (
      <div className="flex items-center gap-3 px-6 py-3 bg-live-tint border-b border-live/40">
        <CheckCircle className="h-5 w-5 text-live-ink shrink-0" />
        <span className="text-sm font-medium text-live-ink">
          Ready to launch — all steps complete
        </span>
      </div>
    );
  }

  if (blockingIssues.length > 0) {
    return (
      <div className="flex items-center gap-3 px-6 py-3 bg-ringing-tint border-b border-ringing/40">
        <AlertTriangle className="h-5 w-5 text-ringing-ink shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-ringing-ink">Complete setup to start:</span>
          <span className="text-sm text-ringing-ink ml-2">{blockingIssues.join(' • ')}</span>
        </div>
      </div>
    );
  }

  if (warnings.length > 0) {
    return (
      <div className="flex items-center gap-3 px-6 py-3 bg-money-tint border-b border-money/40">
        <Info className="h-5 w-5 text-money-ink shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-money-ink">Ready with notes:</span>
          <span className="text-sm text-money-ink ml-2">{warnings.join(' • ')}</span>
        </div>
      </div>
    );
  }

  return null;
}
