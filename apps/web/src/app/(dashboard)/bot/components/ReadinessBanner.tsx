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
      <div className="flex items-center gap-3 px-6 py-3 bg-green-50 dark:bg-green-950/20 border-b border-green-200 dark:border-green-900">
        <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
        <span className="text-sm font-medium text-green-700 dark:text-green-400">
          Ready to launch — all steps complete
        </span>
      </div>
    );
  }

  if (blockingIssues.length > 0) {
    return (
      <div className="flex items-center gap-3 px-6 py-3 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-900">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
            Complete setup to start:
          </span>
          <span className="text-sm text-amber-600 dark:text-amber-500 ml-2">
            {blockingIssues.join(' • ')}
          </span>
        </div>
      </div>
    );
  }

  if (warnings.length > 0) {
    return (
      <div className="flex items-center gap-3 px-6 py-3 bg-blue-50 dark:bg-blue-950/20 border-b border-blue-200 dark:border-blue-900">
        <Info className="h-5 w-5 text-blue-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
            Ready with notes:
          </span>
          <span className="text-sm text-blue-600 dark:text-blue-500 ml-2">
            {warnings.join(' • ')}
          </span>
        </div>
      </div>
    );
  }

  return null;
}
