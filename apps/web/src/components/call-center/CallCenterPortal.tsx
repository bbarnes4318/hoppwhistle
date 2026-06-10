'use client';

// ============================================================================
// CallCenterPortal.tsx - COMPLETE PORT FROM fe-rickie/CallPopApp.jsx
// Exact 1:1 port with zero UI/functionality differences
// ============================================================================

import { Phone, FileText, Headphones, LogIn, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useState, useEffect, useRef, useCallback } from 'react';

import { ActiveCallControls } from './ActiveCallControls';
import { ApplicationQueue } from './ApplicationQueue';
import { CallCenterHeader } from './CallCenterHeader';
import { DialerPanel } from './DialerPanel';
import { DispositionPanel } from './DispositionPanel';
import { IncomingCallPanel } from './IncomingCallPanel';
import IntegratedScriptPanel from './IntegratedScriptPanel';
import RetentionScriptPanel from './RetentionScriptPanel';
import { StatsStrip } from './StatsStrip';
import type {
  ActiveCallView,
  AgentStatus,
  ApplicationData,
  CallRecord,
  CurrentView,
  ProspectData,
  SelectedScript,
} from './types';
import UnderwritingScriptPanel from './UnderwritingScriptPanel';
import { WorkspaceTabs } from './WorkspaceTabs';

