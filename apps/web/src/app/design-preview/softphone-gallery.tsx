'use client';

import Link from 'next/link';
import * as React from 'react';

import { ApplicationLogForm } from '@/components/call-center/ApplicationLogForm';
import { SegmentedItem, Segmented } from '@/components/domain/segmented';
import { ThemeScope } from '@/components/domain/theme-scope';
import { AgentStatusMenu } from '@/components/phone/agent-status-selector';
import { AvailabilityToggle } from '@/components/phone/availability-switch';
import type { AgentStatus, ProspectData, ScreenPopField } from '@/components/phone/phone-provider';
import { ScreenPopView } from '@/components/phone/screen-pop';
import {
  ActiveCallView,
  AGENT_STATUS_LABEL,
  CallerIdSelect,
  ConnectionNotice,
  DeviceSettings,
  IdleView,
  IncomingCallView,
  Keypad,
  RecentCallsList,
  ShortcutsSheet,
  SoftphoneLauncher,
  SoftphoneShell,
  WrapUpView,
  type IdleTab,
  type RecentCallItem,
  type SoftphoneState,
} from '@/components/phone/softphone';

/**
 * Every softphone state, from mock calls, with no PhoneProvider and no SIP.
 *
 * The softphone's pieces are presentational (props in, callbacks out), so
 * this file stands in for usePhone(): it holds a little local state so the
 * controls respond when clicked, and nothing else. Timers are frozen so
 * screenshots are repeatable.
 */

/* ------------------------------- scenarios -------------------------------- */

export const SOFTPHONE_SCENARIOS = [
  { id: 'launcher-ready', label: 'Launcher · ready' },
  { id: 'launcher-incoming', label: 'Launcher · ringing' },
  { id: 'launcher-oncall', label: 'Launcher · on a call' },
  { id: 'launcher-offline', label: 'Launcher · offline' },
  { id: 'offline', label: 'Offline' },
  { id: 'connecting', label: 'Connecting' },
  { id: 'ready', label: 'Ready' },
  { id: 'incoming', label: 'Incoming' },
  { id: 'dialing', label: 'Calling out' },
  { id: 'connected', label: 'Connected' },
  { id: 'connected-keypad', label: 'Connected · muted, keypad' },
  { id: 'hold', label: 'On hold' },
  { id: 'wrapup', label: 'Wrap-up' },
  { id: 'wrapup-application', label: 'Wrap-up · application' },
  { id: 'recent', label: 'Recent calls' },
  { id: 'recent-empty', label: 'Recent · empty' },
  { id: 'recent-loading', label: 'Recent · loading' },
  { id: 'settings', label: 'Settings' },
  { id: 'mic-denied', label: 'Mic blocked' },
  { id: 'error', label: 'Error notice' },
  { id: 'shortcuts', label: 'Shortcuts sheet' },
  { id: 'minimized', label: 'Minimised on a call' },
] as const;

export type SoftphoneScenario = (typeof SOFTPHONE_SCENARIOS)[number]['id'];

export function isScenario(value: string | null | undefined): value is SoftphoneScenario {
  return SOFTPHONE_SCENARIOS.some(s => s.id === value);
}

/* --------------------------------- data ----------------------------------- */

// Fixed so relative times read the same in every screenshot.
const NOW = new Date('2026-09-25T15:30:00');
const minutesAgo = (m: number): Date => new Date(NOW.getTime() - m * 60_000);

const CALLER = {
  name: 'Maria Delgado',
  number: '+18135550142',
  source: 'Final Expense — Florida',
  location: 'Tampa, FL',
};

const PROSPECT: ProspectData = {
  fullName: 'Maria Delgado',
  phoneNumber: '(813) 555-0142',
  email: 'maria.delgado@example.com',
  leadSource: 'Facebook — FE 65+',
  campaignName: 'Final Expense — Florida',
  city: 'Tampa',
  state: 'FL',
};

