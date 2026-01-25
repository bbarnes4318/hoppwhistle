'use client';

/**
 * Project Cortex | Route Indicator
 *
 * Shows Publisher → Target routing path.
 */

import { ArrowRight, Rss, Target } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RouteIndicatorProps {
  publisherName: string;
  targetName: string;
  buyerName?: string;
  className?: string;
}

export function RouteIndicator({
  publisherName,
  targetName,
  buyerName,
  className,
}: RouteIndicatorProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Publisher */}
      <div className="flex items-center gap-1.5">
        <Rss className="h-3 w-3 text-neon-cyan" />
        <span className="font-mono text-xs text-text-secondary truncate max-w-[120px]">
          {publisherName}
        </span>
      </div>

      {/* Arrow */}
      <ArrowRight className="h-3 w-3 text-text-muted shrink-0" />

      {/* Target */}
      <div className="flex items-center gap-1.5">
        <Target className="h-3 w-3 text-neon-mint" />
        <div className="truncate max-w-[150px]">
          <span className="font-mono text-xs text-text-primary">{buyerName || targetName}</span>
          {buyerName && (
            <span className="font-mono text-[10px] text-text-muted ml-1">({targetName})</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default RouteIndicator;
