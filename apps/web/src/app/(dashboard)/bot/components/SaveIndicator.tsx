'use client';

import { Check, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface SaveIndicatorProps {
  status: SaveStatus;
  onRetry?: () => void;
}

export function SaveIndicator({ status, onRetry }: SaveIndicatorProps) {
  if (status === 'idle') return null;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-xs font-medium transition-opacity',
        status === 'saving' && 'text-muted-foreground',
        status === 'saved' && 'text-green-600',
        status === 'error' && 'text-red-500'
      )}
    >
      {status === 'saving' && (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Saving…</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <Check className="h-3 w-3" />
          <span>All changes saved</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="h-3 w-3" />
          <span>Save failed</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="ml-1 hover:text-red-600 underline underline-offset-2"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
