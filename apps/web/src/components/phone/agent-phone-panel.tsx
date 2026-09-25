'use client';

import { CheckCircle2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useCustomerIntake } from '@/contexts/customer-intake-context';
import {
  DEFAULT_INTAKE_DATA,
  type Beneficiary,
  type CustomerIntakeData,
} from '@/types/customer-intake-types';

import { AddCallDialog } from './add-call-dialog';
import { AgentStatusSelector } from './agent-status-selector';
import { AvailabilitySwitch } from './availability-switch';
import { CallControls } from './call-controls';
import { CallTransferDialog } from './call-transfer-dialog';
import { CustomerDetailsPanel } from './CustomerDetailsPanel';
import { DialPad } from './dial-pad';
import { IncomingCallModal } from './incoming-call-modal';
import { usePhone } from './phone-provider';
import { ScreenPop } from './screen-pop';
import { ScreenPopSettings } from './screen-pop-settings';
import { ConnectionNotice } from './softphone/connection-notice';
import {
  AGENT_STATUS_LABEL,
  deriveSoftphoneState,
  formatPhoneNumber,
  isDialing,
  knownCallerName,
  mergeRecentCalls,
  type ApiCallRow,
} from './softphone/format';
import { useMicPermission, useRingingTitle, useSoftphoneShortcuts } from './softphone/hooks';
import { CallerIdSelect, DeviceSettings, IdleView, type IdleTab } from './softphone/idle-view';
import { SoftphoneLauncher } from './softphone/launcher';
import { RecentCallsList } from './softphone/recent-calls';
import { SoftphoneShell } from './softphone/shell';
import type { ShortcutAction } from './softphone/shortcuts';
import { ShortcutsSheet } from './softphone/shortcuts-sheet';

// ============================================================================
// Agent Phone Panel — the floating softphone
// ============================================================================

/*
 * This file is the wiring: it reads the provider, keeps the panel's own UI
 * state (tab, dialogs, minimised) and hands values to the presentational
 * pieces in ./softphone. Everything visual lives there, which is what lets
 * /design-preview render every state from mock data with no SIP behind it.
 */

interface MatchedProspect {
  id: string;
  firstName?: string;
  lastName?: string;
  phone: string;
  email?: string;
  dob?: string;
  city?: string;
  state?: string;
  carrier?: string;
  policyType?: string;
  coverageAmount?: number;
  monthlyPremium?: number;
  beneficiaries?: Array<{ name: string; relationship: string }>;
  bankName?: string;
  accountType?: string;
}

const extractDigits = (phone: string): string => phone.replace(/\D/g, '');

/**
 * The API prospect in the intake form's shape, for CustomerDetailsPanel. The
 * API's strings are not narrowed to the form's unions, hence the casts; the
 * panel only displays them.
 */
function prospectToIntake(p: MatchedProspect): CustomerIntakeData {
  return {
    ...DEFAULT_INTAKE_DATA,
    firstName: p.firstName || '',
    lastName: p.lastName || '',
    phone: p.phone || '',
    email: p.email || '',
    dateOfBirth: p.dob ? new Date(p.dob).toISOString().split('T')[0] : '',
    city: p.city || '',
    state: p.state || '',
    carrier: (p.carrier || '') as CustomerIntakeData['carrier'],
    policyType: (p.policyType || '') as CustomerIntakeData['policyType'],
    coverage: p.coverageAmount || 0,
    monthlyPremium: p.monthlyPremium || 0,
    bankName: p.bankName || '',
    accountType: (p.accountType || '') as CustomerIntakeData['accountType'],
    primaryBeneficiaries: (p.beneficiaries || []).map((b, i) => ({
      id: `api-${i}`,
      name: b.name,
      relationship: b.relationship as Beneficiary['relationship'],
    })),
  };
}

