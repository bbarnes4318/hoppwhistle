'use client';

import { Handle, Position, NodeProps } from '@xyflow/react';
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

const nodeIcons: Record<string, typeof Play> = {
  entry: Play,
  ivr: Phone,
  if: GitBranch,
  queue: Users,
  buyer: ShoppingCart,
  record: Mic,
  tag: Tag,
  whisper: Volume2,
  timeout: Clock,
  fallback: RotateCcw,
  hangup: PhoneOff,
};

const nodeColors: Record<string, string> = {
  entry: 'bg-[#00D084]', // Electric Lime Green
  ivr: 'bg-[#1E3A5F]', // Deep Navy Blue
  if: 'bg-[#FF6B35]', // Bright Orange
  queue: 'bg-[#1E3A5F]', // Deep Navy Blue
  buyer: 'bg-[#FF6B35]', // Bright Orange
  record: 'bg-[#00D084]', // Electric Lime Green
  tag: 'bg-[#1E3A5F]', // Deep Navy Blue
  whisper: 'bg-[#00D084]', // Electric Lime Green
  timeout: 'bg-gray-500',
  fallback: 'bg-[#FF6B35]', // Bright Orange
  hangup: 'bg-slate-500',
};

export function CustomNode({ data, selected }: NodeProps) {
  const nodeType = data.nodeType || 'entry';
  const Icon = nodeIcons[nodeType] || Play;
  const color = nodeColors[nodeType] || 'bg-gray-500';

  return (
    <div
      className={cn(
        'rounded-lg border-2 bg-card p-4 shadow-md transition-all',
        selected ? 'border-primary shadow-lg' : 'border-border'
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-primary" />
      <div className="flex items-center gap-3">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded', color)}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="font-semibold">{data.label}</div>
          {data.config && Object.keys(data.config).length > 0 && (
            <div className="text-xs text-muted-foreground">
              {getNodeSummary(nodeType, data.config)}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-primary" />
    </div>
  );
}

function getNodeSummary(nodeType: string, config: Record<string, unknown>): string {
  switch (nodeType) {
    case 'entry':
      return config.target ? `→ ${config.target}` : 'No target';
    case 'ivr':
      return config.prompt ? `Prompt: ${String(config.prompt).substring(0, 20)}...` : 'No prompt';
    case 'if':
      return config.condition ? `If: ${String(config.condition).substring(0, 20)}...` : 'No condition';
    case 'queue':
      return config.queueId ? `Queue: ${config.queueId}` : 'No queue';
    case 'buyer':
      return config.strategy ? `Strategy: ${config.strategy}` : 'No strategy';
    case 'record':
      return config.format ? `Format: ${config.format}` : 'No format';
    case 'tag':
      return config.tags ? `${Object.keys(config.tags as Record<string, unknown>).length} tags` : 'No tags';
    case 'whisper':
      return config.callerPrompt ? 'Whisper configured' : 'No prompts';
    case 'timeout':
      return config.duration ? `${config.duration}s` : '0s';
    case 'fallback':
      return config.targets ? `${(config.targets as string[]).length} targets` : 'No targets';
    case 'hangup':
      return config.reason ? `Reason: ${config.reason}` : 'Normal';
    default:
      return '';
  }
}