const SCREEN_POP_FIELDS: ScreenPopField[] = [
  { id: 'fullName', label: 'Full name', key: 'fullName', enabled: true, order: 1 },
  { id: 'phoneNumber', label: 'Phone number', key: 'phoneNumber', enabled: true, order: 2 },
  { id: 'email', label: 'Email', key: 'email', enabled: true, order: 3 },
  { id: 'leadSource', label: 'Lead source', key: 'leadSource', enabled: true, order: 9 },
  { id: 'campaignName', label: 'Campaign', key: 'campaignName', enabled: true, order: 10 },
];

const RECENT: RecentCallItem[] = [
  {
    id: 'r1',
    direction: 'inbound',
    name: 'Maria Delgado',
    number: '+18135550142',
    durationSeconds: 754,
    startedAt: minutesAgo(4),
  },
  {
    id: 'r2',
    direction: 'outbound',
    number: '+14075550198',
    durationSeconds: 96,
    startedAt: minutesAgo(38),
  },
  {
    id: 'r3',
    direction: 'inbound',
    number: '+13055550111',
    durationSeconds: 0,
    startedAt: minutesAgo(130),
    missed: true,
  },
  {
    id: 'r4',
    direction: 'outbound',
    name: 'James Whitfield',
    number: '+19045550177',
    durationSeconds: 3902,
    startedAt: minutesAgo(60 * 20),
  },
  {
    id: 'r5',
    direction: 'inbound',
    name: 'Dorothy Pruitt',
    number: '+18505550163',
    durationSeconds: 312,
    startedAt: minutesAgo(60 * 24 * 3),
  },
];

const CALLER_IDS = [
  { id: 'n1', number: '+18135550100' },
  { id: 'n2', number: '+14075550100' },
];

const DEVICES = {
  inputs: [
    { deviceId: 'mic-1', label: 'MacBook Pro Microphone' },
    { deviceId: 'mic-2', label: 'Jabra Evolve2 65' },
  ],
  outputs: [
    { deviceId: 'spk-1', label: 'MacBook Pro Speakers' },
    { deviceId: 'spk-2', label: 'Jabra Evolve2 65' },
  ],
};

/* ------------------------------ the mock phone ------------------------------ */

const noop = (): void => {};

function stateFor(scenario: SoftphoneScenario, onHold: boolean): SoftphoneState {
  switch (scenario) {
    case 'offline':
    case 'launcher-offline':
      return 'offline';
    case 'connecting':
      return 'connecting';
    case 'incoming':
    case 'launcher-incoming':
      return 'incoming';
    case 'dialing':
    case 'connected':
    case 'connected-keypad':
    case 'launcher-oncall':
    case 'minimized':
      return onHold ? 'hold' : 'connected';
    case 'hold':
      return 'hold';
    case 'wrapup':
    case 'wrapup-application':
      return 'wrapup';
    default:
      return 'ready';
  }
}

/**
 * One softphone in one scenario. `placement="floating"` renders it exactly as
 * the app does (fixed, a bottom sheet under 640px); `inline` sits in flow for
 * the side-by-side gallery.
 */