export function AgentPhonePanel(): JSX.Element | null {
  const {
    agentStatus,
    currentCall,
    isPhonePanelOpen,
    phoneStatus,
    phoneAttempts,
    reconnectPhone,
    closePhonePanel,
    openPhonePanel,
    setDialerNumber,
    error,
    clearError,
    userNumbers,
    selectedCallerId,
    setSelectedCallerId,
    pendingDispositionCall,
    answerCall,
    hangupCall,
    toggleMute,
    toggleHold,
  } = usePhone();

  // Customer Intake Context - shares data with CustomerIntakeForm
  const { formData } = useCustomerIntake();

  const [minimized, setMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState<IdleTab>('dialpad');
  const [showScreenPopSettings, setShowScreenPopSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [dialog, setDialog] = useState<'transfer' | 'add' | null>(null);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [customerDetailsExpanded, setCustomerDetailsExpanded] = useState(false);
  const [intakeMatchDetected, setIntakeMatchDetected] = useState(false);
  const [matchedProspect, setMatchedProspect] = useState<MatchedProspect | null>(null);

  const micPermission = useMicPermission();

  const state = deriveSoftphoneState({
    phoneStatus,
    agentStatus,
    currentCall,
    hasPendingDisposition: Boolean(pendingDispositionCall),
  });
  const onCall = state === 'connected' || state === 'hold';

  // Check if intake form phone is valid (10 digits)
  const intakePhoneDigits = useMemo(() => extractDigits(formData?.phone || ''), [formData?.phone]);
  const isIntakePhoneValid = intakePhoneDigits.length === 10;

  // ─────────────────────────────────────────────────────────────────────────
  // Auto-Open on Valid Phone: When form phone reaches 10 digits, open panel
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isIntakePhoneValid && !isPhonePanelOpen) {
      openPhonePanel?.();
      setDialerNumber?.(intakePhoneDigits);
    }
  }, [isIntakePhoneValid, isPhonePanelOpen, openPhonePanel, setDialerNumber, intakePhoneDigits]);

  // ─────────────────────────────────────────────────────────────────────────
  // Incoming call matching: does the ringing number belong to a known prospect
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const matchIntake = (digits: string): void => {
      if (isIntakePhoneValid && digits.slice(-10) === intakePhoneDigits) {
        setIntakeMatchDetected(true);
        setCustomerDetailsExpanded(true);
        setMinimized(false);
        openPhonePanel?.();
      }
    };

    const lookupProspect = async (phoneNumber: string): Promise<void> => {
      const digits = extractDigits(phoneNumber);
      if (digits.length < 10) return;

      try {
        const apiUrl =
          typeof window !== 'undefined'
            ? window.location.origin
            : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const response = await fetch(`${apiUrl}/api/v1/prospects/by-phone/${digits}`);
        const data = (await response.json()) as { found?: boolean; prospect?: MatchedProspect };

        if (data.found && data.prospect) {
          setMatchedProspect(data.prospect);
          setIntakeMatchDetected(true);
          setCustomerDetailsExpanded(true);
          setMinimized(false);
          openPhonePanel?.();
        } else {
          // No database match, check context as fallback
          matchIntake(digits);
        }
      } catch (err) {
        console.error('[AgentPhonePanel] Prospect lookup error:', err);
        matchIntake(digits);
      }
    };

    if (currentCall?.state === 'ringing' && currentCall.direction === 'inbound') {
      void lookupProspect(currentCall.phoneNumber || '');
    } else if (!currentCall || currentCall.state === 'ended') {
      // Reset match detection when call ends
      setIntakeMatchDetected(false);
      setMatchedProspect(null);
    }
  }, [currentCall, intakePhoneDigits, isIntakePhoneValid, openPhonePanel]);

  // A new call starts with the keypad closed and no dialog left over.
  useEffect(() => {
    if (!onCall) {
      setKeypadOpen(false);
      setDialog(null);
    }
  }, [onCall]);

  // An incoming call always shows in full, even if the panel was minimised.
  useEffect(() => {
    if (state === 'incoming') setMinimized(false);
  }, [state]);

  const prospectName = matchedProspect
    ? [matchedProspect.firstName, matchedProspect.lastName].filter(Boolean).join(' ') || null
    : null;
  const ringingLabel = currentCall
    ? knownCallerName(currentCall.callerName) ||
      prospectName ||
      formatPhoneNumber(currentCall.phoneNumber)
    : '';
  useRingingTitle(state === 'incoming', ringingLabel || 'Unknown caller');

  const handleShortcut = useCallback(
    (action: ShortcutAction) => {
      switch (action) {
        case 'answer':
          answerCall();
          break;
        case 'decline':
          hangupCall();
          break;
        case 'mute':
          toggleMute();
          break;
        case 'hold':
          toggleHold();
          break;
        case 'keypad':
          if (!isPhonePanelOpen) openPhonePanel();
          setMinimized(false);
          if (onCall) setKeypadOpen(open => !open);
          else setActiveTab('dialpad');
          break;
        case 'close':
          if (showShortcuts) setShowShortcuts(false);
          else if (isPhonePanelOpen) closePhonePanel();
          break;
        case 'help':
          if (!isPhonePanelOpen) openPhonePanel();
          setMinimized(false);
          setShowShortcuts(true);
          break;
        default:
          break;
      }
    },
    [
      answerCall,
      hangupCall,
      toggleMute,
      toggleHold,
      isPhonePanelOpen,
      openPhonePanel,
      closePhonePanel,
      onCall,
      showShortcuts,
    ]
  );

  // Off while a dialog with its own fields is up: its Esc and letters are its own.
  useSoftphoneShortcuts(
    state,
    phoneStatus !== 'disabled' && dialog === null && !showScreenPopSettings,
    handleShortcut
  );

  // ============================================================================
  // Closed: the launcher
  // ============================================================================

  /*
   * No phone for this user at all -- not an agent, or a platform operator with
   * no agency selected. Render nothing rather than a launcher that opens onto
   * a phone that was never going to connect.
   */
  if (phoneStatus === 'disabled') return null;

  if (!isPhonePanelOpen) {
    /*
     * The launcher says when the phone is not working. It is the one piece of
     * the softphone on screen at all times, and it used to show a green
     * "Available" whether or not the phone had ever registered.
     */
    return (
      <SoftphoneLauncher
        state={state}
        statusLabel={AGENT_STATUS_LABEL[agentStatus]}
        callSeconds={currentCall?.duration ?? 0}
        attempts={phoneAttempts}
        failed={phoneStatus === 'failed'}
        onOpen={openPhonePanel}
        onReconnect={reconnectPhone}
      />
    );
  }

  // ============================================================================
  // Open: the panel
  // ============================================================================

  const notices = (
    <>
      {phoneStatus === 'failed' ? (
        <ConnectionNotice kind="failed" onReconnect={reconnectPhone} />
      ) : null}
      {phoneStatus === 'retrying' ? (
        <ConnectionNotice kind="retrying" attempts={phoneAttempts} />
      ) : null}
      {micPermission === 'denied' ? <ConnectionNotice kind="mic-denied" /> : null}
      {error && phoneStatus !== 'retrying' && phoneStatus !== 'failed' ? (
        <ConnectionNotice
          kind="error"
          error={error}
          onReconnect={reconnectPhone}
          onDismiss={clearError}
        />
      ) : null}
    </>
  );
  const hasNotices =
    phoneStatus === 'failed' ||
    phoneStatus === 'retrying' ||
    micPermission === 'denied' ||
    Boolean(error);

  const customerData: CustomerIntakeData | null = matchedProspect
    ? prospectToIntake(matchedProspect)
    : formData && (formData.firstName || formData.lastName || formData.phone)
      ? formData
      : null;

  const customerDetails = customerData ? (
    <CustomerDetailsPanel
      formData={customerData}
      isExpanded={customerDetailsExpanded}
      onToggle={() => setCustomerDetailsExpanded(!customerDetailsExpanded)}
    />
  ) : null;

  const matchBadge = intakeMatchDetected ? (
    <div className="flex items-center gap-2 border-b border-rule bg-sunken px-4 py-2">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-ink" aria-hidden />
      <span className="truncate text-xs font-medium text-ink">
        {matchedProspect
          ? `Matched to a saved prospect${prospectName ? `: ${prospectName}` : ''}`
          : 'Matched to the intake form'}
      </span>
    </div>
  ) : null;

  let body: JSX.Element;
  if (state === 'incoming' && currentCall) {
    body = (
      <IncomingCallModal
        call={currentCall}
        prospectName={prospectName}
        city={matchedProspect?.city}
        state={matchedProspect?.state}
      >
        {currentCall.prospectData ? (
          <ScreenPop data={currentCall.prospectData} variant="modal" />
        ) : null}
      </IncomingCallModal>
    );
  } else if (onCall && currentCall) {
    body = (
      <>
        {matchBadge}
        <CallControls
          location={
            matchedProspect
              ? [matchedProspect.city, matchedProspect.state].filter(Boolean).join(', ') || null
              : null
          }
          keypadOpen={keypadOpen}
          onKeypadToggle={() => setKeypadOpen(open => !open)}
          onTransfer={() => setDialog('transfer')}
          onAddCall={() => setDialog('add')}
        >
          {currentCall.prospectData || customerDetails ? (
            <div className="space-y-3">
              {currentCall.prospectData ? <ScreenPop data={currentCall.prospectData} /> : null}
              {customerDetails ? (
                <div className="overflow-hidden rounded-card border border-rule">
                  {customerDetails}
                </div>
              ) : null}
            </div>
          ) : null}
        </CallControls>
      </>
    );
  } else {
    body = (
      <IdleView
        tab={activeTab}
        onTabChange={setActiveTab}
        lead={
          <>
            {matchBadge}
            {customerDetails}
          </>
        }
      >
        {activeTab === 'dialpad' ? (
          <DialPad
            compact
            captureKeyboard={!showShortcuts}
            header={
              <CallerIdSelect
                numbers={userNumbers}
                value={selectedCallerId}
                onChange={setSelectedCallerId}
              />
            }
          />
        ) : activeTab === 'history' ? (
          <CallHistory onOpenKeypad={() => setActiveTab('dialpad')} />
        ) : (
          <PhoneSettings onConfigureScreenPop={() => setShowScreenPopSettings(true)} />
        )}
      </IdleView>
    );
  }

  return (
    <>
      {showScreenPopSettings && (
        <ScreenPopSettings onClose={() => setShowScreenPopSettings(false)} />
      )}
      {dialog === 'transfer' && <CallTransferDialog onClose={() => setDialog(null)} />}
      {dialog === 'add' && <AddCallDialog onClose={() => setDialog(null)} />}

      <SoftphoneShell
        state={state}
        label={
          state === 'connecting' && phoneAttempts > 1
            ? `Reconnecting (${phoneAttempts})`
            : isDialing(currentCall)
              ? 'Calling'
              : undefined
        }
        statusSlot={
          <>
            {/*
              Two different facts, deliberately side by side. The selector
              reports what the SOFTPHONE is doing; the switch is what the
              AGENT decided, and it is the one routing obeys.
            */}
            <AgentStatusSelector />
            <AvailabilitySwitch />
          </>
        }
        callSeconds={currentCall?.duration}
        notices={hasNotices ? notices : null}
        minimized={minimized}
        onToggleMinimized={() => setMinimized(m => !m)}
        onClose={closePhonePanel}
        onSettings={() => {
          setMinimized(false);
          setActiveTab('settings');
        }}
        onShortcuts={() => setShowShortcuts(true)}
        overlay={showShortcuts ? <ShortcutsSheet onClose={() => setShowShortcuts(false)} /> : null}
      >
        {body}
      </SoftphoneShell>
    </>
  );
}

