'use client';

import { useCallback } from 'react';
import {
  Play,
  Phone,
  GitBranch,
  Users,
  ShoppingCart,
  Mic,
  Tag,
  Volume2,
  Clock,
  RotateCcw,
  PhoneOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const nodeTypes = [
  { type: 'entry', label: 'Entry', icon: Play, color: 'bg-[#00D084]' }, // Electric Lime Green
  { type: 'ivr', label: 'IVR', icon: Phone, color: 'bg-[#1E3A5F]' }, // Deep Navy Blue
  { type: 'if', label: 'If', icon: GitBranch, color: 'bg-[#FF6B35]' }, // Bright Orange
  { type: 'queue', label: 'Queue', icon: Users, color: 'bg-[#1E3A5F]' }, // Deep Navy Blue
  { type: 'buyer', label: 'Buyer', icon: ShoppingCart, color: 'bg-[#FF6B35]' }, // Bright Orange
  { type: 'record', label: 'Record', icon: Mic, color: 'bg-[#00D084]' }, // Electric Lime Green
  { type: 'tag', label: 'Tag', icon: Tag, color: 'bg-[#1E3A5F]' }, // Deep Navy Blue
  { type: 'whisper', label: 'Whisper', icon: Volume2, color: 'bg-[#00D084]' }, // Electric Lime Green
  { type: 'timeout', label: 'Timeout', icon: Clock, color: 'bg-gray-500' },
  { type: 'fallback', label: 'Fallback', icon: RotateCcw, color: 'bg-[#FF6B35]' }, // Bright Orange
  { type: 'hangup', label: 'Hangup', icon: PhoneOff, color: 'bg-slate-500' },
];

export function NodePalette({
  onAddNode,
}: {
  onAddNode: (nodeType: string, position: { x: number; y: number }) => void;
}) {
  const handleDragStart = useCallback(
    (event: React.DragEvent, nodeType: string) => {
      event.dataTransfer.setData('application/reactflow', nodeType);
      event.dataTransfer.effectAllowed = 'move';
    },
    []
  );

  return (
    <div className="w-64 border-r bg-card flex flex-col overflow-hidden flex-shrink-0 h-full">
      <div className="p-4 flex-shrink-0">
        <h2 className="text-lg font-semibold">Node Palette</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 pt-0">
        <div className="space-y-2">
          {nodeTypes.map((node) => (
            <div
              key={node.type}
              draggable
              onDragStart={(e) => handleDragStart(e, node.type)}
              className={cn(
                'flex cursor-grab items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent',
                'active:cursor-grabbing'
              )}
            >
              <div className={cn('flex h-8 w-8 items-center justify-center rounded', node.color)}>
                <node.icon className="h-4 w-4 text-white" />
              </div>
              <span className="font-medium">{node.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