export function MockSoftphone({
  scenario,
  placement = 'inline',
}: {
  scenario: SoftphoneScenario;
  placement?: 'floating' | 'inline';
}): JSX.Element {
  const [agentStatus, setAgentStatus] = React.useState<AgentStatus>('available');
  const [available, setAvailable] = React.useState(true);
  const [muted, setMuted] = React.useState(scenario === 'connected-keypad');
  const [onHold, setOnHold] = React.useState(scenario === 'hold');
  const [keypadOpen, setKeypadOpen] = React.useState(scenario === 'connected-keypad');
  const [tones, setTones] = React.useState(scenario === 'connected-keypad' ? '1#' : '');
  const [number, setNumber] = React.useState(scenario === 'ready' ? '8135550142' : '');
  const [tab, setTab] = React.useState<IdleTab>(
    scenario.startsWith('recent') ? 'history' : scenario === 'settings' ? 'settings' : 'dialpad'
  );
  const [shortcuts, setShortcuts] = React.useState(scenario === 'shortcuts');
  const [minimized, setMinimized] = React.useState(scenario === 'minimized');
  const [callerId, setCallerId] = React.useState(CALLER_IDS[0].number);
  const [mic, setMic] = React.useState('mic-2');
  const [speaker, setSpeaker] = React.useState('spk-2');

  // Wrap-up form state, as GlobalDispositionModal holds it.
  const [disposition, setDisposition] = React.useState(
    scenario === 'wrapup-application' ? 'APPLICATION_SUBMITTED' : 'SET_CALLBACK'
  );
  const [notes, setNotes] = React.useState(
    scenario === 'wrapup' ? 'Wants to talk it over with her son first. Call after 5pm.' : ''
  );
  const [followDate, setFollowDate] = React.useState('2026-09-28');
  const [followTime, setFollowTime] = React.useState('17:30');

  const state = stateFor(scenario, onHold);
  const failed = scenario === 'offline' || scenario === 'launcher-offline';

  if (scenario.startsWith('launcher-')) {
    return (
      <SoftphoneLauncher
        state={state}
        statusLabel={AGENT_STATUS_LABEL[agentStatus]}
        callSeconds={754}
        failed={failed}
        onOpen={noop}
        onReconnect={noop}
        placement={placement}
      />
    );
  }

  const notices =
    scenario === 'offline' ? (
      <ConnectionNotice kind="failed" onReconnect={noop} />
    ) : scenario === 'connecting' ? (
      <ConnectionNotice kind="retrying" attempts={3} />
    ) : scenario === 'mic-denied' ? (
      <ConnectionNotice kind="mic-denied" />
    ) : scenario === 'error' ? (
      <ConnectionNotice
        kind="error"
        error="SIP connection lost"
        onReconnect={noop}
        onDismiss={noop}
      />
    ) : null;

  const onCall = state === 'connected' || state === 'hold';
  const holdScenario = scenario === 'hold';

  let body: React.ReactNode;
  if (state === 'incoming') {
    body = (
      <IncomingCallView
        callerName={CALLER.name}
        phoneNumber={CALLER.number}
        source={CALLER.source}
        location={CALLER.location}
        ringSeconds={7}
        onAnswer={noop}
        onDecline={noop}
      >
        <ScreenPopView data={PROSPECT} fields={SCREEN_POP_FIELDS} variant="modal" />
      </IncomingCallView>
    );
  } else if (onCall) {
    body = (
      <ActiveCallView
        callerName={scenario === 'dialing' ? null : CALLER.name}
        phoneNumber={scenario === 'dialing' ? '+14075550198' : CALLER.number}
        source={scenario === 'dialing' ? null : CALLER.source}
        location={scenario === 'dialing' ? null : CALLER.location}
        callSeconds={holdScenario ? 3725 : 754}
        dialing={scenario === 'dialing'}
        isMuted={muted}
        isOnHold={onHold}
        holdSeconds={holdScenario ? 72 : 0}
        keypadOpen={keypadOpen}
        hasHeldCalls={holdScenario}
        onMute={() => setMuted(m => !m)}
        onHold={() => setOnHold(h => !h)}
        onKeypad={() => setKeypadOpen(k => !k)}
        onTransfer={noop}
        onAddCall={noop}
        onMerge={noop}
        onHangup={noop}
        keypad={
          <Keypad mode="dtmf" size="compact" value={tones} onDigit={d => setTones(t => t + d)} />
        }
      >
        {scenario === 'connected' ? (
          <ScreenPopView data={PROSPECT} fields={SCREEN_POP_FIELDS} />
        ) : null}
      </ActiveCallView>
    );
  } else {
    body = (
      <IdleView tab={tab} onTabChange={setTab}>
        {tab === 'dialpad' ? (
          <Keypad
            size="compact"
            value={number}
            onChange={setNumber}
            onDigit={d => setNumber(n => n + d)}
            onBackspace={() => setNumber(n => n.slice(0, -1))}
            onDial={noop}
            dialDisabled={state === 'offline' || state === 'connecting'}
            header={<CallerIdSelect numbers={CALLER_IDS} value={callerId} onChange={setCallerId} />}
          />
        ) : tab === 'history' ? (
          <RecentCallsList
            items={scenario === 'recent-empty' ? [] : RECENT}
            loading={scenario === 'recent-loading'}
            now={NOW}
            onRedial={noop}
            onOpenKeypad={() => setTab('dialpad')}
          />
        ) : (
          <DeviceSettings
            inputs={DEVICES.inputs}
            outputs={DEVICES.outputs}
            input={mic}
            output={speaker}
            onInputChange={setMic}
            onOutputChange={setSpeaker}
            onConfigureScreenPop={noop}
          />
        )}
      </IdleView>
    );
  }

  const shell = (
    <SoftphoneShell
      state={state}
      label={
        scenario === 'connecting'
          ? 'Reconnecting (3)'
          : scenario === 'dialing'
            ? 'Calling'
            : undefined
      }
      statusSlot={
        <>
          <AgentStatusMenu value={agentStatus} onCall={onCall} onChange={setAgentStatus} />
          <AvailabilityToggle available={available} onToggle={() => setAvailable(a => !a)} />
        </>
      }
      callSeconds={754}
      notices={notices}
      minimized={minimized}
      onToggleMinimized={() => setMinimized(m => !m)}
      onClose={noop}
      onSettings={() => setTab('settings')}
      onShortcuts={() => setShortcuts(true)}
      placement={placement}
      overlay={shortcuts ? <ShortcutsSheet onClose={() => setShortcuts(false)} /> : null}
    >
      {body}
    </SoftphoneShell>
  );

  if (state !== 'wrapup') return shell;

  const wrapUp = (
    <WrapUpView
      call={{
        phoneNumber: CALLER.number,
        callerName: CALLER.name,
        direction: 'inbound',
        duration: 754,
      }}
      selected={disposition}
      onSelect={setDisposition}
      notes={notes}
      onNotesChange={setNotes}
      followUpDate={followDate}
      followUpTime={followTime}
      onFollowUpDateChange={setFollowDate}
      onFollowUpTimeChange={setFollowTime}
      canSave={disposition !== 'APPLICATION_SUBMITTED'}
      saving={false}
      saved={false}
      onSave={noop}
      onSkip={noop}
      applicationSlot={
        <ApplicationLogForm
          prefill={{ phone: CALLER.number, firstName: 'Maria', lastName: 'Delgado' }}
          onChange={noop}
        />
      }
      placement={placement === 'floating' ? 'overlay' : 'inline'}
    />
  );

  // Floating: the panel behind, the wrap-up card over it, as in the app.
  // Inline: the card on its own, since there is no page for it to cover.
  return placement === 'floating' ? (
    <>
      {shell}
      {wrapUp}
    </>
  ) : (
    wrapUp
  );
}

