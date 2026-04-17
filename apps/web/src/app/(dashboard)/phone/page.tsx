'use client';

import { Activity, Clock, FileText, Phone, PhoneIncoming, PhoneOutgoing, Settings } from 'lucide-react';
import { useState } from 'react';

import { KPICard } from '@/components/dashboard/kpi-card';
import { usePhone, type CallInfo } from '@/components/phone';
import { AgentStatusSelector } from '@/components/phone/agent-status-selector';
import { DialPad } from '@/components/phone/dial-pad';
import { ScreenPopSettings } from '@/components/phone/screen-pop-settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ============================================================================
// Phone Page - Full Screen Softphone
// ============================================================================

export default function PhonePage(): JSX.Element {
 const { callHistory } = usePhone();
 const [showSettings, setShowSettings] = useState(false);

 // Calculate stats
 const todaysCalls = callHistory.filter((c: CallInfo) => {
 const today = new Date();
 return c.startTime && c.startTime.toDateString() === today.toDateString();
 });

 const inboundCalls = todaysCalls.filter((c: CallInfo) => c.direction === 'inbound').length;
 const outboundCalls = todaysCalls.filter((c: CallInfo) => c.direction === 'outbound').length;
 const totalDuration = todaysCalls.reduce((sum: number, c: CallInfo) => sum + c.duration, 0);

 const formatDuration = (seconds: number): string => {
 const hours = Math.floor(seconds / 3600);
 const mins = Math.floor((seconds % 3600) / 60);
 const secs = seconds % 60;
 if (hours > 0) {
 return `${hours}h ${mins}m`;
 }
 return `${mins}m ${secs}s`;
 };

 const formatTime = (date?: Date): string => {
 if (!date) return '';
 return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
 };

 return (
 <div className="h-full flex flex-col overflow-hidden">
 {/* Settings Modal */}
 {showSettings && <ScreenPopSettings onClose={() => setShowSettings(false)} />}

 {/* Header */}
 <div className="flex items-center justify-between flex-shrink-0 mb-6 border-b border-border pb-4">
 <div className="flex items-center gap-4">
 <div className="w-10 h-10 rounded border border-border bg-card flex items-center justify-center">
 <Phone className="w-5 h-5 text-muted-foreground" />
 </div>
 <div>
 <h1 className="text-2xl font-bold tracking-tight uppercase">Agent Console</h1>
 <div className="flex items-center gap-3 mt-1">
 <span className="text-xs uppercase tracking-widest text-muted-foreground">Status:</span>
 <AgentStatusSelector />
 </div>
 </div>
 </div>

 <Button variant="secondary" onClick={() => setShowSettings(true)} className="gap-2 rounded-sm border">
 <Settings className="w-4 h-4" />
 Screen Pop Settings
 </Button>
 </div>

 {/* Main Content Grid */}
 <div className="flex-1 grid gap-6 lg:grid-cols-3 min-h-0 overflow-auto">
 {/* Left Column - Dial Pad */}
 <Card className="lg:row-span-2">
 <CardHeader className="pb-4">
 <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
 <Phone className="w-4 h-4" />
 Command Line
 </CardTitle>
 </CardHeader>
 <CardContent>
 <DialPad />
 </CardContent>
 </Card>

 {/* Stats Cards */}
 <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-2">
 <KPICard
 title="Volume Today"
 value={todaysCalls.length}
 icon={Activity}
 trendLabel={`${inboundCalls} INBOARD / ${outboundCalls} OUTBOUND`}
 />
 <KPICard
 title="Talk Time"
 value={formatDuration(totalDuration)}
 icon={Clock}
 />
 </div>

 {/* Call History */}
 <Card className="lg:col-span-2 flex flex-col min-h-0">
 <CardHeader className="pb-4 border-b border-border">
 <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
 <FileText className="w-4 h-4" />
 Operation Log
 </CardTitle>
 </CardHeader>
 <CardContent className="p-0 overflow-auto flex-1">
 {callHistory.length === 0 ? (
 <div className="text-center py-12">
 <Activity className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
 <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">No operations recorded</p>
 <p className="text-sm text-muted-foreground/70 mt-1">
 Your call history will appear here
 </p>
 </div>
 ) : (
 <table className="w-full text-left">
 <tbody className="divide-y divide-border">
 {callHistory.slice(0, 20).map((call: CallInfo, index: number) => (
 <tr
 key={`${call.callId}-${index}`}
 className="transition-colors hover:bg-muted/50"
 >
 <td className="py-2 pl-4 pr-3">
 <div className="flex items-center gap-1.5">
 {call.direction === 'inbound' ? (
 <PhoneIncoming className="w-3.5 h-3.5 text-muted-foreground" />
 ) : (
 <PhoneOutgoing className="w-3.5 h-3.5 text-muted-foreground" />
 )}
 <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground w-6">
 {call.direction === 'inbound' ? 'IN' : 'OUT'}
 </span>
 </div>
 </td>
 <td className="py-2 px-3 font-mono text-xs text-foreground truncate max-w-[150px]">
 {call.callerName ?? call.phoneNumber}
 </td>
 <td className="py-2 px-3 font-mono text-xs text-muted-foreground">
 {call.duration > 0 ? formatDuration(call.duration) : '—'}
 </td>
 <td className="py-2 px-3 font-mono text-xs text-muted-foreground text-right">
 {formatTime(call.startTime)}
 </td>
 <td className="py-2 pl-3 pr-4 text-right">
 <span
 className={cn(
 'font-mono text-xs',
 call.state === 'ended' && call.duration > 0
 ? 'text-primary'
 : 'text-muted-foreground/60'
 )}
 >
 {call.state === 'ended' && call.duration > 0 ? 'COMPLETED' : 'MISSED'}
 </span>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 )}
 </CardContent>
 </Card>
 </div>
 </div>
 );
}

