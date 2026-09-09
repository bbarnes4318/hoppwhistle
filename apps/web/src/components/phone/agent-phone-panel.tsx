/* eslint-disable */
'use client';

import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Keyboard,
  Pause,
  Phone,
  PhoneForwarded,
  PhoneOff,
  Settings,
  User,
  X,
} from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';

import { AgentStatusSelector } from './agent-status-selector';
import { CallControls } from './call-controls';
import { CustomerDetailsPanel } from './CustomerDetailsPanel';
import { DialPad } from './dial-pad';
import { IncomingCallModal } from './incoming-call-modal';
import { usePhone, type AgentStatus, type CallInfo } from './phone-provider';
import { ScreenPop } from './screen-pop';
import { ScreenPopSettings } from './screen-pop-settings';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useCustomerIntake } from '@/contexts/customer-intake-context';
import { cn } from '@/lib/utils';

// ============================================================================
// Agent Phone Panel - Main Softphone Component
// ============================================================================

export function AgentPhonePanel(): JSX.Element | null {
  const {
    agentStatus,
    currentCall,
    isPhonePanelOpen,
    phoneStatus,
    phoneAttempts,
    reconnectPhone,
    closePhonePanel,
    togglePhonePanel,
    openPhonePanel,
    setDialerNumber,
    error,
    clearError,
    userNumbers,
    selectedCallerId,
    setSelectedCallerId,
  } = usePhone();

  // Customer Intake Context - shares data with CustomerIntakeForm
  const { formData } = useCustomerIntake();

  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<'dialpad' | 'history' | 'settings'>('dialpad');
  const [showSettings, setShowSettings] = useState(false);
  const [customerDetailsExpanded, setCustomerDetailsExpanded] = useState(false);
  const [intakeMatchDetected, setIntakeMatchDetected] = useState(false);

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: Extract digits from phone number
  // ─────────────────────────────────────────────────────────────────────────
  const extractDigits = (phone: string): string => phone.replace(/\D/g, '');

  // Check if intake form phone is valid (10 digits)
  const intakePhoneDigits = useMemo(() => extractDigits(formData?.phone || ''), [formData?.phone]);
  const isIntakePhoneValid = intakePhoneDigits.length === 10;

  // ─────────────────────────────────────────────────────────────────────────
  // Auto-Open on Valid Phone: When form phone reaches 10 digits, open panel
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isIntakePhoneValid && !isPhonePanelOpen) {
      // Auto-open the phone panel when a valid phone number is entered
      openPhonePanel?.();
      // Pre-fill the dialer with the intake phone number
      setDialerNumber?.(intakePhoneDigits);
    }
  }, [isIntakePhoneValid, isPhonePanelOpen, openPhonePanel, setDialerNumber, intakePhoneDigits]);

  // Incoming Call Matching: Check if incoming number matches stored prospect data
  // ─────────────────────────────────────────────────────────────────────────

  // State for API-fetched prospect data
  const [matchedProspect, setMatchedProspect] = useState<{
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
  } | null>(null);

  useEffect(() => {
    const lookupProspect = async (phoneNumber: string) => {
      const digits = extractDigits(phoneNumber);
      if (digits.length < 10) return;

      try {
        const apiUrl =
          typeof window !== 'undefined'
            ? window.location.origin
            : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const response = await fetch(`${apiUrl}/api/v1/prospects/by-phone/${digits}`);
        const data = await response.json();

        if (data.found && data.prospect) {
          console.log('[AgentPhonePanel] Matched prospect:', data.prospect);
          setMatchedProspect(data.prospect);
          setIntakeMatchDetected(true);
          setCustomerDetailsExpanded(true);
          setIsExpanded(true);
          openPhonePanel?.();
        } else {
          // No database match, check context as fallback
          const incomingLast10 = digits.slice(-10);
          if (isIntakePhoneValid && incomingLast10 === intakePhoneDigits) {
            setIntakeMatchDetected(true);
            setCustomerDetailsExpanded(true);
            setIsExpanded(true);
            openPhonePanel?.();
          }
        }
      } catch (error) {
        console.error('[AgentPhonePanel] Prospect lookup error:', error);
        // Fallback to context matching on API error
        const incomingLast10 = digits.slice(-10);
        if (isIntakePhoneValid && incomingLast10 === intakePhoneDigits) {
          setIntakeMatchDetected(true);
          setCustomerDetailsExpanded(true);
          setIsExpanded(true);
          openPhonePanel?.();
        }
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

  // Format duration as MM:SS
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Get status color
  const getStatusColor = (status: AgentStatus): string => {
    switch (status) {
      case 'available':
        return 'bg-live';
      case 'on-call':
        return 'bg-ringing';
      case 'away':
        return 'bg-dropped';
      case 'dnd':
        return 'bg-blocked';
      case 'offline':
        return 'bg-ink-3';
      default:
        return 'bg-ink-3';
    }
  };

  // ============================================================================
  // Floating Phone Button (when panel is closed)
  // ============================================================================

  /*
   * No phone for this user at all -- not an agent, or a platform operator with
   * no agency selected. Render nothing rather than a launcher that opens onto
   * a phone that was never going to connect.
   */
  if (phoneStatus === 'disabled') return null;

  /*
   * The phone is not working, and the launcher says so.
   *
   * This is the whole of the "no visible indication" problem. The launcher is
   * the one piece of the softphone that is on screen at all times, and it
   * showed the agent's status -- "Available", in green -- whether or not the
   * phone had ever registered. An agent whose SIP init was failing saw a
   * healthy-looking control while calls went nowhere, and the only evidence
   * anywhere was a console line they were never going to read.
   */
  if (!isPhonePanelOpen && (phoneStatus === 'retrying' || phoneStatus === 'failed')) {
    return (
      <button
        onClick={phoneStatus === 'failed' ? reconnectPhone : togglePhonePanel}
        className={cn(
          'fixed bottom-6 right-6 z-50',
          'flex items-center gap-3 px-5 py-3 rounded-full',
          'bg-dropped text-white font-medium shadow-sm',
          'border border-rule transition-all duration-300 ease-out hover:scale-105'
        )}
        aria-label={
          phoneStatus === 'failed' ? 'Phone disconnected. Try again.' : 'Phone reconnecting'
        }
      >
        <PhoneOff className="w-5 h-5" />
        <span>
          {phoneStatus === 'failed'
            ? 'Phone disconnected — try again'
            : `Phone reconnecting (${phoneAttempts})`}
        </span>
        <span className="w-2.5 h-2.5 rounded-full bg-surface/80" />
      </button>
    );
  }

  if (!isPhonePanelOpen) {
    return (
      <button
        onClick={togglePhonePanel}
        className={cn(
          'fixed bottom-6 right-6 z-50',
          'flex items-center gap-3 px-5 py-3 rounded-full',
          'bg-brand',
          'text-ink font-medium shadow-sm',
          'transition-all duration-300 ease-out',
          'hover:scale-105 hover:bg-brand-ink hover:text-surface',
          'border border-rule',
          currentCall?.state === 'ringing' && 'animate-pulse'
        )}
        aria-label="Open phone"
      >
        <div className="relative">
          <Phone className="w-5 h-5" />
          {currentCall?.state === 'ringing' && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-ringing rounded-full animate-ping" />
          )}
        </div>
        <span className="capitalize">{agentStatus === 'on-call' ? 'On Call' : agentStatus}</span>
        <span className={cn('w-2.5 h-2.5 rounded-full', getStatusColor(agentStatus))} />
      </button>
    );
  }

  // ============================================================================
  // Main Phone Panel
  // ============================================================================

  return (
    <>
      {/* Incoming Call Modal */}
      {currentCall?.state === 'ringing' && currentCall.direction === 'inbound' && (
        <IncomingCallModal call={currentCall} />
      )}

      {/* Screen Pop Settings Modal */}
      {showSettings && <ScreenPopSettings onClose={() => setShowSettings(false)} />}

      {/* Phone Panel */}
      <Card
        className={cn(
          'fixed bottom-4 right-4 z-40',
          'w-[340px] overflow-hidden flex flex-col',
          'bg-surface border border-rule',
          'shadow-lg',
          'transition-all duration-300 ease-out',
          isExpanded ? 'h-[500px] max-h-[calc(100vh-32px)]' : 'h-[44px]'
        )}
      >
        {/* Header */}
        <CardHeader className="p-2 flex flex-row items-center justify-between border-b border-rule space-y-0 flex-shrink-0 bg-sunken">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'w-7 h-7 rounded flex items-center justify-center bg-primary/10 border border-primary/20'
              )}
            >
              <Phone className="w-3.5 h-3.5 text-primary flex-shrink-0" />
            </div>
            <div>
              <h3 className="font-bold text-ink text-xs leading-none">Softphone</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <AgentStatusSelector />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {currentCall?.state === 'active' && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 bg-live-tint rounded mr-1">
                <span className="w-1.5 h-1.5 bg-live rounded-full animate-pulse" />
                <span className="text-live-ink text-[10px] font-mono leading-none">
                  {formatDuration(currentCall.duration)}
                </span>
              </div>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-ink-3 hover:text-ink"
              onClick={() => setShowSettings(true)}
            >
              <Settings className="w-3.5 h-3.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-ink-3 hover:text-ink"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-ink-3 hover:text-ink"
              onClick={closePhonePanel}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardHeader>

        {/* Connection state, and the way back from a failed one. */}
        {(phoneStatus === 'retrying' || phoneStatus === 'failed') && (
          <div className="px-4 py-2 bg-dropped-tint border-b border-dropped/40">
            <div className="flex items-center justify-between gap-2">
              <span className="text-dropped-ink text-xs">
                {phoneStatus === 'failed'
                  ? 'The phone is not connected. Calls will not reach you.'
                  : `Reconnecting the phone (attempt ${phoneAttempts})…`}
              </span>
              {phoneStatus === 'failed' && (
                <button
                  onClick={reconnectPhone}
                  className="shrink-0 rounded border border-dropped/40 px-2 py-0.5 text-xs text-dropped-ink hover:opacity-80"
                >
                  Try again
                </button>
              )}
            </div>
          </div>
        )}

        {/* Error Banner */}
        {error && phoneStatus !== 'retrying' && phoneStatus !== 'failed' && (
          <div className="px-4 py-2 bg-dropped-tint border-b border-dropped/40">
            <div className="flex items-center justify-between">
              <span className="text-dropped-ink text-xs">{error}</span>
              <button onClick={clearError} className="text-dropped-ink hover:opacity-80">
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Intake Match Badge */}
        {intakeMatchDetected && (
          <div className="px-4 py-2 bg-live-tint border-b border-live/40">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-live-ink" />
              <span className="text-live-ink text-xs font-medium">
                {matchedProspect ? 'Matched to Database Record' : 'Matched to Intake Form'}
              </span>
              {matchedProspect && (
                <span className="text-live-ink/70 text-xs">
                  ({matchedProspect.firstName} {matchedProspect.lastName})
                </span>
              )}
            </div>
          </div>
        )}

        {isExpanded && (
          <div className="flex-1 overflow-y-auto min-h-0">
            {/* Customer Details Panel - Shows API prospect data or context form data */}
            {(matchedProspect ||
              (formData && (formData.firstName || formData.lastName || formData.phone))) && (
              <CustomerDetailsPanel
                formData={
                  matchedProspect
                    ? {
                        firstName: matchedProspect.firstName || '',
                        lastName: matchedProspect.lastName || '',
                        phone: matchedProspect.phone || '',
                        email: matchedProspect.email || '',
                        dateOfBirth: matchedProspect.dob
                          ? new Date(matchedProspect.dob).toISOString().split('T')[0]
                          : '',
                        city: matchedProspect.city || '',
                        state: matchedProspect.state || '',
                        carrier: matchedProspect.carrier || '',
                        policyType: matchedProspect.policyType || '',
                        coverage: matchedProspect.coverageAmount || 0,
                        monthlyPremium: matchedProspect.monthlyPremium || 0,
                        bankName: matchedProspect.bankName || '',
                        accountType: matchedProspect.accountType || '',
                        primaryBeneficiaries: (matchedProspect.beneficiaries || []).map((b, i) => ({
                          id: `api-${i}`,
                          name: b.name,
                          relationship: b.relationship as
                            | 'spouse'
                            | 'child'
                            | 'parent'
                            | 'sibling'
                            | 'other',
                        })),
                        // Fill in other defaults for context data shape
                        stateOfBirth: '',
                        address: '',
                        zip: '',
                        tobaccoUser: false,
                        ssPayment: false,
                        ssPayDay: '',
                        firstPayDay: 0,
                        futurePayDay: 0,
                        secondaryBeneficiaryName: '',
                        secondaryBeneficiaryRelationship: 'spouse',
                        nameOnAccount: '',
                        routingNumber: '',
                        accountNumber: '',
                        ssn: '',
                      }
                    : formData
                }
                isExpanded={customerDetailsExpanded}
                onToggle={() => setCustomerDetailsExpanded(!customerDetailsExpanded)}
              />
            )}

            <CardContent className="p-0">
              {/* Active Call View */}
              {currentCall && currentCall.state !== 'ringing' && currentCall.state !== 'ended' && (
                <div className="p-4 space-y-4">
                  {/* Screen Pop */}
                  {currentCall.prospectData && <ScreenPop data={currentCall.prospectData} />}

                  {/* Caller Info */}
                  <div className="text-center py-4">
                    <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-primary flex items-center justify-center border border-brand/30">
                      <User className="w-8 h-8 text-ink" />
                    </div>
                    <h4 className="text-ink font-semibold text-lg">
                      {currentCall.callerName || 'Unknown Caller'}
                    </h4>
                    <p className="text-ink-3 text-sm">{currentCall.phoneNumber}</p>
                    {currentCall.queueName && (
                      <p className="text-brand-ink text-xs mt-1">From: {currentCall.queueName}</p>
                    )}
                  </div>

                  {/* Call Status Indicator */}
                  {currentCall.isOnHold && (
                    <div className="flex items-center justify-center gap-2 py-2 bg-ringing-tint rounded-lg">
                      <Pause className="w-4 h-4 text-ringing-ink" />
                      <span className="text-ringing-ink text-sm">Call On Hold</span>
                    </div>
                  )}

                  {/* Call Controls */}
                  <CallControls />
                </div>
              )}

              {/* Idle View - Dialpad & Tabs */}
              {(!currentCall || currentCall.state === 'ended') && (
                <div className="p-4 space-y-4">
                  {/* Tab Navigation */}
                  <div className="flex gap-1 p-1 bg-sunken rounded-lg">
                    {(['dialpad', 'history', 'settings'] as const).map(tab => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                          'flex-1 py-2 px-3 rounded-md text-xs font-medium transition-all',
                          activeTab === tab
                            ? 'bg-brand text-brand-fg'
                            : 'text-ink-3 hover:text-ink hover:bg-sunken'
                        )}
                      >
                        {tab === 'dialpad' && <Keyboard className="w-3.5 h-3.5 inline mr-1.5" />}
                        {tab === 'history' && <Clock className="w-3.5 h-3.5 inline mr-1.5" />}
                        {tab === 'settings' && <Settings className="w-3.5 h-3.5 inline mr-1.5" />}
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                      </button>
                    ))}
                  </div>

                  {/* Tab Content */}
                  {activeTab === 'dialpad' && (
                    <>
                      <CallerIdSelector />
                      <DialPad compact={true} />
                    </>
                  )}
                  {activeTab === 'history' && <CallHistory />}
                  {activeTab === 'settings' && <PhoneSettings />}
                </div>
              )}
            </CardContent>
          </div>
        )}
      </Card>
    </>
  );
}

