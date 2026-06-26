'use client';

// ============================================================================
// CallCenterPortal.tsx - COMPLETE PORT FROM fe-rickie/CallPopApp.jsx
// Exact 1:1 port with zero UI/functionality differences
// ============================================================================

import {
  Phone,
  FileText,
  Headphones,
  LogIn,
  X,
  Play,
  Pause,
  Upload,
  RotateCcw,
  User,
  Database,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useState, useEffect, useRef, useCallback } from 'react';

import { SCRIPT_NODES } from '../../lib/call-center/scriptData';

import { ActiveCallControls } from './ActiveCallControls';
import { ApplicationQueue } from './ApplicationQueue';
import { CallCenterHeader } from './CallCenterHeader';
import { CapturedScriptDataPanel } from './CapturedScriptDataPanel';
import { CustomerCrmPanel } from './CustomerCrmPanel';
import { DispositionPanel } from './DispositionPanel';
import { IncomingCallPanel } from './IncomingCallPanel';
import IntegratedScriptPanel from './IntegratedScriptPanel';
import { PreClosedStatsCard } from './PreClosedStatsCard';
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
import { VerificationScriptPanel } from './VerificationScriptPanel';
import { ColdCallTransferScriptPanel } from './ColdCallTransferScriptPanel';
import { WorkspaceTabs } from './WorkspaceTabs';

import { CsvImportDialog } from '@/components/leads/csv-import-dialog';
import { usePhone, DialPad, AddCallDialog } from '@/components/phone';
import { useLeadInjection } from '@/hooks/useLeadInjection';
import { useScriptAccess } from '@/hooks/useUserRoles';
import { apiClient } from '@/lib/api';
import type { CustomerLookupResponse } from '@/lib/api/leads';
import { fetchCustomerLookup, updateInsuranceLead, deleteLeadList, deleteInsuranceLeads } from '@/lib/api/leads';

// ============================================================================
// DEFAULT SCRIPT CONTENT FOR EDITOR
// ============================================================================
const DEFAULT_RETENTION_SCRIPT = {
  retention_step1: `Hello {customerName}, this is [Your Name] from the retention team. I understand you're considering some changes to your policy...`,
  retention_step2: `Listen actively to the customer's concerns. Validate their feelings and show empathy.`,
  retention_step3: `Based on their concerns, present available retention offers, discounts, or plan adjustments.`,
  retention_step4: `Record the call outcome, any offers made, and next steps in the CRM.`,
};

const DEFAULT_UNDERWRITING_SCRIPT = {
  step1: `Please place a call to TransAmerica Underwriting & Policy Servicing.

• Phone Number: 1-877-234-4848
• Select Option 1 (Underwriting / Policy Servicing)

Once a representative answers, introduce yourself:
"Hello, I am the underwriting assistant for Yazzyl Vasquez and American Beneficiary LLC. I need to check the status of a policy."

If requested, verify Yazzyl's Agent Credentials:
• Agent Number: MLSR181715`,
  step2: `Confirm status of application/policy and update CRM notes.`,
  wrapup: `Wrap up call with TransAmerica representative, thank them for their time, and update status.`,
};

const EDITABLE_NODES = {
  sales: [
    { id: 'greeting_start', label: '👋 Trust Anchor / Greeting' },
    { id: 'verify_state', label: '📍 State Verification' },
    { id: 'verify_age', label: '🔞 Age Verification' },
    { id: 'emotional_anchor', label: '⚓ Emotional Excavation' },
    { id: 'health_q_intro', label: '📋 Eligibility Pivot / Health Questions' },
    { id: 'pricing_options', label: '💰 Option Selection' },
    { id: 'application_opener', label: '✍️ Commitment Seal / Application Opener' },
    { id: 'ssn_collection', label: '🔒 Identity Lock / SSN Collection' },
    { id: 'payment_disarm', label: '💳 Financial Disarm / Banking' },
    { id: 'victory_lap', label: '🏆 Victory Lap / Welcome' },
  ],
  retention: [
    { id: 'retention_step1', label: '👋 Greet the Customer' },
    { id: 'retention_step2', label: '🤝 Acknowledge Concerns' },
    { id: 'retention_step3', label: '🎁 Present Retention Offers' },
    { id: 'retention_step4', label: '📝 Document Outcome' },
  ],
  underwriting: [
    { id: 'step1', label: '📞 Call Underwriting / Agent Credentials' },
    { id: 'step2', label: '🔎 Retrieve Policy Status' },
    { id: 'wrapup', label: '🏁 Wrap-up & Status Update' },
  ],
};

