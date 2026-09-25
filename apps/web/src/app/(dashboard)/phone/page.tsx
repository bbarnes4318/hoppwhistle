'use client';

import { Activity, Clock, History, Keyboard, Settings } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { KPICard } from '@/components/dashboard/kpi-card';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { usePhone, type CallInfo } from '@/components/phone';
import { AgentStatusSelector } from '@/components/phone/agent-status-selector';
import { AvailabilitySwitch } from '@/components/phone/availability-switch';
import { DialPad } from '@/components/phone/dial-pad';
import { ScreenPopSettings } from '@/components/phone/screen-pop-settings';
import {
  deriveSoftphoneState,
  formatDurationShort,
  mergeRecentCalls,
  SOFTPHONE_STATE_META,
} from '@/components/phone/softphone/format';
import { CallerIdSelect } from '@/components/phone/softphone/idle-view';
import { StateDot, TONE_TEXT } from '@/components/phone/softphone/parts';
import { RecentCallsList } from '@/components/phone/softphone/recent-calls';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ============================================================================
// Phone Page - Full Screen Softphone
// ============================================================================

export default function PhonePage(): JSX.Element {
  const {
    callHistory,
    makeCall,
    phoneStatus,
    agentStatus,
    currentCall,
    pendingDispositionCall,
    isPhonePanelOpen,
    userNumbers,
    selectedCallerId,
    setSelectedCallerId,
  } = usePhone();
  const [showSettings, setShowSettings] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const state = deriveSoftphoneState({
    phoneStatus,
    agentStatus,
    currentCall,
    hasPendingDisposition: Boolean(pendingDispositionCall),
  });
  const meta = SOFTPHONE_STATE_META[state];

  const todaysCalls = callHistory.filter((c: CallInfo) => {
    const today = new Date();
    return c.startTime && c.startTime.toDateString() === today.toDateString();
  });
  const inboundCalls = todaysCalls.filter((c: CallInfo) => c.direction === 'inbound').length;
  const outboundCalls = todaysCalls.filter((c: CallInfo) => c.direction === 'outbound').length;
  const totalDuration = todaysCalls.reduce((sum: number, c: CallInfo) => sum + c.duration, 0);

  const recent = useMemo(() => mergeRecentCalls(callHistory, []), [callHistory]);

  return (
    <div className="page-canvas">
      {showSettings && <ScreenPopSettings onClose={() => setShowSettings(false)} />}

      <PageHeader
        description="Place calls, set your status and look back over today's calls"
        actions={
          <>
            <span className="inline-flex items-center gap-2 rounded-control border border-rule bg-surface px-2.5 py-1">
              <StateDot tone={meta.tone} />
              <span className={cn('text-xs font-semibold', TONE_TEXT[meta.tone])}>
                {meta.label}
              </span>
            </span>
            <AgentStatusSelector />
            {/*
             * Beside it, not inside it: the selector reports what the softphone
             * is doing, this is what the agent decided, and it is the one
             * routing obeys.
             */}
            <AvailabilitySwitch className="rounded-control border border-rule bg-surface px-2.5 py-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSettings(true)}
              className="gap-1.5"
            >
              <Settings className="h-3.5 w-3.5" aria-hidden />
              Screen pop fields
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-1">
          <PanelHeader>
            <PanelTitle className="flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-ink-3" aria-hidden />
              Keypad
            </PanelTitle>
          </PanelHeader>
          <PanelBody>
            {/*
             * The floating softphone has its own keypad, and both listening
             * to the keyboard would type every digit twice. This one listens
             * only while the floating one is closed.
             */}
            <DialPad
              compact
              captureKeyboard={!isPhonePanelOpen}
              header={
                <CallerIdSelect
                  numbers={userNumbers}
                  value={selectedCallerId}
                  onChange={setSelectedCallerId}
                />
              }
            />
          </PanelBody>
        </Panel>

        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <KPICard
              title="Calls today"
              value={todaysCalls.length}
              icon={Activity}
              trendLabel={`${inboundCalls} in · ${outboundCalls} out`}
              className="space-y-2 border-rule p-3 pb-2.5"
            />
            <KPICard
              title="Talk time today"
              value={totalDuration > 0 ? formatDurationShort(totalDuration) : '0m 00s'}
              icon={Clock}
              className="space-y-2 border-rule p-3 pb-2.5"
            />
          </div>

          <Panel className="min-w-0">
            <PanelHeader>
              <PanelTitle className="flex items-center gap-2">
                <History className="h-4 w-4 text-ink-3" aria-hidden />
                Recent calls
              </PanelTitle>
            </PanelHeader>
            <PanelBody>
              <RecentCallsList
                items={recent}
                now={now}
                onRedial={number => void makeCall(number)}
              />
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  );
}