// ============================================================================
// Call History Component
// ============================================================================

function CallHistory(): JSX.Element {
  const { callHistory, makeCall } = usePhone();
  const [apiCalls, setApiCalls] = useState<
    Array<{
      id: string;
      direction: string;
      phoneNumber?: string;
      callerNumber?: string;
      destinationNumber?: string;
      callerName?: string;
      duration?: number;
      status?: string;
      startedAt?: string;
      createdAt?: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCalls = async () => {
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
        if (response.ok) {
          const data = await response.json();
          const callsArray = Array.isArray(data.data)
            ? data.data
            : Array.isArray(data)
              ? data
              : data.calls || [];
          setApiCalls(callsArray);
        }
      } catch (err) {
        console.error('[CallHistory] Failed to fetch calls:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchCalls();
  }, []);

  const formatTime = (dateStr?: string | Date): string => {
    if (!dateStr) return '';
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleCallClick = (phoneNumber: string) => {
    void makeCall(phoneNumber);
  };

  // Merge: session calls + API calls, deduped
  const apiCallIds = new Set(apiCalls.map(c => c.id));
  const sessionCalls = callHistory.filter(c => !apiCallIds.has(c.callId));

  if (loading) {
    return (
      <div className="text-center py-8">
        <Clock className="w-10 h-10 mx-auto mb-3 text-ink-3 animate-pulse" />
        <p className="text-ink-3 text-sm">Loading calls...</p>
      </div>
    );
  }

  if (apiCalls.length === 0 && sessionCalls.length === 0) {
    return (
      <div className="text-center py-8">
        <Clock className="w-10 h-10 mx-auto mb-3 text-ink-3" />
        <p className="text-ink-3 text-sm">No recent calls</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[300px] overflow-y-auto">
      {/* Current session calls not yet in DB */}
      {sessionCalls.map((call: CallInfo, index: number) => {
        const isInbound = call.direction === 'inbound';
        return (
          <button
            key={`s-${call.callId}-${index}`}
            onClick={() => handleCallClick(call.phoneNumber)}
            className={cn(
              'w-full p-3 rounded-lg text-left transition-all',
              'bg-sunken hover:bg-rule border border-transparent hover:border-rule'
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center',
                    isInbound ? 'bg-ringing-tint text-ringing-ink' : 'bg-money-tint text-money-ink'
                  )}
                >
                  {isInbound ? (
                    <Phone className="w-4 h-4" />
                  ) : (
                    <PhoneForwarded className="w-4 h-4" />
                  )}
                </div>
                <div>
                  <p className="text-ink text-sm font-medium">
                    {call.callerName || call.phoneNumber}
                  </p>
                  <p className="text-ink-3 text-xs">
                    {isInbound ? 'Incoming' : 'Outgoing'}
                    {call.duration > 0 &&
                      ` • ${Math.floor(call.duration / 60)}m ${call.duration % 60}s`}
                  </p>
                </div>
              </div>
              <span className="text-ink-3 text-xs">{formatTime(call.startTime)}</span>
            </div>
          </button>
        );
      })}
      {/* API-backed calls from database */}
      {apiCalls.map(call => {
        const isInbound = call.direction === 'INBOUND';
        const phone = isInbound
          ? call.callerId || call.callerNumber || call.phoneNumber || ''
          : call.toNumber || call.destinationNumber || call.phoneNumber || '';
        const dur = call.duration || 0;
        return (
          <button
            key={call.id}
            onClick={() => handleCallClick(phone)}
            className={cn(
              'w-full p-3 rounded-lg text-left transition-all',
              'bg-sunken hover:bg-rule border border-transparent hover:border-rule'
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center',
                    isInbound ? 'bg-ringing-tint text-ringing-ink' : 'bg-money-tint text-money-ink'
                  )}
                >
                  {isInbound ? (
                    <Phone className="w-4 h-4" />
                  ) : (
                    <PhoneForwarded className="w-4 h-4" />
                  )}
                </div>
                <div>
                  <p className="text-ink text-sm font-medium">{phone || 'Unknown'}</p>
                  <p className="text-ink-3 text-xs">
                    {isInbound ? 'Incoming' : 'Outgoing'}
                    {dur > 0 && ` • ${Math.floor(dur / 60)}m ${dur % 60}s`}
                  </p>
                </div>
              </div>
              <span className="text-ink-3 text-xs">
                {formatTime(call.startedAt || call.createdAt)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Phone Settings Component
// ============================================================================

function PhoneSettings(): JSX.Element {
  const { audioDevices, selectedAudioInput, selectedAudioOutput, setAudioInput, setAudioOutput } =
    usePhone();

  const inputDevices = audioDevices.filter(d => d.kind === 'audioinput');
  const outputDevices = audioDevices.filter(d => d.kind === 'audiooutput');

  return (
    <div className="space-y-4">
      {/* Microphone Selection */}
      <div>
        <label className="block text-xs text-ink-3 mb-2">Microphone</label>
        <select
          value={selectedAudioInput ?? ''}
          onChange={e => setAudioInput(e.target.value)}
          className={cn(
            'w-full px-3 py-2 rounded-lg text-sm',
            'bg-surface border border-rule',
            'text-ink focus:border-brand-ink focus:ring-1 focus:ring-brand-ink',
            'outline-none transition-all'
          )}
        >
          {inputDevices.map(device => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
            </option>
          ))}
        </select>
      </div>

      {/* Speaker Selection */}
      <div>
        <label className="block text-xs text-ink-3 mb-2">Speaker</label>
        <select
          value={selectedAudioOutput ?? ''}
          onChange={e => setAudioOutput(e.target.value)}
          className={cn(
            'w-full px-3 py-2 rounded-lg text-sm',
            'bg-surface border border-rule',
            'text-ink focus:border-brand-ink focus:ring-1 focus:ring-brand-ink',
            'outline-none transition-all'
          )}
        >
          {outputDevices.map(device => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Speaker ${device.deviceId.slice(0, 8)}`}
            </option>
          ))}
        </select>
      </div>

      {/* Screen Pop Configuration Link */}
      <div className="pt-2 border-t border-rule">
        <p className="text-ink-3 text-xs mb-2">
          Configure which prospect fields appear during incoming calls.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-full border-rule text-ink-2 hover:bg-sunken"
        >
          <Settings className="w-4 h-4 mr-2" />
          Configure Screen Pop Fields
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Caller ID Selector Component
// ============================================================================

function CallerIdSelector(): JSX.Element | null {
  const { userNumbers, selectedCallerId, setSelectedCallerId } = usePhone();

  // Format phone number for display
  const formatPhone = (num: string): string => {
    const digits = num.replace(/\D/g, '');
    const d = digits.length === 11 ? digits.slice(1) : digits;
    if (d.length === 10) {
      return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    }
    return num;
  };

  if (userNumbers.length === 0) return null;

  return (
    <div className="mb-1.5">
      <label className="flex items-center gap-1.5 text-[10px] text-ink-3 mb-1">
        <Phone className="w-2.5 h-2.5 text-primary" />
        Calling from:
      </label>
      <select
        value={selectedCallerId || ''}
        onChange={e => setSelectedCallerId(e.target.value)}
        className={cn(
          'w-full px-2 py-1 rounded text-xs',
          'bg-surface border border-rule',
          'text-ink focus:border-primary focus:ring-1 focus:ring-primary',
          'outline-none transition-all cursor-pointer'
        )}
      >
        {userNumbers.map(num => (
          <option key={num.id} value={num.number}>
            {formatPhone(num.number)}
          </option>
        ))}
      </select>
    </div>
  );
}

export default AgentPhonePanel;