// ============================================================================
// Recent calls
// ============================================================================

function CallHistory({ onOpenKeypad }: { onOpenKeypad: () => void }): JSX.Element {
  const { callHistory, makeCall } = usePhone();
  const [apiCalls, setApiCalls] = useState<ApiCallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => new Date());

  // "3m ago" should not stay "3m ago" for an hour.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let active = true;
    const fetchCalls = async (): Promise<void> => {
      setLoading(true);
      setFailed(false);
      try {
        const apiUrl = typeof window !== 'undefined' ? window.location.origin : '';
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (typeof window !== 'undefined') {
          const demoMode = localStorage.getItem('demoMode') === 'true';
          const demoTenantId = localStorage.getItem('demoTenantId');
          if (demoMode && demoTenantId) {
            headers['X-Demo-Tenant-Id'] = demoTenantId;
          }
        }
        const response = await fetch(`${apiUrl}/api/v1/calls?limit=20`, { headers });
        if (!response.ok) throw new Error(`calls ${response.status}`);
        const data = (await response.json()) as
          | ApiCallRow[]
          | { data?: ApiCallRow[]; calls?: ApiCallRow[] };
        const callsArray = Array.isArray(data)
          ? data
          : Array.isArray(data.data)
            ? data.data
            : data.calls || [];
        if (active) setApiCalls(callsArray);
      } catch (err) {
        console.error('[CallHistory] Failed to fetch calls:', err);
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void fetchCalls();
    return () => {
      active = false;
    };
  }, [attempt]);

  const items = useMemo(() => mergeRecentCalls(callHistory, apiCalls), [callHistory, apiCalls]);

  return (
    <RecentCallsList
      items={items}
      loading={loading && items.length === 0}
      error={failed}
      now={now}
      onRedial={number => void makeCall(number)}
      onRetry={() => setAttempt(a => a + 1)}
      onOpenKeypad={onOpenKeypad}
    />
  );
}

// ============================================================================
// Settings
// ============================================================================

function PhoneSettings({
  onConfigureScreenPop,
}: {
  onConfigureScreenPop: () => void;
}): JSX.Element {
  const { audioDevices, selectedAudioInput, selectedAudioOutput, setAudioInput, setAudioOutput } =
    usePhone();

  const toOption = (d: MediaDeviceInfo, fallback: string): { deviceId: string; label: string } => ({
    deviceId: d.deviceId,
    label: d.label || `${fallback} ${d.deviceId.slice(0, 8)}`,
  });

  return (
    <DeviceSettings
      inputs={audioDevices.filter(d => d.kind === 'audioinput').map(d => toOption(d, 'Microphone'))}
      outputs={audioDevices.filter(d => d.kind === 'audiooutput').map(d => toOption(d, 'Speaker'))}
      input={selectedAudioInput}
      output={selectedAudioOutput}
      onInputChange={setAudioInput}
      onOutputChange={setAudioOutput}
      onConfigureScreenPop={onConfigureScreenPop}
    />
  );
}

export default AgentPhonePanel;
