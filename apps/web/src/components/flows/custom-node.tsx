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
 entry: 'bg-primary',
 ivr: 'bg-indigo-600',
 if: 'bg-amber-600',
 queue: 'bg-indigo-600',
 buyer: 'bg-amber-600',
 record: 'bg-primary',
 tag: 'bg-indigo-600',
 whisper: 'bg-primary',
 timeout: 'bg-muted-foreground',
 fallback: 'bg-amber-600',
 hangup: 'bg-destructive',
};

export function CustomNode({ data, selected }: NodeProps) {
 const nodeType = (data.nodeType as string) || 'entry';
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
 <div className="font-semibold">{data.label as React.ReactNode}</div>
 {Boolean(data.config) && Object.keys(data.config as Record<string, unknown>).length > 0 && (
 <div className="text-xs text-muted-foreground">
 {getNodeSummary(nodeType, data.config as Record<string, unknown>)}
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


