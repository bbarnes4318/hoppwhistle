import type { Edge } from '@xyflow/react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface EdgeConfigPanelProps {
  edge: Edge;
  onUpdate: (edgeId: string, data: Record<string, unknown>) => void;
  onDelete?: (edgeId: string) => void;
}

export function EdgeConfigPanel({ edge, onUpdate, onDelete }: EdgeConfigPanelProps) {
  const condition = (edge.data?.condition as string) || '';
  const weight = (edge.data?.weight as number) ?? undefined;
  const labelClass = "text-[10px] font-semibold tracking-wider text-muted-foreground uppercase";

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
      <div className="text-sm text-muted-foreground font-mono">
        {edge.source} → {edge.target}
      </div>
      
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className={labelClass}>Condition</Label>
          <Input
            value={condition}
            onChange={(e) => onUpdate(edge.id, { ...edge.data, condition: e.target.value })}
            className="h-8 font-mono"
            placeholder="e.g., '1' for IVR choice"
          />
          <p className="text-[10px] text-muted-foreground">
            Condition expression for routing (e.g., DTMF digit)
          </p>
        </div>
        
        <div className="space-y-1.5">
          <Label className={labelClass}>Weight (Priority)</Label>
          <Input
            type="number"
            value={weight ?? ''}
            onChange={(e) =>
              onUpdate(edge.id, {
                ...edge.data,
                weight: e.target.value ? parseInt(e.target.value) : undefined,
              })
            }
            className="h-8 font-mono"
            placeholder="Higher = higher priority"
          />
          <p className="text-[10px] text-muted-foreground">
            Used for weighted routing algorithms
          </p>
        </div>
      </div>
    </div>
  );
}
