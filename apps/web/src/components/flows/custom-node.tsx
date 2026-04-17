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

const nodeAccents: Record<string, string> = {
  entry: 'text-primary',
  ivr: 'text-indigo-400',
  if: 'text-amber-500',
  queue: 'text-indigo-400',
  buyer: 'text-amber-500',
  record: 'text-primary',
  tag: 'text-indigo-400',
  whisper: 'text-primary',
  timeout: 'text-muted-foreground',
  fallback: 'text-amber-500',
  hangup: 'text-destructive',
};

export function CustomNode({ data, selected }: NodeProps) {
  const nodeType = (data.nodeType as string) || 'entry';
  const Icon = nodeIcons[nodeType] || Play;
  const accentAttr = nodeAccents[nodeType] || 'text-muted-foreground';

  return (
    <div
      className={cn(
        'rounded-md border bg-card p-3 shadow-sm transition-all',
        selected ? 'border-primary ring-1 ring-primary/20' : 'border-border hover:border-muted-foreground/50'
      )}
    >
      <Handle 
        type="target" 
        position={Position.Top} 
        className="!w-2 !h-2 !bg-muted-foreground !border-background" 
      />
      <div className="flex items-center gap-3">
        <div className={cn('flex h-8 w-8 items-center justify-center rounded bg-muted/30 border border-muted', accentAttr)}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold tracking-tight">{data.label as React.ReactNode}</div>
          {Boolean(data.config) && Object.keys(data.config as Record<string, unknown>).length > 0 && (
            <div className="text-[10px] font-mono leading-tight text-muted-foreground mt-0.5">
              {getNodeSummary(nodeType, data.config as Record<string, unknown>)}
            </div>
          )}
        </div>
      </div>
      <Handle 
        type="source" 
        position={Position.Bottom} 
        className="!w-2 !h-2 !bg-muted-foreground !border-background" 
      />
    </div>
  );
}

function getNodeSummary(nodeType: string, config: Record<string, unknown>): string {
  switch (nodeType) {
    case 'entry':
      return config.target ? `→ ${String(config.target)}` : 'No target';
    case 'ivr':
      return config.prompt ? `Prompt: ${String(config.prompt).substring(0, 20)}...` : 'No prompt';
    case 'if':
      return config.condition ? `If: ${String(config.condition).substring(0, 20)}...` : 'No condition';
    case 'queue':
      return config.queueId ? `Queue: ${String(config.queueId)}` : 'No queue';
    case 'buyer':
      return config.strategy ? `Strategy: ${String(config.strategy)}` : 'No strategy';
    case 'record':
      return config.format ? `Format: ${String(config.format)}` : 'No format';
    case 'tag':
      return config.tags ? `${Object.keys(config.tags as Record<string, unknown>).length} tags` : 'No tags';
    case 'whisper':
      return config.callerPrompt ? 'Whisper configured' : 'No prompts';
    case 'timeout':
      return config.duration ? `${String(config.duration)}s` : '0s';
    case 'fallback':
      return config.targets ? `${(config.targets as string[]).length} targets` : 'No targets';
    case 'hangup':
      return config.reason ? `Reason: ${String(config.reason)}` : 'Normal';
    default:
      return '';
  }
}