const getDefaultScriptText = (
  scriptType: 'sales' | 'retention' | 'underwriting',
  nodeId: string
): string => {
  if (scriptType === 'sales') {
    return SCRIPT_NODES[nodeId]?.script || '';
  } else if (scriptType === 'retention') {
    return DEFAULT_RETENTION_SCRIPT[nodeId as keyof typeof DEFAULT_RETENTION_SCRIPT] || '';
  } else if (scriptType === 'underwriting') {
    return DEFAULT_UNDERWRITING_SCRIPT[nodeId as keyof typeof DEFAULT_UNDERWRITING_SCRIPT] || '';
  }
  return '';
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export function CallCenterPortal(): JSX.Element {
  const router = useRouter();
  const {
    currentCall,
    makeCall,
    hangupCall,
    answerCall,
    toggleMute,
    toggleHold,
    hasHeldCalls,
    mergeCalls,
  } = usePhone();

  // Lead Injection - Pre-call data from webhooks
  const { leadData, lookupLead, clearLead } = useLeadInjection();
  const [preInjectedData, setPreInjectedData] = useState<ProspectData | null>(null);

  // Auto-Dialer & Lead Upload State
  const [isAutoDialing, setIsAutoDialing] = useState(false);
  const [autoDialIndex, setAutoDialIndex] = useState(0);
  const [autoDialStatus, setAutoDialStatus] = useState<
    'idle' | 'calling' | 'disposition' | 'wrapup' | 'paused'
  >('idle');
  const [wrapUpCountdown, setWrapUpCountdown] = useState(5);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const wrapUpTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  // CRM Customer Panel State
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  const [crmData, setCrmData] = useState<CustomerLookupResponse | null>(null);
  const [loadingCrm, setLoadingCrm] = useState(false);
  const [crmPhone, setCrmPhone] = useState('');

  const fetchCrmData = useCallback(async (phoneToLookup: string) => {
    const cleanPhone = phoneToLookup.replace(/\D/g, '');
    if (!cleanPhone) return;
    setLoadingCrm(true);
    setCrmPhone(cleanPhone);
    try {
      const data = await fetchCustomerLookup(cleanPhone);
      setCrmData(data);
      if (data.customer) {
        setActiveCallView('data'); // auto switch to target profile tab
      }
    } catch (err) {
      console.error('[CallCenter] CRM Lookup failed:', err);
    } finally {
      setLoadingCrm(false);
    }
  }, []);

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

  // Refs to avoid stale closures in setTimeout/useEffect
  const callTimerValRef = useRef(0);
  const activeCallDataRef = useRef<ProspectData | null>(null);
  const handleSaveDispositionRef = useRef<any>(null);
  const wasAnsweredRef = useRef<boolean>(false);
  const hasHadActiveSessionRef = useRef<boolean>(false);

  useEffect(() => {
    callTimerValRef.current = callTimer;
  }, [callTimer]);

  useEffect(() => {
    activeCallDataRef.current = activeCallData;
  }, [activeCallData]);



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
  const [appointmentsCount, setAppointmentsCount] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('cc_appointments_count');
      return v ? parseInt(v, 10) : 0;
    }
    return 0;
  });
  const [totalCallsCount, setTotalCallsCount] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('cc_total_calls_count');
      return v ? parseInt(v, 10) : 0;
    }
    return 0;
  });
  const [followUpCount, setFollowUpCount] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('cc_follow_up_count');
      return v ? parseInt(v, 10) : 0;
    }
    return 0;
  });
  const [salesCount, setSalesCount] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('cc_sales_count');
      return v ? parseInt(v, 10) : 0;
    }
    return 0;
  });

  const [selectedScript, setSelectedScript] = useState<SelectedScript>('sales');
  const [leadLists, setLeadLists] = useState<any[]>([]);
  const [selectedListId, setSelectedListId] = useState<string>('');

  // Database-driven role and script access
  const {
    canAccessRetentionScript,
    derivedJobTitle,
    loading: rolesLoading,
    isAdminOrOwner,
    defaultScript,
    position,
    customScripts,
    refetch: refetchUser,
  } = useScriptAccess();

  // Settings Tab and Editor State
  const [settingsTab, setSettingsTab] = useState<'general' | 'scripts'>('general');
  const [editingScriptType, setEditingScriptType] = useState<
    'sales' | 'retention' | 'underwriting'
  >('sales');
  const [editingNodeId, setEditingNodeId] = useState('greeting_start');
  const [editedText, setEditedText] = useState('');
  const [savingScript, setSavingScript] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Initialize selectedScript when defaults are loaded
  useEffect(() => {
    if (!rolesLoading && defaultScript) {
      setSelectedScript(defaultScript as SelectedScript);
    }
  }, [rolesLoading, defaultScript]);

  // Load script node text when user edits
  useEffect(() => {
    if (customScripts && customScripts[editingNodeId] !== undefined) {
      setEditedText(customScripts[editingNodeId]);
    } else {
      setEditedText(getDefaultScriptText(editingScriptType, editingNodeId));
    }
  }, [editingNodeId, editingScriptType, customScripts]);

  const handleScriptTypeChange = (type: 'sales' | 'retention' | 'underwriting') => {
    setEditingScriptType(type);
    setEditingNodeId(EDITABLE_NODES[type][0].id);
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('cc_appointments_count', String(appointmentsCount));
      localStorage.setItem('cc_total_calls_count', String(totalCallsCount));
      localStorage.setItem('cc_follow_up_count', String(followUpCount));
      localStorage.setItem('cc_sales_count', String(salesCount));
    }
  }, [appointmentsCount, totalCallsCount, followUpCount, salesCount]);

  // Calculate appointment rate: (Appointments / Total Calls) * 100
  const appointmentRate =
    totalCallsCount > 0 ? ((appointmentsCount / totalCallsCount) * 100).toFixed(1) : '0.0';

  // Calculate conversion rate: (Sales / Total Calls) * 100
  const conversionRate =
    totalCallsCount > 0 ? ((salesCount / totalCallsCount) * 100).toFixed(1) : '0.0';

  // ─────────────────────────────────────────────────────────────────────────
  // SYNC WITH PHONE HOOK - React to incoming/active calls from sip.js
  // Fixed: Disposition modal now only triggers on genuine CALL_ENDED event
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (currentCall) {
      const cleanPhone = currentCall.phoneNumber ? currentCall.phoneNumber.replace(/\D/g, '') : '';
      if (cleanPhone && crmPhone !== cleanPhone) {
        void fetchCrmData(cleanPhone);
      }
    }

    // Case 1: No active call from the SIP hook
    if (!currentCall) {
      // Only trigger disposition if we HAD an active call, had a live session, and haven't already handled it
      if (isCallActive && !dispositionHandledRef.current && callSessionIdRef.current && hasHadActiveSessionRef.current) {
        console.log('[CallCenter] Call ended - checking for auto-disposition');
        if (callTimerRef.current) clearInterval(callTimerRef.current);
        dispositionHandledRef.current = true;
        setIsCallActive(false);
        hasHadActiveSessionRef.current = false;

        // Auto-disposition checks:
        // Only auto-disposition if the call was NEVER answered/connected (e.g. no answer or disconnected number)
        if (!wasAnsweredRef.current) {
          const callStartTime = callSessionIdRef.current ? parseInt(callSessionIdRef.current.split('-')[1]) : 0;
          const elapsedSeconds = callStartTime ? Math.floor((Date.now() - callStartTime) / 1000) : 0;

          if (elapsedSeconds < 5) {
            console.log('[CallCenter] Auto-dispositioning: Disconnected (elapsed < 5s)');
            if (handleSaveDispositionRef.current) {
              void handleSaveDispositionRef.current('DISCONNECTED', 'Auto-dispositioned: Number Disconnected / Immediately Terminated');
            }
          } else {
            console.log('[CallCenter] Auto-dispositioning: No Answer');
            if (handleSaveDispositionRef.current) {
              void handleSaveDispositionRef.current('NO_ANSWER', 'Auto-dispositioned: No Answer / Ringing Timeout');
            }
          }
        } else {
          console.log('[CallCenter] Triggering manual disposition modal');
          setShowDisposition(true);
          setAgentStatus('available');
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
      hasHadActiveSessionRef.current = false; // Reset for incoming call
    }

    // Case 3: Call is active (connected)
    if (currentCall.state === 'active' || currentCall.state === 'connecting') {
      // New call session - reset disposition tracking
      if (!callSessionIdRef.current || callSessionIdRef.current !== currentCall.callId) {
        callSessionIdRef.current = currentCall.callId || `call-${Date.now()}`;
        dispositionHandledRef.current = false;
        wasAnsweredRef.current = false;
        hasHadActiveSessionRef.current = false; // Reset for new session
        setTotalCallsCount(prev => prev + 1);
        console.log('[CallCenter] New call session started:', callSessionIdRef.current);
      }

      hasHadActiveSessionRef.current = true; // Mark as having a live session

      if (currentCall.state === 'active') {
        wasAnsweredRef.current = true;
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
  }, [currentCall, isCallActive, activeCallData, fetchCrmData, crmPhone]);

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
          ringtoneRef.current
            .play()
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
    // Set first script based on defaultScript preference
    const initialScript = defaultScript || (position === 'Retention' ? 'retention' : 'sales');
    setSelectedScript(initialScript as SelectedScript);

    // State updates happen via useEffect watching currentCall
    setIsIncomingCall(false);
    setIsCallActive(true);
    setActiveCallData(incomingCallData);
    setActiveCallView(crmData?.customer ? 'data' : 'script'); // Switch dynamically if CRM record found
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
  };

  const handleSaveDisposition = async (autoDisp?: string, autoNotes?: string) => {
    const disp = autoDisp || selectedDisposition;
    if (!disp) return;

    let followUpAt: string | undefined;
    if (!autoDisp) {
      if (followUpDate && followUpTime) {
        followUpAt = new Date(`${followUpDate}T${followUpTime}`).toISOString();
      } else if (followUpDate) {
        followUpAt = new Date(`${followUpDate}T09:00:00`).toISOString();
      }
    }

    const notes = autoNotes || callNotes;

    const callRecord: CallRecord = {
      id: 'record-' + Date.now(),
      notificationId: 'pop-' + Date.now(),
      prospect: activeCallData || {},
      timestamp: new Date().toISOString(),
      disposition: disp,
      dispositionNotes: notes,
      callDuration: callTimer,
      callEndTime: new Date().toISOString(),
      callSource: 'CALL_CENTER',
      followUpAt,
    };
    setCallRecords(prev => [...prev, callRecord]);
    if (disp === 'APPLICATION_SUBMITTED') {
      setSalesCount(prev => prev + 1);
    } else {
      setFollowUpCount(prev => prev + 1);
      if (disp === 'SET_APPOINTMENT') {
        setAppointmentsCount(prev => prev + 1);
      }
    }

    // Start/update customer profile in CRM
    if (activeCallData) {
      const rawPhone =
        (activeCallData.phone || activeCallData.caller_id || crmPhone || '').replace(/\D/g, '') ||
        '0000000000';
      const finalPhone = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone.padStart(10, '0');

      const crmPayload = {
        firstName: activeCallData.firstName || activeCallData.first_name || 'Prospect',
        lastName: activeCallData.lastName || activeCallData.last_name || 'Record',
        phone: finalPhone,
        email:
          activeCallData.email ||
          `${(activeCallData.firstName || 'prospect').toLowerCase()}@placeholder.com`,
        address: activeCallData.address || '123 Main St',
        city: activeCallData.city || 'Anytown',
        state: activeCallData.state || 'TX',
        zipCode: activeCallData.zip || activeCallData.zipCode || '12345',
        birthDate: activeCallData.dob || '01/01/1980',
        gender: activeCallData.gender || 'Female',
        age: activeCallData.age ? Number(activeCallData.age) : undefined,
        smoker: activeCallData.tobacco ? 'Yes' : 'No',
        carrier: activeCallData.selectedCarrier || undefined,
        monthlyPremium: activeCallData.selectedPremium
          ? String(activeCallData.selectedPremium)
          : undefined,
        coverageAmount: activeCallData.selectedCoverage
          ? String(activeCallData.selectedCoverage)
          : undefined,
        source: 'CALL_CENTER',
        customFields: {
          middleName: activeCallData.middleName || '',
          ssn: activeCallData.ssn || '',
          birthState: activeCallData.birthState || '',
          citizenship: activeCallData.citizenship || '',
          beneficiaryName: activeCallData.beneficiaryName || '',
          beneficiaryRelation: activeCallData.beneficiaryRelation || '',
          ssPaymentDay: activeCallData.ssPaymentDay || '',
          accountHolder: activeCallData.accountHolder || '',
          bankName: activeCallData.bankName || '',
          bankCityState: activeCallData.bankCityState || '',
          ssPaymentSchedule: activeCallData.ssPaymentSchedule || null,
          draftDay: activeCallData.draftDay || '',
          routingNumber: activeCallData.routingNumber || '',
          accountNumber: activeCallData.accountNumber || '',
          accountType: activeCallData.accountType || '',
          doctorName: activeCallData.doctorName || '',
          doctorAddress: activeCallData.doctorAddress || '',
          doctorPhone: activeCallData.doctorPhone || '',
          hospitalizationReason: activeCallData.hospitalizationReason || '',
          callbackDate: activeCallData.callbackDate || '',
          callbackTime: activeCallData.callbackTime || '',
          ownerIsInsured: activeCallData.ownerIsInsured ?? true,
          payorIsInsured: activeCallData.payorIsInsured ?? true,
          hasExistingInsurance: activeCallData.hasExistingInsurance ?? null,
          existingCompanyName: activeCallData.existingCompanyName || '',
          existingPolicyNumber: activeCallData.existingPolicyNumber || '',
          existingCoverageAmount: activeCallData.existingCoverageAmount || '',
          // Health questions
          healthQ1: activeCallData.healthQ1,
          healthQ2: activeCallData.healthQ2,
          healthQ3: activeCallData.healthQ3,
          healthQ4: activeCallData.healthQ4,
          healthQ5: activeCallData.healthQ5,
          healthQ6: activeCallData.healthQ6,
          healthQ7a: activeCallData.healthQ7a,
          healthQ7b: activeCallData.healthQ7b,
          healthQ7c: activeCallData.healthQ7c,
          healthQ7d: activeCallData.healthQ7d,
          healthQ8a: activeCallData.healthQ8a,
          healthQ8b: activeCallData.healthQ8b,
          healthQ8c: activeCallData.healthQ8c,
          healthCovid: activeCallData.healthCovid,
          // Script transfer fields
          ageRange: activeCallData.ageRange || '',
          hasFinalExpenseCoverage: activeCallData.hasFinalExpenseCoverage || '',
          coverageType: activeCallData.coverageType || '',
          responsiblePerson: activeCallData.responsiblePerson || '',
          financialBurden: activeCallData.financialBurden || '',
          correctState: activeCallData.correctState || '',
          tobaccoStatus: activeCallData.tobaccoStatus || '',
          tobaccoType: activeCallData.tobaccoType || '',
          majorHealthHistory: activeCallData.majorHealthHistory || '',
          majorHealthDetails: activeCallData.majorHealthDetails || '',
          hasBankAccount: activeCallData.hasBankAccount || '',
        },
      };

      try {
        const res = await apiClient.post<{ insuranceLeadId?: string }>(
          '/api/v1/insurance-leads/inbound/FE',
          crmPayload
        );
        if (res.data?.insuranceLeadId) {
          const leadId = res.data.insuranceLeadId;
          const status =
            (disp === 'APPLICATION_SUBMITTED' || disp === 'LIVE_TRANSFER')
              ? 'CONVERTED'
              : (disp === 'NO_ANSWER' ? 'NEW' : (['DISCONNECTED', 'NOT_INTERESTED', 'NOT_QUALIFIED'].includes(disp) ? 'LOST' : 'CONTACTED'));
          await apiClient.patch(`/api/v1/insurance-leads/${leadId}`, {
            status,
            lastContactedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('[CallCenter] CRM ingestion failed:', err);
      }
    }

    try {
      const response = await apiClient.post('/api/v1/calls/disposition', {
        callId: callSessionIdRef.current,
        disposition: disp,
        notes,
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

    // Save updated CRM data if lead exists
    const resolvedLeadId = activeCallData?.id || crmData?.customer?.id;
    if (resolvedLeadId && activeCallData) {
      try {
        // Collect custom fields (any fields not in standard CRM fields list)
        const standardKeys = [
          'id',
          'tenantId',
          'vertical',
          'firstName',
          'first_name',
          'lastName',
          'last_name',
          'fullName',
          'name',
          'email',
          'phone',
          'caller_id',
          'address',
          'address2',
          'city',
          'county',
          'state',
          'zipCode',
          'zip',
          'birthDate',
          'age',
          'gender',
          'source',
          'status',
          'customFields',
          'notes',
          'tags',
          'assignedToId',
          'assignedAt',
          'lastContactedAt',
          'nextFollowUpAt',
          'priority',
          'leadStage',
          'doNotCall',
          'duplicateOfId',
          'smoker',
          'faceAmount',
          'lifeType',
          'riskType',
          'carrier',
          'product',
          'monthlyPremium',
          'coverageAmount',
          'trustedFormUrl',
          'leadidToken',
          'consentLanguage',
          'recordingUrl',
          'createdAt',
          'updatedAt',
          'submissions',
          'activities',
          'tasks',
        ];

        const customFields: Record<string, unknown> = {};
        if (activeCallData.customFields && typeof activeCallData.customFields === 'object') {
          Object.assign(customFields, activeCallData.customFields);
        }

        // Extract any keys directly on activeCallData that are not standard keys
        Object.keys(activeCallData).forEach(key => {
          if (!standardKeys.includes(key) && activeCallData[key] !== undefined) {
            customFields[key] = activeCallData[key];
          }
        });

        const status =
          (disp === 'APPLICATION_SUBMITTED' || disp === 'LIVE_TRANSFER')
            ? 'CONVERTED'
            : (disp === 'NO_ANSWER' ? 'NEW' : (['DISCONNECTED', 'NOT_INTERESTED', 'NOT_QUALIFIED'].includes(disp) ? 'LOST' : 'CONTACTED'));

        await updateInsuranceLead(resolvedLeadId, {
          firstName: activeCallData.firstName || activeCallData.first_name,
          lastName: activeCallData.lastName || activeCallData.last_name,
          email: activeCallData.email,
          phone: activeCallData.phone || activeCallData.caller_id,
          address: activeCallData.address,
          city: activeCallData.city,
          state: activeCallData.state,
          zipCode: activeCallData.zipCode || activeCallData.zip,
          age: activeCallData.age,
          gender: activeCallData.gender,
          smoker: activeCallData.smoker,
          faceAmount: activeCallData.faceAmount,
          monthlyPremium: activeCallData.monthlyPremium,
          carrier: activeCallData.carrier,
          customFields: customFields,
          status,
          lastContactedAt: new Date().toISOString(),
        });
        console.log('[CallCenter] CRM record updated successfully');
      } catch (err) {
        console.error('[CallCenter] Failed to save CRM updates:', err);
      }
    }

    const resetStates = () => {
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
      setCrmData(null);
      setCrmPhone('');

      if (isAutoDialing && autoDialIndex + 1 < applications.length) {
        setAutoDialStatus('wrapup');
        setWrapUpCountdown(5);
      } else {
        setIsAutoDialing(false);
        setAutoDialStatus('idle');
      }
    };

    if (autoDisp) {
      resetStates();
    } else {
      setDispositionSaved(true);
      setTimeout(() => {
        setDispositionSaved(false);
        resetStates();
      }, 2000);
    }
  };

  useEffect(() => {
    handleSaveDispositionRef.current = handleSaveDisposition;
  }, [handleSaveDisposition]);

  const startCallWithApplication = async (app: ApplicationData) => {
    const idx = applications.findIndex(a => a.id === app.id);
    if (idx !== -1) {
      setAutoDialIndex(idx);
    }
    setActiveCallData(app);
    setIsCallActive(true);
    setAgentStatus('on_call');
    setCallTimer(0);
    dispositionHandledRef.current = false;
    wasAnsweredRef.current = false;
    hasHadActiveSessionRef.current = false;
    callSessionIdRef.current = `call-${Date.now()}`;
    setTotalCallsCount(prev => prev + 1); // Count outbound application calls
    callTimerRef.current = setInterval(() => {
      setCallTimer(prev => prev + 1);
    }, 1000);

    const phoneNum = app.phone || app.caller_id;
    if (phoneNum) {
      const cleanPhone = phoneNum.replace(/\D/g, '');
      void fetchCrmData(cleanPhone);
      try {
        await makeCall(cleanPhone, 'ROTATE');
      } catch (error) {
        console.error('Failed to dial:', error);
      }
    }
  };

  // Fetch Applications & Lists
  const fetchApplications = useCallback(async () => {
    setLoadingApplications(true);
    try {
      // 1. Fetch Lead Lists in parallel to keep dropdown updated
      const listsRes = await apiClient.get<any[]>('/api/v1/lead-lists');
      if (!listsRes.error && listsRes.data) {
        setLeadLists(listsRes.data);
      }

      // 2. Fetch leads in queue (filtered by list if selected, showing only NEW status leads)
      const url = selectedListId
        ? `/api/v1/insurance-leads?limit=100&listId=${selectedListId}&status=NEW`
        : '/api/v1/insurance-leads?limit=100&status=NEW';

      const res = await apiClient.get<any>(url);
      if (!res.error && res.data) {
        const result = res.data;
        const apps = (result.data || []).map((lead: any) => ({
          ...lead,
          firstName: lead.firstName || '',
          lastName: lead.lastName || '',
          name:
            lead.fullName ||
            `${lead.firstName || ''} ${lead.lastName || ''}`.trim() ||
            'Unnamed Lead',
        }));
        setApplications(apps);
      }
    } catch (err) {
      console.log('Could not fetch applications:', err);
      setApplications([]);
    } finally {
      setLoadingApplications(false);
    }
  }, [selectedListId]);

  const handleDeleteList = async () => {
    if (!selectedListId) return;
    const selectedList = leadLists.find(l => l.id === selectedListId);
    if (!selectedList) return;

    const confirmMsg = `Are you sure you want to delete the lead list "${selectedList.name}" and all leads in it? This action cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await deleteLeadList(selectedListId);
      setSelectedListId('');
      setIsAutoDialing(false);
      setAutoDialIndex(0);
      setAutoDialStatus('idle');
      void fetchApplications();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete lead list');
    }
  };

  const handleDeleteLead = async (id: string) => {
    const confirmMsg = `Are you sure you want to delete this lead? This action cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await deleteInsuranceLeads([id]);
      void fetchApplications();
      if (autoDialIndex >= applications.length - 1) {
        setAutoDialIndex(Math.max(0, applications.length - 2));
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete lead');
    }
  };

  useEffect(() => {
    if (currentView === 'agentDashboard') {
      void fetchApplications();
    }
  }, [currentView, fetchApplications]);

  // Auto-Dialer Countdown Effect
  useEffect(() => {
    if (isAutoDialing && autoDialStatus === 'wrapup') {
      if (wrapUpCountdown > 0) {
        wrapUpTimerRef.current = setTimeout(() => {
          setWrapUpCountdown(prev => prev - 1);
        }, 1000);
      } else {
        // Countdown hit 0! Start next call
        const nextIndex = autoDialIndex + 1;
        if (nextIndex < applications.length) {
          setAutoDialIndex(nextIndex);
          setAutoDialStatus('calling');
          const nextApp = applications[nextIndex];
          if (nextApp) {
            void startCallWithApplication(nextApp);
          }
        } else {
          // End of queue
          setIsAutoDialing(false);
          setAutoDialStatus('idle');
          setAutoDialIndex(0);
          alert('Auto-dialer complete. All leads in the queue have been dialed.');
        }
      }
    }
    return () => {
      if (wrapUpTimerRef.current) {
        clearTimeout(wrapUpTimerRef.current);
        wrapUpTimerRef.current = null;
      }
    };
  }, [
    isAutoDialing,
    autoDialStatus,
    wrapUpCountdown,
    autoDialIndex,
    applications,
    startCallWithApplication,
  ]);

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

  // Check if we are dealing with a PreClosed list lead
  const selectedList = leadLists.find(l => l.id === selectedListId);
  const isPreClosedListSelected = selectedList?.name?.toLowerCase() === 'preclosed';

  const activeLeadListName = crmData?.customer?.list?.name || activeCallData?.list?.name || '';
  const isPreClosedLead = activeLeadListName.toLowerCase() === 'preclosed';

  const isPreClosed = isPreClosedListSelected || isPreClosedLead;

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
          <div
            className={`bg-card rounded-xl border border-border w-full ${settingsTab === 'scripts' ? 'max-w-2xl' : 'max-w-md'} shadow-sm transition-all duration-200`}
          >
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex gap-4">
                <button
                  onClick={() => setSettingsTab('general')}
                  className={`text-sm font-bold pb-2 border-b-2 ${settingsTab === 'general' ? 'border-primary text-white' : 'border-transparent text-muted-foreground'}`}
                >
                  General Settings
                </button>
                <button
                  onClick={() => setSettingsTab('scripts')}
                  className={`text-sm font-bold pb-2 border-b-2 ${settingsTab === 'scripts' ? 'border-primary text-white' : 'border-transparent text-muted-foreground'}`}
                >
                  Script Customizer
                </button>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1 hover:bg-muted rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            {settingsTab === 'general' ? (
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">
                    Your Position / Role
                  </label>
                  <div className="w-full bg-muted text-white text-sm p-3 rounded-lg border border-border">
                    {rolesLoading ? (
                      <span className="text-muted-foreground">Loading...</span>
                    ) : (
                      <span className="text-slate-300 font-medium">{derivedJobTitle}</span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-muted-foreground mb-2">
                    Default Script Preference
                  </label>
                  <select
                    value={defaultScript || (position === 'Retention' ? 'retention' : 'sales')}
                    onChange={e => {
                      const val = e.target.value;
                      void (async () => {
                        try {
                          await apiClient.patch('/api/auth/me/settings', {
                            defaultScript: val,
                          });
                          await refetchUser();
                        } catch (err) {
                          console.error('Failed to save default script:', err);
                        }
                      })();
                    }}
                    className="flex h-10 w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="sales">Contractor Script</option>
                    <option value="retention">Retention Script</option>
                    <option value="underwriting">Underwriting Script</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-2">
                    This script will automatically display first when you answer incoming calls.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1.5 uppercase font-semibold">
                      Select Script
                    </label>
                    <select
                      value={editingScriptType}
                      onChange={e => handleScriptTypeChange(e.target.value as any)}
                      className="flex h-9 w-full rounded-md border border-input bg-muted px-3 py-1.5 text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <option value="sales">Contractor Script</option>
                      <option value="retention">Retention Script</option>
                      <option value="underwriting">Underwriting Script</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1.5 uppercase font-semibold">
                      Select Step / Node
                    </label>
                    <select
                      value={editingNodeId}
                      onChange={e => setEditingNodeId(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-muted px-3 py-1.5 text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {EDITABLE_NODES[editingScriptType].map(nodeOpt => (
                        <option key={nodeOpt.id} value={nodeOpt.id}>
                          {nodeOpt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-xs text-muted-foreground uppercase font-semibold">
                      Script Text Template
                    </label>
                    {customScripts && customScripts[editingNodeId] !== undefined && (
                      <span className="text-[10px] bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded font-mono font-medium">
                        Customized
                      </span>
                    )}
                  </div>
                  <textarea
                    value={editedText}
                    onChange={e => {
                      setEditedText(e.target.value);
                      setSaveSuccess(false);
                    }}
                    rows={8}
                    className="flex w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 font-sans leading-relaxed"
                    placeholder="Enter script text template..."
                  />
                  <p className="text-[10px] text-muted-foreground mt-1.5 leading-normal">
                    You can use variables like{' '}
                    <code className="bg-zinc-800 px-1 py-0.5 rounded text-cyan-300 font-mono">
                      {'{first_name}'}
                    </code>
                    ,{' '}
                    <code className="bg-zinc-800 px-1 py-0.5 rounded text-cyan-300 font-mono">
                      {'{last_name}'}
                    </code>
                    ,{' '}
                    <code className="bg-zinc-800 px-1 py-0.5 rounded text-cyan-300 font-mono">
                      {'{state}'}
                    </code>
                    , and{' '}
                    <code className="bg-zinc-800 px-1 py-0.5 rounded text-cyan-300 font-mono">
                      {'{agent_name}'}
                    </code>{' '}
                    in the template.
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => {
                      void (async () => {
                        try {
                          const defaultTxt = getDefaultScriptText(editingScriptType, editingNodeId);
                          setEditedText(defaultTxt);
                          setSavingScript(true);
                          await apiClient.patch('/api/auth/me/settings', {
                            customScripts: { [editingNodeId]: defaultTxt },
                          });
                          await refetchUser();
                          setSaveSuccess(true);
                        } catch (err) {
                          console.error('Failed to reset script:', err);
                        } finally {
                          setSavingScript(false);
                        }
                      })();
                    }}
                    disabled={savingScript}
                    className="text-xs text-amber-500 hover:text-amber-400 font-medium transition-colors disabled:opacity-50"
                  >
                    Reset to Default
                  </button>
                  <div className="flex items-center gap-3">
                    {saveSuccess && (
                      <span className="text-xs text-green-400 font-medium">
                        ✓ Saved successfully
                      </span>
                    )}
                    <button
                      onClick={() => {
                        void (async () => {
                          setSavingScript(true);
                          setSaveSuccess(false);
                          try {
                            await apiClient.patch('/api/auth/me/settings', {
                              customScripts: { [editingNodeId]: editedText },
                            });
                            await refetchUser();
                            setSaveSuccess(true);
                          } catch (err) {
                            console.error('Failed to save script step:', err);
                          } finally {
                            setSavingScript(false);
                          }
                        })();
                      }}
                      disabled={savingScript}
                      className="px-4 py-2 bg-primary text-white font-medium text-xs rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {savingScript ? 'Saving...' : 'Save Script Step'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="p-4 border-t border-border">
              <button
                onClick={() => setShowSettings(false)}
                className="w-full py-2 bg-muted text-white font-medium rounded-lg hover:bg-muted/80 transition-colors"
              >
                Close Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content - 3 Column Layout */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Column - Dialer */}
        <div className="w-full md:w-80 flex-shrink-0 md:border-r border-b md:border-b-0 border-border flex flex-col bg-card">
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
              hasHeldCalls={hasHeldCalls}
              mergeCalls={mergeCalls}
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
              handleSkipDisposition={async () => {
                const leadId = activeCallData?.id || crmData?.customer?.id;
                if (leadId) {
                  try {
                    await apiClient.patch(`/api/v1/insurance-leads/${leadId}`, {
                      lastContactedAt: new Date().toISOString(),
                    });
                  } catch (e) {
                    console.error('Failed to update lastContactedAt on skip:', e);
                  }
                }
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
                setCrmData(null);
                setCrmPhone('');

                if (isAutoDialing && autoDialIndex + 1 < applications.length) {
                  setAutoDialStatus('wrapup');
                  setWrapUpCountdown(5);
                } else {
                  setIsAutoDialing(false);
                  setAutoDialStatus('idle');
                }
              }}
            />
          )}

          {!isIncomingCall &&
            !isCallActive &&
            !showDisposition &&
            (isAutoDialing && autoDialStatus === 'wrapup' ? (
              <div className="flex-1 p-6 bg-slate-900 border border-slate-800 rounded-xl flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-mono uppercase tracking-widest text-slate-400 mb-2">
                    Auto-Dialer Queue
                  </h3>
                  <div className="text-xs text-slate-500 mb-4">
                    Lead {autoDialIndex + 1} of {applications.length}
                  </div>

                  <div className="flex flex-col items-center justify-center py-8">
                    <div className="relative flex items-center justify-center">
                      <div className="w-24 h-24 rounded-full border-4 border-cyan-500/20 border-t-cyan-500 animate-spin absolute" />
                      <div className="text-3xl font-bold text-white">{wrapUpCountdown}s</div>
                    </div>
                    <p className="text-xs text-slate-400 mt-6 text-center font-medium">
                      Wrap-up period active. Preparing to dial the next lead...
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <button
                    onClick={() => setWrapUpCountdown(0)}
                    className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono font-bold uppercase tracking-widest rounded-lg transition-colors flex items-center justify-center gap-2 text-xs"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Dial Next Now
                  </button>
                  <button
                    onClick={() => {
                      setIsAutoDialing(false);
                      setAutoDialStatus('paused');
                    }}
                    className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-red-400 font-mono font-bold uppercase tracking-widest rounded-lg border border-red-500/20 transition-colors text-xs"
                  >
                    Pause Dialer
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-grow flex flex-col p-4 bg-background justify-between">
                <div className="space-y-4 flex-grow flex flex-col">
                  <div className="flex items-center justify-between pb-2 border-b border-border">
                    <h3 className="text-xs font-mono uppercase tracking-widest font-bold text-foreground">
                      Agent Dialer
                    </h3>
                  </div>
                  <div className="flex-grow flex flex-col justify-center">
                    <DialPad compact={true} />
                  </div>
                </div>
              </div>
            ))}

          {isAddingThirdParty && <AddCallDialog onClose={() => setIsAddingThirdParty(false)} />}
        </div>

        {/* Center/Right Column - Script or Queue */}
        <div className="flex-1 p-4 overflow-hidden flex flex-col">
          {(isCallActive && activeCallData) || crmData ? (
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden gap-4">
              <div className="flex-1 flex flex-col overflow-hidden gap-2">
                <WorkspaceTabs
                  activeCallView={activeCallView}
                  setActiveCallView={setActiveCallView}
                />

                {activeCallView === 'script' && (
                  <div className="flex-1 overflow-hidden">
                    {activeCallData ? (
                      selectedScript === 'retention' && canAccessRetentionScript ? (
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
                      ) : selectedScript === 'verification' ? (
                        <VerificationScriptPanel
                          prospectData={activeCallData}
                          onDataUpdate={(data: Record<string, unknown>) =>
                            setActiveCallData(prev =>
                              prev ? ({ ...prev, ...data } as ProspectData) : null
                            )
                          }
                          setSelectedDisposition={setSelectedDisposition}
                          setCallNotes={setCallNotes}
                          setShowDisposition={setShowDisposition}
                        />
                      ) : selectedScript === 'cold_call_transfer' ? (
                        <ColdCallTransferScriptPanel
                          prospectData={activeCallData}
                          leadId={activeCallData?.id}
                          onDataUpdate={(data: Record<string, unknown>) =>
                            setActiveCallData(prev =>
                              prev ? ({ ...prev, ...data } as ProspectData) : null
                            )
                          }
                          setSelectedDisposition={setSelectedDisposition}
                          setCallNotes={setCallNotes}
                          setShowDisposition={setShowDisposition}
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
                      )
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-muted-foreground p-8 text-center bg-white/5 border border-white/10 rounded-xl">
                        <p className="text-sm">Script is not available when no call is active.</p>
                      </div>
                    )}
                  </div>
                )}

                {activeCallView === 'captured_data' && (
                  <div className="flex-1 overflow-hidden flex flex-col bg-card border border-border rounded-xl p-4">
                    <CapturedScriptDataPanel activeCallData={activeCallData} crmPhone={crmPhone} />
                  </div>
                )}

                {activeCallView === 'data' && (
                  <div className="flex-1 overflow-hidden flex flex-col">
                    {crmData ? (
                      <CustomerCrmPanel
                        data={crmData}
                        loading={loadingCrm}
                        phone={crmPhone}
                        onRefresh={() => {
                          void fetchCrmData(crmPhone);
                        }}
                        onSwitchCustomer={phoneToSwitch => {
                          void fetchCrmData(phoneToSwitch);
                        }}
                        activeCall={
                          currentCall
                            ? {
                                state: currentCall.state,
                                direction: currentCall.direction,
                                campaignName:
                                  currentCall.prospectData?.campaignName ||
                                  activeCallData?.campaignName,
                                publisherName:
                                  currentCall.prospectData?.publisherName ||
                                  activeCallData?.publisherName,
                                buyerName:
                                  currentCall.prospectData?.buyerName || activeCallData?.buyerName,
                              }
                            : null
                        }
                      />
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-muted-foreground p-8 text-center">
                        <div>
                          <User className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-40" />
                          <p className="text-sm">
                            No profile data loaded. Dial a number or receive a call to fetch CRM
                            records.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* PreClosed Premium Calculator Panel */}
              {isPreClosed && (
                <div className="w-full lg:w-[380px] xl:w-[420px] shrink-0 flex flex-col bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-y-auto shadow-xl">
                  <PreClosedStatsCard leadData={crmData?.customer || activeCallData} />
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
                salesCount={salesCount}
                conversionRate={conversionRate}
              />

              {/* Auto-Dialer Control Panel */}
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 shadow-lg">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      isAutoDialing
                        ? autoDialStatus === 'paused'
                          ? 'bg-amber-500 animate-pulse'
                          : 'bg-emerald-500 animate-pulse'
                        : 'bg-slate-700'
                    }`}
                  />
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-1.5 font-sans">
                      Auto-Dialer Queue
                      {isAutoDialing && (
                        <span className="text-[10px] font-mono uppercase bg-cyan-400/20 text-cyan-400 px-1.5 py-0.5 rounded font-normal">
                          {autoDialStatus}
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5 font-sans">
                      {applications.length > 0
                        ? `Loaded: ${applications.length} leads. Current index: ${autoDialIndex + 1}.`
                        : 'Queue is empty. Upload leads to start.'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Target List Dropdown */}
                  <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 hover:border-slate-600 rounded-lg px-3 py-2 text-white text-xs font-mono font-medium uppercase tracking-widest transition-all">
                    <Database className="w-3.5 h-3.5 text-cyan-400" />
                    <select
                      value={selectedListId}
                      onChange={e => {
                        setSelectedListId(e.target.value);
                        // Reset dialer state when list changes
                        setIsAutoDialing(false);
                        setAutoDialIndex(0);
                        setAutoDialStatus('idle');
                      }}
                      className="bg-transparent text-white text-xs font-mono focus:outline-none cursor-pointer pr-4 font-bold uppercase"
                    >
                      <option value="" className="bg-slate-900 text-slate-400">
                        All Lists
                      </option>
                      {leadLists.map(list => (
                        <option key={list.id} value={list.id} className="bg-slate-900 text-white">
                          {list.name} ({list._count?.leads ?? 0})
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedListId && (
                    <button
                      onClick={handleDeleteList}
                      className="px-4 py-2 bg-red-950/40 hover:bg-red-900/60 border border-red-900/50 hover:border-red-700 text-red-400 text-xs font-mono font-medium uppercase tracking-widest rounded-lg transition-all flex items-center gap-2"
                      title="Delete Selected List"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete List
                    </button>
                  )}

                  <button
                    onClick={() => setShowUploadModal(true)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 text-white text-xs font-mono font-medium uppercase tracking-widest rounded-lg transition-all flex items-center gap-2"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Upload Leads
                  </button>

                  {/* Start / Pause Dialer */}
                  {isAutoDialing && autoDialStatus !== 'paused' ? (
                    <button
                      onClick={() => {
                        setIsAutoDialing(false);
                        setAutoDialStatus('paused');
                      }}
                      className="px-4 py-2 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 text-amber-400 text-xs font-mono font-bold uppercase tracking-widest rounded-lg transition-all flex items-center gap-2"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      Pause Dialer
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setIsAutoDialing(true);
                        setAutoDialStatus('calling');
                        const lead = applications[autoDialIndex];
                        if (lead) {
                          void startCallWithApplication(lead);
                        }
                      }}
                      disabled={applications.length === 0}
                      className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-500 disabled:border-slate-850 disabled:shadow-none text-slate-950 text-xs font-mono font-bold uppercase tracking-widest rounded-lg transition-all flex items-center gap-2 shadow-lg hover:shadow-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Start Dialer
                    </button>
                  )}

                  {/* Reset Dialer Queue */}
                  <button
                    onClick={() => {
                      setIsAutoDialing(false);
                      setAutoDialStatus('idle');
                      setAutoDialIndex(0);
                    }}
                    disabled={applications.length === 0 || autoDialIndex === 0}
                    className="p-2 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-600 disabled:border-slate-850 border border-slate-700 text-slate-400 hover:text-white rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-50"
                    title="Reset Dialer Queue"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <ApplicationQueue
                applications={applications}
                loadingApplications={loadingApplications}
                fetchApplications={fetchApplications}
                startCallWithApplication={startCallWithApplication}
                onDeleteLead={handleDeleteLead}
              />
            </div>
          )}
        </div>
      </div>

      {showUploadModal && (
        <CsvImportDialog
          onClose={() => setShowUploadModal(false)}
          onSuccess={() => {
            void fetchApplications();
          }}
        />
      )}
    </div>
  );
}

export default CallCenterPortal;
