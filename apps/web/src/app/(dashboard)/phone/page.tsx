'use client';

import { Clock, Phone, PhoneCall, PhoneIncoming, PhoneOutgoing, Settings } from 'lucide-react';
import { useState } from 'react';

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
      <div className="flex items-center justify-between flex-shrink-0 mb-6">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              'w-12 h-12 rounded-xl flex items-center justify-center',
              'bg-gradient-to-br from-cyan-500/20 to-blue-500/20',
              'border border-cyan-500/30'
            )}
          >
            <Phone className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Agent Phone</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-muted-foreground">Status:</span>
              <AgentStatusSelector />
            </div>
          </div>
        </div>

        <Button variant="outline" onClick={() => setShowSettings(true)} className="gap-2">
          <Settings className="w-4 h-4" />
          Screen Pop Settings
        </Button>
      </div>

      {/* Main Content Grid */}
      <div className="flex-1 grid gap-6 lg:grid-cols-3 min-h-0 overflow-auto">
        {/* Left Column - Dial Pad */}
        <Card className="lg:row-span-2">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Phone className="w-5 h-5 text-cyan-500" />
              Make a Call
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DialPad />
          </CardContent>
        </Card>

        {/* Stats Cards */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Today&apos;s Calls
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-4">
              <span className="text-4xl font-bold">{todaysCalls.length}</span>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <PhoneIncoming className="w-4 h-4 text-cyan-500" />
                  {inboundCalls}
                </span>
                <span className="flex items-center gap-1">
                  <PhoneOutgoing className="w-4 h-4 text-neon-violet" />
                  {outboundCalls}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Talk Time Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold">{formatDuration(totalDuration)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Call History */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-cyan-500" />
              Recent Calls
            </CardTitle>
          </CardHeader>
          <CardContent>
            {callHistory.length === 0 ? (
              <div className="text-center py-12">
                <PhoneCall className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
                <p className="text-muted-foreground">No recent calls</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  Your call history will appear here
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {callHistory.slice(0, 20).map((call: CallInfo, index: number) => (
                  <div
                    key={`${call.callId}-${index}`}
                    className={cn(
                      'flex items-center gap-4 p-4 rounded-xl',
                      'bg-muted/30 hover:bg-muted/50 transition-colors'
                    )}
                  >
                    <div
                      className={cn(
                        'w-10 h-10 rounded-full flex items-center justify-center',
                        call.direction === 'inbound'
                          ? 'bg-neon-cyan/10 text-neon-cyan'
                          : 'bg-neon-violet/10 text-neon-violet'
                      )}
                    >
                      {call.direction === 'inbound' ? (
                        <PhoneIncoming className="w-5 h-5" />
                      ) : (
                        <PhoneOutgoing className="w-5 h-5" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{call.callerName ?? call.phoneNumber}</p>
                      <p className="text-sm text-muted-foreground">
                        {call.direction === 'inbound' ? 'Incoming' : 'Outgoing'}
                        {call.duration > 0 && ` • ${formatDuration(call.duration)}`}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">{formatTime(call.startTime)}</p>
                      <p
                        className={cn(
                          'text-xs',
                          call.state === 'ended' && call.duration > 0
                            ? 'text-emerald-500'
                            : 'text-muted-foreground'
                        )}
                      >
                        {call.state === 'ended' && call.duration > 0 ? 'Completed' : 'Missed'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
