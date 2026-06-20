'use client';

import { Activity, Clock, FileText, Phone, PhoneIncoming, PhoneOutgoing, Settings } from 'lucide-react';
import { useState } from 'react';

import { KPICard } from '@/components/dashboard/kpi-card';
import { usePhone, type CallInfo } from '@/components/phone';
import { AgentStatusSelector } from '@/components/phone/agent-status-selector';
import { DialPad } from '@/components/phone/dial-pad';
import { ScreenPopSettings } from '@/components/phone/screen-pop-settings';
import { Button } from '@/components/ui/button';
import { CompactPageShell, CompactPageHeader, DenseCard } from '@/components/layout/compact-layout';
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
    <CompactPageShell>
      {/* Settings Modal */}
      {showSettings && <ScreenPopSettings onClose={() => setShowSettings(false)} />}

      {/* Header */}
      <CompactPageHeader
        title="Agent Console"
        subtitle="Manage softphone operations and check live calling activity"
        icon={Phone}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-xs">
            <span className="text-[10px] uppercase font-bold text-muted-foreground/60">Status:</span>
            <AgentStatusSelector />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(true)}
            className="gap-1.5 h-8 border border-border/40 text-xs hover:bg-slate-900 hover:text-white"
          >
            <Settings className="w-3.5 h-3.5" />
            Screen Pop Settings
          </Button>
        </div>
      </CompactPageHeader>

      {/* Main Content Grid */}
      <div className="flex-1 grid gap-4 lg:grid-cols-3 min-h-0 overflow-hidden">
        {/* Left Column - Dial Pad */}
        <div className="lg:col-span-1 flex flex-col min-h-0">
          <DenseCard title="Command Line" icon={Phone} className="flex-1 min-h-0">
            <DialPad compact={true} />
          </DenseCard>
        </div>

        {/* Right Column - Stats & History */}
        <div className="lg:col-span-2 flex flex-col gap-4 min-h-0 overflow-hidden">
          {/* Stats Cards */}
          <div className="grid gap-4 sm:grid-cols-2 flex-shrink-0">
            <KPICard
              title="Volume Today"
              value={todaysCalls.length}
              icon={Activity}
              trendLabel={`${inboundCalls} IN / ${outboundCalls} OUT`}
              className="p-3 pb-2.5 space-y-2 border-border/40"
            />
            <KPICard
              title="Talk Time"
              value={formatDuration(totalDuration)}
              icon={Clock}
              className="p-3 pb-2.5 space-y-2 border-border/40"
            />
          </div>

          {/* Call History */}
          <DenseCard title="Operation Log" icon={FileText} className="flex-1 min-h-0">
            {callHistory.length === 0 ? (
              <div className="text-center py-8">
                <Activity className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">No operations recorded</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Your call history will appear here
                </p>
              </div>
            ) : (
              <div className="overflow-auto max-h-full custom-scrollbar">
                <table className="w-full text-left table-dense">
                  <thead>
                    <tr className="border-b border-border/10">
                      <th className="py-1 px-2">Type</th>
                      <th className="py-1 px-2">Phone Number</th>
                      <th className="py-1 px-2">Duration</th>
                      <th className="py-1 px-2 text-right">Time</th>
                      <th className="py-1 px-2 text-right">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/5">
                    {callHistory.slice(0, 20).map((call: CallInfo, index: number) => (
                      <tr
                        key={`${call.callId}-${index}`}
                        className="transition-colors hover:bg-white/[0.02]"
                      >
                        <td className="py-1 px-2">
                          <div className="flex items-center gap-1">
                            {call.direction === 'inbound' ? (
                              <PhoneIncoming className="w-3 h-3 text-cyan-400" />
                            ) : (
                              <PhoneOutgoing className="w-3 h-3 text-blue-400" />
                            )}
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              {call.direction === 'inbound' ? 'IN' : 'OUT'}
                            </span>
                          </div>
                        </td>
                        <td className="py-1 px-2 font-mono text-xs text-foreground truncate max-w-[150px]">
                          {call.callerName ?? call.phoneNumber}
                        </td>
                        <td className="py-1 px-2 font-mono text-xs text-muted-foreground">
                          {call.duration > 0 ? formatDuration(call.duration) : '—'}
                        </td>
                        <td className="py-1 px-2 font-mono text-xs text-muted-foreground text-right">
                          {formatTime(call.startTime)}
                        </td>
                        <td className="py-1 px-2 text-right">
                          <span
                            className={cn(
                              'font-mono text-[10px] font-bold px-1.5 py-0.5 rounded',
                              call.state === 'ended' && call.duration > 0
                                ? 'bg-primary/10 text-primary'
                                : 'bg-rose-500/10 text-rose-400'
                            )}
                          >
                            {call.state === 'ended' && call.duration > 0 ? 'COMPLETED' : 'MISSED'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DenseCard>
        </div>
      </div>
    </CompactPageShell>
  );
}