import { usePhone } from '@/components/phone/phone-provider';
import { useLeadInjection } from '@/hooks/useLeadInjection';
import { useScriptAccess } from '@/hooks/useUserRoles';
import { apiClient } from '@/lib/api';

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export function CallCenterPortal(): JSX.Element {
  const router = useRouter();
  const { currentCall, makeCall, hangupCall, answerCall, toggleMute, toggleHold } = usePhone();

  // Lead Injection - Pre-call data from webhooks
  const { leadData, lookupLead, clearLead } = useLeadInjection();
  const [preInjectedData, setPreInjectedData] = useState<ProspectData | null>(null);

  // State - Default directly to agentDashboard (skip role selection menu)
  const [currentView, setCurrentView] = useState<CurrentView>('agentDashboard');
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('available');

  // Call State
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);
  const [showDisposition, setShowDisposition] = useState(false);
  const [dispositionSaved, setDispositionSaved] = useState(false);
  const [incomingCallData, setIncomingCallData] = useState<ProspectData | null>(null);
  const [activeCallData, setActiveCallData] = useState<ProspectData | null>(null);
  const [activeCallView, setActiveCallView] = useState<ActiveCallView>('script');

  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  const [thirdPartyConnected, setThirdPartyConnected] = useState(false);
  const [isAddingThirdParty, setIsAddingThirdParty] = useState(false);

  // Ringtone Audio
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const [ringDuration, setRingDuration] = useState(0);
  const ringTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Dialer
  const [phoneNumber, setPhoneNumber] = useState('');
  const [callTimer, setCallTimer] = useState(0);
  const [callNotes, setCallNotes] = useState('');
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Track disposition state to prevent duplicate prompts
  const dispositionHandledRef = useRef<boolean>(false);
  const callSessionIdRef = useRef<string | null>(null);
  const callEndedTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Disposition
  const [selectedDisposition, setSelectedDisposition] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpTime, setFollowUpTime] = useState('');

  // Leads & Records
  const [applications, setApplications] = useState<ApplicationData[]>([]);
  const [loadingApplications, setLoadingApplications] = useState(false);
  const [, setCallRecords] = useState<CallRecord[]>([]);

  // User Settings & Stats
  const [showSettings, setShowSettings] = useState(false);
  const [appointmentsCount, setAppointmentsCount] = useState(0);
  const [totalCallsCount, setTotalCallsCount] = useState(0);
  const [followUpCount, setFollowUpCount] = useState(0);

  // Script Selection - Default to Contractor Sales Script
  const [selectedScript, setSelectedScript] = useState<SelectedScript>('sales');

  // Database-driven role and script access
  const {
    canAccessRetentionScript,
    derivedJobTitle,
    loading: rolesLoading,
    isAdminOrOwner,
  } = useScriptAccess();

  // Calculate appointment rate: (Appointments / Total Calls) * 100
  const appointmentRate =
    totalCallsCount > 0 ? ((appointmentsCount / totalCallsCount) * 100).toFixed(1) : '0.0';

  // ─────────────────────────────────────────────────────────────────────────
  // SYNC WITH PHONE HOOK - React to incoming/active calls from sip.js
  // Fixed: Disposition modal now only triggers on genuine CALL_ENDED event
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Case 1: No active call from the SIP hook
    if (!currentCall) {
      // Only trigger disposition if we HAD an active call and haven't already handled it
      // Use a debounce to avoid false triggers from SIP state flickers
      if (isCallActive && !dispositionHandledRef.current && callSessionIdRef.current) {
        // Wait 2 seconds to confirm the call is truly ended (not a flicker)
        if (!callEndedTimerRef.current) {
          callEndedTimerRef.current = setTimeout(() => {
            // Re-check conditions after debounce
            if (!dispositionHandledRef.current && callSessionIdRef.current) {
              console.log('[CallCenter] Call ended - triggering disposition modal');
              if (callTimerRef.current) clearInterval(callTimerRef.current);
              dispositionHandledRef.current = true;
              setIsCallActive(false);
              setShowDisposition(true);
              setAgentStatus('available');
            }
            callEndedTimerRef.current = null;
          }, 2000);
        }
      }
      setIsIncomingCall(false);
      return;
    }

    // If call comes back (was just a flicker), cancel the debounce
    if (callEndedTimerRef.current) {
      clearTimeout(callEndedTimerRef.current);
      callEndedTimerRef.current = null;
    }

    // Case 2: Incoming call ringing
    if (currentCall.state === 'ringing' && currentCall.direction === 'inbound') {
      setIsIncomingCall(true);
      setIncomingCallData({
        caller_id: currentCall.phoneNumber,
        first_name: currentCall.callerName || 'Incoming',
        last_name: 'Call',
        phone: currentCall.phoneNumber,
        ...currentCall.prospectData,
      } as ProspectData);
      setAgentStatus('on_call');
    }

    // Case 3: Call is active (connected)
    if (currentCall.state === 'active' || currentCall.state === 'connecting') {
      // New call session - reset disposition tracking
      if (!callSessionIdRef.current || callSessionIdRef.current !== currentCall.callId) {
        callSessionIdRef.current = currentCall.callId || `call-${Date.now()}`;
        dispositionHandledRef.current = false;
        console.log('[CallCenter] New call session started:', callSessionIdRef.current);
      }

      setIsIncomingCall(false);
      setIsCallActive(true);
      setAgentStatus('on_call');

      // Set active call data if not already set
      if (!activeCallData) {
        setActiveCallData({
          caller_id: currentCall.phoneNumber,
          first_name:
            currentCall.callerName || currentCall.direction === 'outbound'
              ? 'Outbound'
              : 'Incoming',
          last_name: 'Call',
          phone: currentCall.phoneNumber,
          ...currentCall.prospectData,
        } as ProspectData);
      }

      // Start timer if not already running
      if (!callTimerRef.current) {
        setCallTimer(0);
        callTimerRef.current = setInterval(() => {
          setCallTimer(prev => prev + 1);
        }, 1000);
      }
    }

    // Sync mute/hold state from phone hook
    setIsMuted(currentCall.isMuted);
    setIsOnHold(currentCall.isOnHold);
  }, [currentCall, isCallActive, activeCallData]);

  // ─────────────────────────────────────────────────────────────────────────
  // LEAD INJECTION HANDLER - Pre-populate UI with webhook data
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (leadData) {
      console.log('[CallCenter] Pre-call lead data received:', leadData);
      setPreInjectedData(leadData as ProspectData);

      // If we're already on a call with matching phone, merge the data
      if (activeCallData) {
        const activePhone = (activeCallData.caller_id || activeCallData.phone || '').replace(
          /\D/g,
          ''
        );
        const leadPhone = (leadData.caller_id || leadData.phone || '').replace(/\D/g, '');

        if (
          activePhone &&
          leadPhone &&
          (activePhone === leadPhone ||
            activePhone.endsWith(leadPhone) ||
            leadPhone.endsWith(activePhone))
        ) {
          console.log('[CallCenter] Merging lead data with active call');
          setActiveCallData(
            prev =>
              ({
                ...prev,
                ...leadData,
                // Preserve any existing phone info
                caller_id: prev?.caller_id || leadData.caller_id,
                phone: prev?.phone || leadData.phone,
              }) as ProspectData
          );
        }
      }
    }
  }, [leadData, activeCallData]);

  // ─────────────────────────────────────────────────────────────────────────
  // INCOMING CALL DATA ENRICHMENT - Lookup pre-injected data when call arrives
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isIncomingCall && incomingCallData?.caller_id) {
      // Check if we have pre-injected data for this caller
      const callerPhone = incomingCallData.caller_id.replace(/\D/g, '');
      const preInjectedPhone = (preInjectedData?.caller_id || preInjectedData?.phone || '').replace(
        /\D/g,
        ''
      );

      if (
        preInjectedPhone &&
        (callerPhone === preInjectedPhone ||
          callerPhone.endsWith(preInjectedPhone) ||
          preInjectedPhone.endsWith(callerPhone))
      ) {
        console.log('[CallCenter] Enriching incoming call with pre-injected data');
        setIncomingCallData(
          prev =>
            ({
              ...prev,
              ...preInjectedData,
              caller_id: prev?.caller_id, // Keep the original caller_id
            }) as ProspectData
        );
      } else {
        // Try to lookup from the API
        lookupLead(callerPhone)
          .then(lead => {
            if (lead) {
              console.log('[CallCenter] Enriching incoming call with API lookup data');
              setIncomingCallData(
                prev =>
                  ({
                    ...prev,
                    ...lead,
                    caller_id: prev?.caller_id,
                  }) as ProspectData
              );
            }
          })
          .catch(() => {
            // Lookup failed, continue with basic data
          });
      }
    }
  }, [isIncomingCall, incomingCallData?.caller_id, preInjectedData, lookupLead]);

  // Helper Functions
  const formatPhoneNumber = (value: string): string => {
    const cleaned = value.replace(/\D/g, '');
    const match = cleaned.match(/^(\d{0,3})(\d{0,3})(\d{0,4})$/);
    if (!match) return value;
    let formatted = '';
    if (match[1]) formatted = '(' + match[1];
    if (match[1]?.length === 3) formatted += ') ';
    if (match[2]) formatted += match[2];
    if (match[2]?.length === 3) formatted += '-';
    if (match[3]) formatted += match[3];
    return formatted;
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
  };

  const handleKeypadPress = (key: string) => {
    if (phoneNumber.replace(/\D/g, '').length < 10) {
      setPhoneNumber(prev => formatPhoneNumber(prev.replace(/\D/g, '') + key));
    }
  };

  // Call Handlers
  // Pre-create and unlock ringtone on first user interaction to bypass autoplay restrictions
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (!ringtoneRef.current) {
        ringtoneRef.current = new Audio('/sounds/ringtone.mp3');
        ringtoneRef.current.loop = true;
      }

      const unlock = () => {
        if (ringtoneRef.current) {
          ringtoneRef.current.play()
            .then(() => {
              ringtoneRef.current?.pause();
              ringtoneRef.current!.currentTime = 0;
            })
            .catch(() => {});
        }
        window.removeEventListener('click', unlock);
        window.removeEventListener('keydown', unlock);
      };

      window.addEventListener('click', unlock);
      window.addEventListener('keydown', unlock);

      return () => {
        window.removeEventListener('click', unlock);
        window.removeEventListener('keydown', unlock);
      };
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // RINGTONE AUDIO - Play/stop ringtone on incoming call
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isIncomingCall) {
      // Start ringtone
      if (!ringtoneRef.current) {
        ringtoneRef.current = new Audio('/sounds/ringtone.mp3');
        ringtoneRef.current.loop = true;
      }
      ringtoneRef.current.play().catch(() => {
        /* ignore autoplay block */
      });

      // Start ring duration counter
      setRingDuration(0);
      ringTimerRef.current = setInterval(() => {
        setRingDuration(prev => prev + 1);
      }, 1000);
    } else {
      // Stop ringtone
      if (ringtoneRef.current) {
        ringtoneRef.current.pause();
        ringtoneRef.current.currentTime = 0;
      }
      if (ringTimerRef.current) {
        clearInterval(ringTimerRef.current);
        ringTimerRef.current = null;
      }
      setRingDuration(0);
    }

    return () => {
      if (ringtoneRef.current) {
        ringtoneRef.current.pause();
        ringtoneRef.current.currentTime = 0;
      }
      if (ringTimerRef.current) {
        clearInterval(ringTimerRef.current);
      }
    };
  }, [isIncomingCall]);

  // ─────────────────────────────────────────────────────────────────────────
  // KEYBOARD SHORTCUTS - A to answer, D to decline incoming calls
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isIncomingCall) return;

    const handleKeydown = (e: KeyboardEvent) => {
      // Ignore if typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        void handleAnswerCall();
      } else if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        void handleDeclineCall();
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIncomingCall]);

  const handleAnswerCall = async () => {
    try {
      await answerCall(); // Use hook's answer method for SIP
    } catch (e) {
      console.error('Failed to answer call:', e);
    }
    // State updates happen via useEffect watching currentCall
    setIsIncomingCall(false);
    setIsCallActive(true);
    setActiveCallData(incomingCallData);
    setActiveCallView('script'); // Ensure script pops up immediately
    setAgentStatus('on_call');
    setCallTimer(0);

    // Increment total calls on every answered call
    setTotalCallsCount(prev => prev + 1);

    callTimerRef.current = setInterval(() => {
      setCallTimer(prev => prev + 1);
    }, 1000);
  };

  const handleDeclineCall = async () => {
    try {
      await hangupCall(); // Rejecting an incoming call via hangup
    } catch (e) {
      console.error('Failed to decline call:', e);
    }
    setIsIncomingCall(false);
    setIncomingCallData(null);
    setAgentStatus('available');
  };

  const handleHangup = async () => {
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    try {
      await hangupCall();
    } catch (e) {
      console.error(e);
    }

    // Only show disposition once per call session
    if (!dispositionHandledRef.current && callSessionIdRef.current) {
      dispositionHandledRef.current = true;
      setShowDisposition(true);
    }

    setIsCallActive(false);
    setAgentStatus('available');
    setIsMuted(false);
    setIsOnHold(false);
    setThirdPartyConnected(false);
    setIsAddingThirdParty(false);
  };

  const handleSaveDisposition = async () => {
    if (!selectedDisposition) return;
    let followUpAt: string | undefined;
    if (followUpDate && followUpTime) {
      followUpAt = new Date(`${followUpDate}T${followUpTime}`).toISOString();
    } else if (followUpDate) {
      followUpAt = new Date(`${followUpDate}T09:00:00`).toISOString();
    }
    const callRecord: CallRecord = {
      id: 'record-' + Date.now(),
      notificationId: 'pop-' + Date.now(),
      prospect: activeCallData || {},
      timestamp: new Date().toISOString(),
      disposition: selectedDisposition,
      dispositionNotes: callNotes,
      callDuration: callTimer,
      callEndTime: new Date().toISOString(),
      callSource: 'CALL_CENTER',
      followUpAt,
    };
    setCallRecords(prev => [...prev, callRecord]);
    if (selectedDisposition === 'SET_APPOINTMENT') {
      setAppointmentsCount(prev => prev + 1);
    }
    if (selectedDisposition === 'SET_CALLBACK' || selectedDisposition === 'FOLLOW_UP') {
      setFollowUpCount(prev => prev + 1);
    }
    try {
      const response = await apiClient.post('/api/v1/calls/disposition', {
        callId: callSessionIdRef.current,
        disposition: selectedDisposition,
        notes: callNotes,
        duration: callTimer,
        callerNumber: activeCallData?.caller_id || activeCallData?.phone,
        direction: 'OUTBOUND',
        callSource: 'CALL_CENTER',
        followUpAt,
      });
      if (response.error) {
        console.error('[CallCenter] Disposition save failed:', response.error.message);
      }
    } catch (err) {
      console.error('[CallCenter] Disposition save error:', err);
    }
    setDispositionSaved(true);
    setTimeout(() => {
      setDispositionSaved(false);
      setShowDisposition(false);
      setSelectedDisposition('');
      setFollowUpDate('');
      setFollowUpTime('');
      setCallNotes('');
      setCallTimer(0);
      setActiveCallData(null);
      callSessionIdRef.current = null;
      dispositionHandledRef.current = false;
      setPreInjectedData(null);
      clearLead();
    }, 2000);
  };

  const startCallWithApplication = async (app: ApplicationData) => {
    setActiveCallData(app);
    setIsCallActive(true);
    setAgentStatus('on_call');
    setCallTimer(0);
    setTotalCallsCount(prev => prev + 1); // Count outbound application calls
    callTimerRef.current = setInterval(() => {
      setCallTimer(prev => prev + 1);
    }, 1000);

    const phoneNum = app.phone || app.caller_id;
    if (phoneNum) {
      try {
        await makeCall(phoneNum.replace(/\D/g, ''));
      } catch (error) {
        console.error('Failed to dial:', error);
      }
    }
  };

  // Fetch Applications
  const fetchApplications = useCallback(async () => {
    setLoadingApplications(true);
    try {
      const res = await fetch('/api/applications');
      if (res.ok) {
        const apps = await res.json();
        setApplications(apps);
      }
    } catch (err) {
      console.log('Could not fetch applications:', err);
      setApplications([]);
    } finally {
      setLoadingApplications(false);
    }
  }, []);

  useEffect(() => {
    if (currentView === 'agentDashboard') {
      void fetchApplications();
    }
  }, [currentView, fetchApplications]);

  // =========================================================================
  // ROLE SELECTION VIEW
  // =========================================================================
  if (currentView === 'roleSelect') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-5xl w-full">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg ">
              <Phone className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-slate-800 mb-2">Call Center Platform</h1>
            <p className="text-slate-500">Select your workspace to continue</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div
              onClick={() => setCurrentView('agentDashboard')}
              className="bg-white rounded-2xl shadow-sm overflow-hidden cursor-pointer group hover:shadow-sm hover: transition-all duration-300 border border-slate-100 hover:border-cyan-300"
            >
              <div className="bg-primary p-4">
                <div className="flex items-center justify-between">
                  <Headphones className="w-8 h-8 text-white" />
                  <span className="px-3 py-1 bg-white/20 text-white text-xs font-bold rounded-full ">
                    RECOMMENDED
                  </span>
                </div>
              </div>
              <div className="p-6">
                <h3 className="text-xl font-bold text-slate-800 mb-2 group-hover:text-cyan-600 transition-colors">
                  Agent Dialer
                </h3>
                <p className="text-slate-500 text-sm mb-4">
                  Full-featured softphone with 3-way calling, screen pop, call recording, and CRM
                  integration.
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2 py-1 bg-cyan-50 text-cyan-700 text-xs rounded-full">
                    3-Way Calling
                  </span>
                  <span className="px-2 py-1 bg-cyan-50 text-cyan-700 text-xs rounded-full">
                    Screen Pop
                  </span>
                  <span className="px-2 py-1 bg-cyan-50 text-cyan-700 text-xs rounded-full">
                    Quick Notes
                  </span>
                </div>
              </div>
            </div>

            <div
              onClick={() => setCurrentView('publisherSetup')}
              className="bg-white rounded-2xl shadow-sm overflow-hidden cursor-pointer group hover:shadow-sm hover: transition-all duration-300 border border-slate-100 hover:border-green-300"
            >
              <div className="bg-primary p-4">
                <LogIn className="w-8 h-8 text-white" />
              </div>
              <div className="p-6">
                <h3 className="text-xl font-bold text-slate-800 mb-2 group-hover:text-green-600 transition-colors">
                  Publisher Setup
                </h3>
                <p className="text-slate-500 text-sm mb-4">
                  Configure webhook endpoints, call routing rules, and data field mappings.
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2 py-1 bg-green-50 text-green-700 text-xs rounded-full">
                    Webhooks
                  </span>
                  <span className="px-2 py-1 bg-green-50 text-green-700 text-xs rounded-full">
                    Routing
                  </span>
                </div>
              </div>
            </div>

            <div
              onClick={() => setCurrentView('crmDashboard')}
              className="bg-white rounded-2xl shadow-sm overflow-hidden cursor-pointer group hover:shadow-sm hover: transition-all duration-300 border border-slate-100 hover:border-purple-300"
            >
              <div className="bg-accent p-4">
                <FileText className="w-8 h-8 text-white" />
              </div>
              <div className="p-6">
                <h3 className="text-xl font-bold text-slate-800 mb-2 group-hover:text-purple-600 transition-colors">
                  CRM Records
                </h3>
                <p className="text-slate-500 text-sm mb-4">
                  View call history, disposition outcomes, and customer profile management.
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2 py-1 bg-purple-50 text-purple-700 text-xs rounded-full">
                    Call Logs
                  </span>
                  <span className="px-2 py-1 bg-purple-50 text-purple-700 text-xs rounded-full">
                    Profiles
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="text-center">
            <button
              onClick={() => setCurrentView('agentDashboard')}
              className="px-8 py-3 bg-primary text-white font-bold rounded-xl shadow-lg hover:shadow-sm hover: transition-all"
            >
              Quick Start - Open Agent Dialer
            </button>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // AGENT DASHBOARD VIEW
  // =========================================================================
  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <CallCenterHeader
        agentStatus={agentStatus}
        setAgentStatus={setAgentStatus}
        isCallActive={isCallActive}
        isIncomingCall={isIncomingCall}
        isAdminOrOwner={isAdminOrOwner}
        rolesLoading={rolesLoading}
        derivedJobTitle={derivedJobTitle}
        canAccessRetentionScript={canAccessRetentionScript}
        selectedScript={selectedScript}
        setSelectedScript={setSelectedScript}
        callTimer={callTimer}
        formatTime={formatTime}
        setShowSettings={setShowSettings}
        onExit={() => router.push('/dashboard')}
      />

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl border border-border w-full max-w-md shadow-sm">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">User Settings</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1 hover:bg-muted rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-2">Your Role</label>
                <div className="w-full bg-muted text-white text-sm p-3 rounded-lg border border-border">
                  {rolesLoading ? (
                    <span className="text-muted-foreground">Loading...</span>
                  ) : (
                    <span className={isAdminOrOwner ? 'text-purple-400' : 'text-slate-300'}>
                      {derivedJobTitle}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Your role is assigned by your organization administrator.
                </p>
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-2">Script Access</label>
                <div className="p-3 bg-muted rounded-lg border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-white">📋 Contractor Sales Script</span>
                    <span
                      className={`text-xs ${selectedScript === 'sales' ? 'text-green-400' : 'text-muted-foreground'}`}
                    >
                      {selectedScript === 'sales' ? '✓ Selected' : 'Available'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white">🎯 Retention Script</span>
                    <span
                      className={`text-xs ${
                        !canAccessRetentionScript
                          ? 'text-muted-foreground'
                          : selectedScript === 'retention'
                            ? 'text-green-400'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {!canAccessRetentionScript
                        ? '✗ Restricted'
                        : selectedScript === 'retention'
                          ? '✓ Selected'
                          : 'Available'}
                    </span>
                  </div>
                </div>
                {canAccessRetentionScript ? (
                  <p className="text-xs text-muted-foreground mt-2">
                    Use the dropdown in the header to switch scripts during calls.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-2">
                    Retention Script requires ADMIN or OWNER role.
                  </p>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-border">
              <button
                onClick={() => setShowSettings(false)}
                className="w-full py-2 bg-primary text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content - 3 Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column - Dialer */}
        <div className="w-80 flex-shrink-0 border-r border-border flex flex-col bg-card">
          {isIncomingCall && incomingCallData && (
            <IncomingCallPanel
              incomingCallData={incomingCallData}
              ringDuration={ringDuration}
              handleAnswerCall={() => {
                void handleAnswerCall();
              }}
              handleDeclineCall={() => {
                void handleDeclineCall();
              }}
            />
          )}

          {isCallActive && activeCallData && !showDisposition && (
            <ActiveCallControls
              activeCallData={activeCallData}
              isMuted={isMuted}
              isOnHold={isOnHold}
              toggleMute={toggleMute}
              toggleHold={toggleHold}
              isAddingThirdParty={isAddingThirdParty}
              setIsAddingThirdParty={setIsAddingThirdParty}
              thirdPartyConnected={thirdPartyConnected}
              handleHangup={() => {
                void handleHangup();
              }}
              makeCall={makeCall}
              callNotes={callNotes}
              setCallNotes={setCallNotes}
            />
          )}

          {showDisposition && (
            <DispositionPanel
              dispositionSaved={dispositionSaved}
              selectedDisposition={selectedDisposition}
              setSelectedDisposition={setSelectedDisposition}
              callNotes={callNotes}
              setCallNotes={setCallNotes}
              followUpDate={followUpDate}
              setFollowUpDate={setFollowUpDate}
              followUpTime={followUpTime}
              setFollowUpTime={setFollowUpTime}
              handleSaveDisposition={() => {
                void handleSaveDisposition();
              }}
              onDispositionSelect={() => {}}
              handleSkipDisposition={() => {
                setShowDisposition(false);
                setSelectedDisposition('');
                setFollowUpDate('');
                setFollowUpTime('');
                setCallTimer(0);
                setActiveCallData(null);
                callSessionIdRef.current = null;
                dispositionHandledRef.current = false;
                setPreInjectedData(null);
                clearLead();
              }}
            />
          )}

          {!isIncomingCall && !isCallActive && !showDisposition && (
            <DialerPanel
              phoneNumber={phoneNumber}
              setPhoneNumber={setPhoneNumber}
              formatPhoneNumber={formatPhoneNumber}
              handleKeypadPress={handleKeypadPress}
              disabled={false}
              onDial={() => {
                void (async () => {
                  const dialNumber = phoneNumber.replace(/\D/g, '');
                  if (dialNumber.length === 10) {
                    const callData = {
                      caller_id: dialNumber,
                      first_name: 'Outbound',
                      last_name: 'Call',
                      phone: dialNumber,
                    };
                    setActiveCallData(callData);
                    setIsCallActive(true);
                    setAgentStatus('on_call');
                    setCallTimer(0);
                    setTotalCallsCount(prev => prev + 1);
                    callTimerRef.current = setInterval(() => setCallTimer(prev => prev + 1), 1000);
                    try {
                      await makeCall(dialNumber);
                    } catch (e) {
                      console.error(e);
                      setIsCallActive(false);
                      setAgentStatus('available');
                      if (callTimerRef.current) clearInterval(callTimerRef.current);
                    }
                  }
                })();
              }}
            />
          )}
        </div>

        {/* Center/Right Column - Script or Queue */}
        <div className="flex-1 p-4 overflow-hidden flex flex-col">
          {isCallActive && activeCallData ? (
            <div className="flex-1 flex flex-col overflow-hidden gap-2">
              <WorkspaceTabs
                activeCallView={activeCallView}
                setActiveCallView={setActiveCallView}
              />

              {activeCallView === 'script' && (
                <div className="flex-1 overflow-hidden">
                  {selectedScript === 'retention' && canAccessRetentionScript ? (
                    <RetentionScriptPanel
                      prospectData={activeCallData}
                      onDataUpdate={(data: Record<string, unknown>) =>
                        setActiveCallData(prev =>
                          prev ? ({ ...prev, ...data } as ProspectData) : null
                        )
                      }
                    />
                  ) : selectedScript === 'underwriting' ? (
                    <UnderwritingScriptPanel
                      prospectData={activeCallData}
                      onDataUpdate={(data: Record<string, unknown>) =>
                        setActiveCallData(prev =>
                          prev ? ({ ...prev, ...data } as ProspectData) : null
                        )
                      }
                    />
                  ) : (
                    <IntegratedScriptPanel
                      prospectData={activeCallData}
                      onDataUpdate={(data: Partial<ProspectData>) =>
                        setActiveCallData(prev =>
                          prev ? ({ ...prev, ...data } as ProspectData) : null
                        )
                      }
                    />
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-4 overflow-hidden">
              <StatsStrip
                totalCallsCount={totalCallsCount}
                appointmentsCount={appointmentsCount}
                appointmentRate={appointmentRate}
                followUpCount={followUpCount}
              />
              <ApplicationQueue
                applications={applications}
                loadingApplications={loadingApplications}
                fetchApplications={fetchApplications}
                startCallWithApplication={startCallWithApplication}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CallCenterPortal;