/* -------------------------------- gallery --------------------------------- */

/**
 * The /design-preview section: pick a state, see it in light and dark side by
 * side. Each state also has its own full-screen page, which is what renders it
 * floating and as a phone-width bottom sheet.
 */
export function SoftphoneGallery(): JSX.Element {
  const [scenario, setScenario] = React.useState<SoftphoneScenario>('connected');

  return (
    <div className="space-y-4">
      <Segmented className="flex flex-wrap gap-1" aria-label="Softphone state">
        {SOFTPHONE_SCENARIOS.map(s => (
          <SegmentedItem
            key={s.id}
            active={scenario === s.id}
            onClick={() => setScenario(s.id)}
            aria-pressed={scenario === s.id}
          >
            {s.label}
          </SegmentedItem>
        ))}
      </Segmented>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(['light', 'dark'] as const).map(theme => (
          <ThemeScope key={theme} theme={theme} className="rounded-card border border-rule p-6">
            <div className="t-label mb-3 flex items-center justify-between text-ink-3">
              <span>{theme}</span>
              <Link
                href={`/design-preview/softphone?state=${scenario}&theme=${theme}`}
                className="normal-case tracking-normal text-brand-ink underline-offset-4 hover:underline"
              >
                Open full screen
              </Link>
            </div>
            <div className="flex min-h-[200px] items-start justify-center">
              {/* key: a fresh mock per state, so its seeded local state applies. */}
              <MockSoftphone key={scenario} scenario={scenario} />
            </div>
          </ThemeScope>
        ))}
      </div>
    </div>
  );
}
