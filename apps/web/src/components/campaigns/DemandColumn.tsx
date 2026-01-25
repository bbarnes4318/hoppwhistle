'use client';

/**
 * Project Cortex | Demand Column
 *
 * Column 3: Target Waterfall (Egress).
 * Drag-and-drop priority ordering.
 */

import { Plus, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TargetWaterfallCard } from './TargetWaterfallCard';
import type { CampaignTarget } from '@/types/campaign';

interface DemandColumnProps {
  targets: CampaignTarget[];
  onChange: (targets: CampaignTarget[]) => void;
  onAttachTarget: () => void;
  className?: string;
}

export function DemandColumn({ targets, onChange, onAttachTarget, className }: DemandColumnProps) {
  // Sort targets by priority tier
  const sortedTargets = [...targets].sort((a, b) => a.priorityTier - b.priorityTier);

  const handleUpdateTarget = (index: number, target: CampaignTarget) => {
    const updated = [...targets];
    const originalIndex = targets.findIndex(t => t.id === sortedTargets[index].id);
    updated[originalIndex] = target;
    onChange(updated);
  };

  const handleRemoveTarget = (index: number) => {
    const targetId = sortedTargets[index].id;
    onChange(targets.filter(t => t.id !== targetId));
  };

  // Simple drag reorder (swap priorities)
  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = parseInt(e.dataTransfer.getData('text/plain'));
    if (dragIndex === dropIndex) return;

    // Swap priorities
    const updated = [...targets];
    const dragTarget = sortedTargets[dragIndex];
    const dropTarget = sortedTargets[dropIndex];

    const dragOriginalIndex = targets.findIndex(t => t.id === dragTarget.id);
    const dropOriginalIndex = targets.findIndex(t => t.id === dropTarget.id);

    // Swap priority tiers
    const tempPriority = updated[dragOriginalIndex].priorityTier;
    updated[dragOriginalIndex].priorityTier = updated[dropOriginalIndex].priorityTier;
    updated[dropOriginalIndex].priorityTier = tempPriority;

    onChange(updated);
  };

  // Count active vs skipped
  const activeCount = targets.filter(t => !t.isSkipped).length;
  const skippedCount = targets.filter(t => t.isSkipped).length;

  return (
    <div
      className={cn(
        'flex flex-col h-full rounded-xl overflow-hidden',
        'bg-panel/30 backdrop-blur-sm border border-white/5',
        className
      )}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-neon-mint" />
          <span className="font-mono text-xs text-neon-mint uppercase tracking-widest">DEMAND</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-neon-mint">{activeCount} ACTIVE</span>
          {skippedCount > 0 && (
            <span className="font-mono text-[10px] text-status-warning">
              {skippedCount} SKIPPED
            </span>
          )}
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {sortedTargets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <Target className="h-8 w-8 text-text-muted/30 mb-2" />
            <p className="font-mono text-xs text-text-muted">No targets</p>
            <p className="font-mono text-[10px] text-text-muted/50">
              Attach buyers from repository
            </p>
          </div>
        ) : (
          sortedTargets.map((target, index) => (
            <div
              key={target.id}
              draggable
              onDragStart={e => handleDragStart(e, index)}
              onDragOver={handleDragOver}
              onDrop={e => handleDrop(e, index)}
            >
              <TargetWaterfallCard
                target={target}
                onChange={t => handleUpdateTarget(index, t)}
                onRemove={() => handleRemoveTarget(index)}
              />
            </div>
          ))
        )}
      </div>

      {/* Attach Button */}
      <div className="p-3 border-t border-white/5">
        <Button
          variant="outline"
          className="w-full gap-2 border-dashed border-white/20 text-text-muted hover:text-neon-mint hover:border-neon-mint/30"
          onClick={onAttachTarget}
        >
          <Plus className="h-4 w-4" />
          ATTACH TARGET
        </Button>
      </div>
    </div>
  );
}

export default DemandColumn;
