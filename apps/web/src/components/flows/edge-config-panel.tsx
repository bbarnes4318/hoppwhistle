'use client';

import { useState } from 'react';
import type { Edge } from '@xyflow/react';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

interface EdgeConfigPanelProps {
  edge: Edge;
  onUpdate: (edgeId: string, data: Record<string, unknown>) => void;
  onDelete?: (edgeId: string) => void;
}

export function EdgeConfigPanel({ edge, onUpdate, onDelete }: EdgeConfigPanelProps) {
  const condition = (edge.data?.condition as string) || '';
  const weight = (edge.data?.weight as number) ?? undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Edge Configuration</h3>
        {onDelete && (
          <Button
            onClick={() => onDelete(edge.id)}
            variant="destructive"
            size="sm"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="text-sm text-muted-foreground">
        From: {edge.source} → To: {edge.target}
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Condition</label>
        <input
          type="text"
          value={condition}
          onChange={(e) =>
            onUpdate(edge.id, { ...edge.data, condition: e.target.value })
          }
          className="w-full rounded border px-2 py-1"
          placeholder="e.g., '1' for IVR choice, 'true' for if-then, 'connected' for queue"
        />
        <p className="text-xs text-muted-foreground">
          Condition expression for routing (e.g., DTMF digit, event type, or boolean)
        </p>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Weight (Priority)</label>
        <input
          type="number"
          value={weight ?? ''}
          onChange={(e) =>
            onUpdate(edge.id, {
              ...edge.data,
              weight: e.target.value ? parseInt(e.target.value) : undefined,
            })
          }
          className="w-full rounded border px-2 py-1"
          placeholder="Higher weight = higher priority"
        />
        <p className="text-xs text-muted-foreground">
          Used for weighted routing and priority ordering
        </p>
      </div>
    </div>
  );
}

