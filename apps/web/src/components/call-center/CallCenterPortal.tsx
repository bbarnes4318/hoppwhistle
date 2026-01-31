'use client';

// ============================================================================
// CallCenterPortal.tsx - COMPLETE PORT FROM fe-rickie/CallPopApp.jsx
// Exact 1:1 port with zero UI/functionality differences
// ============================================================================

import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  PhoneCall,
  PhoneForwarded,
  Mic,
  MicOff,
  Pause,
  Play,
  Circle,
  Users,
  UserPlus,
  FileText,
  Bell,
  CheckCircle,
  RefreshCw,
  Headphones,
  LogIn,
  X,
  Settings,
  Clock,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useState, useEffect, useRef, useCallback } from 'react';

import IntegratedScriptPanel from './IntegratedScriptPanel';
import RetentionScriptPanel from './RetentionScriptPanel';

import { usePhone } from '@/components/phone/phone-provider';
import { useLeadInjection } from '@/hooks/useLeadInjection';
import { useScriptAccess } from '@/hooks/useUserRoles';

// ============================================================================
// TYPES
// ============================================================================
type CurrentView = 'roleSelect' | 'agentDashboard' | 'publisherSetup' | 'crmDashboard';
type AgentStatus = 'available' | 'away' | 'on_call';
type ActiveCallView = 'script' | 'data';

interface ProspectData {
  lead_token?: string;
  caller_id?: string;
  first_name?: string;
  last_name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  zip?: string;
  dob?: string;
  age?: number;
  gender?: string;
  coverage_amount?: number;
  faceAmount?: number;
  premium?: string;
  monthlyPremium?: string;
  carrier?: string;
  beneficiary?: string;
  [key: string]: unknown;
}

interface ApplicationData extends ProspectData {
  id: string;
  name?: string;
  status: string;
  planType?: string;
}

interface CallRecord {
  id: string;
  notificationId: string;
  prospect: ProspectData;
  timestamp: string;
  disposition: string;
  dispositionDetails: string | object;
  callDuration?: number;
  callEndTime: string;
}

// ============================================================================
// CARRIER/PLAN CONFIG
// ============================================================================
const CARRIER_PLANS: Record<string, string[]> = {
  Aetna: ['Level'],
  AHL: ['Level'],
  Aflac: ['Level', 'Modified'],
  'American Amicable': ['Level', 'Graded', 'Return of Premium'],
  CICA: ['Level', 'Guaranteed Issue'],
  Corebridge: ['Level', 'Guaranteed Issue'],
  Gerber: ['Guaranteed Issue'],
  GTL: ['Graded'],
  'Mutual of Omaha': ['Level', 'Guaranteed Issue'],
  SBLI: ['Level', 'Modified'],
  Securico: ['Level', 'Graded', 'Modified'],
  TransAmerica: ['Level', 'Graded'],
};
const CARRIERS = Object.keys(CARRIER_PLANS);

const DISPOSITIONS = [
  'Sale Made',
  'Callback Scheduled',
  'Left Voicemail',
  'No Answer',
  'Not Interested',
  'Wrong Number',
  'Do Not Call',
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export function CallCenterPortal(): JSX.Element {
  const router = useRouter();
  const {
    currentCall,
    agentStatus: phoneAgentStatus,
    makeCall,
    hangupCall,
    answerCall,
    toggleMute,
    toggleHold,
  } = usePhone();

  // Lead Injection - Pre-call data from webhooks
  const { leadData, isConnected: leadStreamConnected, lookupLead, clearLead } = useLeadInjection();
  const [preInjectedData, setPreInjectedData] = useState<ProspectData | null>(null);

  // State
  const [currentView, setCurrentView] = useState<CurrentView>('roleSelect');
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('available');

  // Call State
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);
  const [showDisposition, setShowDisposition] = useState(false);
  const [incomingCallData, setIncomingCallData] = useState<ProspectData | null>(null);
  const [activeCallData, setActiveCallData] = useState<ProspectData | null>(null);
  const [activeCallView, setActiveCallView] = useState<ActiveCallView>('script');

  // Call Controls
  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [thirdPartyNumber, setThirdPartyNumber] = useState('');
  const [thirdPartyConnected, setThirdPartyConnected] = useState(false);
  const [isAddingThirdParty, setIsAddingThirdParty] = useState(false);
  const [showTransferPanel, setShowTransferPanel] = useState(false);

  // Dialer
  const [phoneNumber, setPhoneNumber] = useState('');
  const [callTimer, setCallTimer] = useState(0);
  const [callNotes, setCallNotes] = useState('');
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Track disposition state to prevent duplicate prompts
  const dispositionHandledRef = useRef<boolean>(false);
  const callSessionIdRef = useRef<string | null>(null);

  // Disposition
  const [selectedDisposition, setSelectedDisposition] = useState('');
  const [saleCarrier, setSaleCarrier] = useState('');
  const [salePlanType, setSalePlanType] = useState('');
  const [saleAnnualPremium, setSaleAnnualPremium] = useState('');

  // Applications & Records
  const [applications, setApplications] = useState<ApplicationData[]>([]);
  const [loadingApplications, setLoadingApplications] = useState(false);
  const [callRecords, setCallRecords] = useState<CallRecord[]>([]);

  // User Settings & Stats
  const [showSettings, setShowSettings] = useState(false);
  const [salesCount, setSalesCount] = useState(0);
  const [totalCallsCount, setTotalCallsCount] = useState(0);

  // Database-driven role and script access
  const {
    canAccessRetentionScript,
    derivedJobTitle,
    loading: rolesLoading,
    isAdminOrOwner,
  } = useScriptAccess();

  // Calculate conversion rate: (Sales / Total Calls) * 100
  const conversionRate =
    totalCallsCount > 0 ? ((salesCount / totalCallsCount) * 100).toFixed(1) : '0.0';

  // ─────────────────────────────────────────────────────────────────────────
  // SYNC WITH PHONE HOOK - React to incoming/active calls from sip.js
  // Fixed: Disposition modal now only triggers on genuine CALL_ENDED event
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Case 1: No active call from the SIP hook
    if (!currentCall) {
      // Only trigger disposition if we HAD an active call and haven't already handled it
      if (isCallActive && !dispositionHandledRef.current && callSessionIdRef.current) {
        console.log('[CallCenter] Call ended - triggering disposition modal');
        if (callTimerRef.current) clearInterval(callTimerRef.current);

        // Mark disposition as handled for this call session
        dispositionHandledRef.current = true;

        setIsCallActive(false);
        setShowDisposition(true);
        setAgentStatus('available');
      }
      setIsIncomingCall(false);
      return;
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
      });
      setAgentStatus('on_call');
    }

    // Case 3: Call is active (connected)
    if (currentCall.state === 'active' || currentCall.state === 'connecting') {
      // New call session - reset disposition tracking
      if (!callSessionIdRef.current || callSessionIdRef.current !== currentCall.id) {
        callSessionIdRef.current = currentCall.id || `call-${Date.now()}`;
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
        });
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
          setActiveCallData(prev => ({
            ...prev,
            ...leadData,
            // Preserve any existing phone info
            caller_id: prev?.caller_id || leadData.caller_id,
            phone: prev?.phone || leadData.phone,
          }));
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
        setIncomingCallData(prev => ({
          ...prev,
          ...preInjectedData,
          caller_id: prev?.caller_id, // Keep the original caller_id
        }));
      } else {
        // Try to lookup from the API
        lookupLead(callerPhone)
          .then(lead => {
            if (lead) {
              console.log('[CallCenter] Enriching incoming call with API lookup data');
              setIncomingCallData(prev => ({
                ...prev,
                ...lead,
                caller_id: prev?.caller_id,
              }));
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
    setAgentStatus('on_call');
    setCallTimer(0);
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
    setIsRecording(false);
    setThirdPartyConnected(false);
    setIsAddingThirdParty(false);
    setThirdPartyNumber('');
  };

  const handleSaveDisposition = () => {
    if (selectedDisposition && activeCallData) {
      const callRecord: CallRecord = {
        id: 'record-' + Date.now(),
        notificationId: 'pop-' + Date.now(),
        prospect: activeCallData,
        timestamp: new Date().toISOString(),
        disposition: selectedDisposition,
        dispositionDetails: callNotes,
        callDuration: callTimer,
        callEndTime: new Date().toISOString(),
      };
      setCallRecords(prev => [...prev, callRecord]);

      // Track stats for conversion calculation
      setTotalCallsCount(prev => prev + 1);

      // If "Sale Made" disposition, increment sales count
      if (selectedDisposition === 'Sale Made') {
        setSalesCount(prev => prev + 1);
      }
    }
    setShowDisposition(false);
    setSelectedDisposition('');
    setSaleCarrier('');
    setSalePlanType('');
    setSaleAnnualPremium('');
    setCallNotes('');
    setCallTimer(0);
    setActiveCallData(null);

    // Reset call session tracking for next call
    callSessionIdRef.current = null;
    dispositionHandledRef.current = false;

    // Clear pre-injected lead data for next call
    setPreInjectedData(null);
    clearLead();
  };

  const startCallWithApplication = async (app: ApplicationData) => {
    setActiveCallData(app);
    setIsCallActive(true);
    setAgentStatus('on_call');
    setCallTimer(0);
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
      fetchApplications();
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
            <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-cyan-500/30">
              <Phone className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-slate-800 mb-2">Call Center Platform</h1>
            <p className="text-slate-500">Select your workspace to continue</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div
              onClick={() => setCurrentView('agentDashboard')}
              className="bg-white rounded-2xl shadow-xl overflow-hidden cursor-pointer group hover:shadow-2xl hover:shadow-cyan-500/20 transition-all duration-300 border border-slate-100 hover:border-cyan-300"
            >
              <div className="bg-gradient-to-r from-cyan-600 to-blue-600 p-4">
                <div className="flex items-center justify-between">
                  <Headphones className="w-8 h-8 text-white" />
                  <span className="px-3 py-1 bg-white/20 text-white text-xs font-bold rounded-full backdrop-blur-sm">
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
              className="bg-white rounded-2xl shadow-xl overflow-hidden cursor-pointer group hover:shadow-2xl hover:shadow-green-500/20 transition-all duration-300 border border-slate-100 hover:border-green-300"
            >
              <div className="bg-gradient-to-r from-green-600 to-emerald-600 p-4">
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
              className="bg-white rounded-2xl shadow-xl overflow-hidden cursor-pointer group hover:shadow-2xl hover:shadow-purple-500/20 transition-all duration-300 border border-slate-100 hover:border-purple-300"
            >
              <div className="bg-gradient-to-r from-purple-600 to-violet-600 p-4">
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
              className="px-8 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl hover:shadow-cyan-500/30 transition-all"
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
    <div className="h-screen bg-[#0a0a0f] flex flex-col overflow-hidden">
      <style>
        {
          '.pulse-glow { animation: pulse-glow 2s ease-in-out infinite; } @keyframes pulse-glow { 0%, 100% { box-shadow: 0 0 5px currentColor, 0 0 10px currentColor; } 50% { box-shadow: 0 0 15px currentColor, 0 0 25px currentColor; } } .glass-panel { background: rgba(19, 19, 26, 0.8); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.1); }'
        }
      </style>

      {/* Header */}
      <div className="bg-[#13131a] border-b border-[#1e1e2e] px-6 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Headphones className="w-6 h-6 text-cyan-400" />
              <h1 className="text-lg font-bold text-white">Agent Dashboard</h1>
            </div>

            <select
              value={agentStatus}
              onChange={e => setAgentStatus(e.target.value as AgentStatus)}
              disabled={isCallActive || isIncomingCall}
              className="appearance-none bg-[#1e1e2e] text-white text-sm pl-3 pr-8 py-1.5 rounded-lg border border-[#2e2e3e] focus:border-cyan-500 focus:outline-none cursor-pointer disabled:opacity-50"
            >
              <option value="available">Available</option>
              <option value="away">Away</option>
              <option value="on_call">On Call</option>
            </select>

            {/* User Role Badge (from database) */}
            <span
              className={`px-3 py-1.5 text-sm rounded-lg ${
                isAdminOrOwner
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/50'
                  : 'bg-slate-500/20 text-slate-300 border border-slate-500/50'
              }`}
            >
              {rolesLoading ? '...' : derivedJobTitle}
            </span>

            {/* Show current script access badge */}
            <span
              className={`px-2 py-1 text-xs rounded-full ${canAccessRetentionScript ? 'bg-purple-500/20 text-purple-300 border border-purple-500/50' : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'}`}
            >
              {canAccessRetentionScript ? 'Multi-Script' : 'Sales Script'}
            </span>
          </div>

          <div className="flex items-center space-x-4">
            {isCallActive && (
              <div className="flex items-center space-x-2 px-3 py-1 bg-red-500/20 border border-red-500/50 rounded-lg">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-red-400 font-mono text-sm">{formatTime(callTimer)}</span>
              </div>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 bg-[#1e1e2e] hover:bg-[#2e2e3e] rounded-lg border border-[#2e2e3e] transition-colors"
              title="Settings"
            >
              <Settings className="w-4 h-4 text-gray-400" />
            </button>
            <button
              onClick={() => setCurrentView('roleSelect')}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              ← Exit
            </button>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#13131a] rounded-2xl border border-[#2e2e3e] w-full max-w-md shadow-2xl">
            <div className="p-4 border-b border-[#2e2e3e] flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">User Settings</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1 hover:bg-[#2e2e3e] rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Your Role</label>
                <div className="w-full bg-[#1e1e2e] text-white text-sm p-3 rounded-lg border border-[#2e2e3e]">
                  {rolesLoading ? (
                    <span className="text-gray-500">Loading...</span>
                  ) : (
                    <span className={isAdminOrOwner ? 'text-purple-400' : 'text-slate-300'}>
                      {derivedJobTitle}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Your role is assigned by your organization administrator.
                </p>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">Script Access</label>
                <div className="p-3 bg-[#1e1e2e] rounded-lg border border-[#2e2e3e]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-white">Main Final Expense Sales Script</span>
                    <span className="text-xs text-green-400">✓ Active</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white">Retention Script</span>
                    <span
                      className={`text-xs ${canAccessRetentionScript ? 'text-green-400' : 'text-gray-500'}`}
                    >
                      {canAccessRetentionScript ? '✓ Available' : '✗ Restricted'}
                    </span>
                  </div>
                </div>
                {!canAccessRetentionScript && (
                  <p className="text-xs text-gray-500 mt-2">
                    Retention Script requires ADMIN or OWNER role.
                  </p>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-[#2e2e3e]">
              <button
                onClick={() => setShowSettings(false)}
                className="w-full py-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
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
        <div className="w-80 flex-shrink-0 border-r border-[#1e1e2e] p-4 flex flex-col">
          <div className="glass-panel rounded-2xl p-4 flex-1 flex flex-col">
            {/* Incoming Call State */}
            {isIncomingCall && incomingCallData && (
              <div className="flex-1 flex flex-col items-center justify-center space-y-6">
                <div className="w-24 h-24 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center text-green-400">
                  <PhoneIncoming className="w-12 h-12 text-white" />
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">
                    {incomingCallData.first_name} {incomingCallData.last_name}
                  </p>
                  <p className="text-gray-400">{incomingCallData.caller_id}</p>
                </div>
                <div className="flex space-x-4">
                  <button
                    onClick={handleDeclineCall}
                    className="w-16 h-16 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center transition-colors shadow-lg shadow-red-500/30"
                  >
                    <PhoneOff className="w-7 h-7 text-white" />
                  </button>
                  <button
                    onClick={handleAnswerCall}
                    className="w-16 h-16 bg-green-500 hover:bg-green-600 rounded-full flex items-center justify-center transition-colors shadow-lg shadow-green-500/30 pulse-glow text-green-400"
                  >
                    <Phone className="w-7 h-7 text-white" />
                  </button>
                </div>
              </div>
            )}

            {/* Active Call State */}
            {isCallActive && activeCallData && !showDisposition && (
              <div className="flex-1 flex flex-col">
                <div className="text-center mb-4">
                  <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-2">
                    <PhoneCall className="w-8 h-8 text-white" />
                  </div>
                  <p className="text-lg font-bold text-white">
                    {activeCallData.first_name || activeCallData.firstName}{' '}
                    {activeCallData.last_name || activeCallData.lastName}
                  </p>
                  <p className="text-sm text-gray-400">
                    {activeCallData.caller_id || activeCallData.phone}
                  </p>
                  <div className="flex items-center justify-center space-x-2 mt-1">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-green-400 text-sm">Connected</span>
                  </div>
                </div>

                {/* Call Controls */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <button
                    onClick={() => {
                      toggleMute();
                      setIsMuted(!isMuted);
                    }}
                    className={
                      'p-3 rounded-xl flex flex-col items-center transition-all ' +
                      (isMuted
                        ? 'bg-red-500/30 border border-red-500'
                        : 'bg-[#1e1e2e] hover:bg-[#2e2e3e] border border-[#2e2e3e]')
                    }
                  >
                    {isMuted ? (
                      <MicOff className="w-5 h-5 text-red-400" />
                    ) : (
                      <Mic className="w-5 h-5 text-gray-300" />
                    )}
                    <span className="text-xs text-gray-400 mt-1">Mute</span>
                  </button>
                  <button
                    onClick={() => {
                      toggleHold();
                      setIsOnHold(!isOnHold);
                    }}
                    className={
                      'p-3 rounded-xl flex flex-col items-center transition-all ' +
                      (isOnHold
                        ? 'bg-yellow-500/30 border border-yellow-500'
                        : 'bg-[#1e1e2e] hover:bg-[#2e2e3e] border border-[#2e2e3e]')
                    }
                  >
                    {isOnHold ? (
                      <Play className="w-5 h-5 text-yellow-400" />
                    ) : (
                      <Pause className="w-5 h-5 text-gray-300" />
                    )}
                    <span className="text-xs text-gray-400 mt-1">Hold</span>
                  </button>
                  <button
                    onClick={() => setIsRecording(!isRecording)}
                    className={
                      'p-3 rounded-xl flex flex-col items-center transition-all ' +
                      (isRecording
                        ? 'bg-red-500/30 border border-red-500'
                        : 'bg-[#1e1e2e] hover:bg-[#2e2e3e] border border-[#2e2e3e]')
                    }
                  >
                    <Circle
                      className={
                        'w-5 h-5 ' + (isRecording ? 'text-red-400 fill-red-400' : 'text-gray-300')
                      }
                    />
                    <span className="text-xs text-gray-400 mt-1">
                      {isRecording ? 'Recording' : 'Record'}
                    </span>
                  </button>
                </div>

                {/* 3-Way / Transfer Buttons */}
                {!isAddingThirdParty && !thirdPartyConnected && (
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <button
                      onClick={() => setIsAddingThirdParty(true)}
                      className="p-3 rounded-xl bg-purple-500/20 border border-purple-500/50 hover:bg-purple-500/30 flex flex-col items-center transition-all"
                    >
                      <UserPlus className="w-5 h-5 text-purple-400" />
                      <span className="text-xs text-purple-300 mt-1">Add 3rd Party</span>
                    </button>
                    <button
                      onClick={() => setShowTransferPanel(!showTransferPanel)}
                      className="p-3 rounded-xl bg-blue-500/20 border border-blue-500/50 hover:bg-blue-500/30 flex flex-col items-center transition-all"
                    >
                      <PhoneForwarded className="w-5 h-5 text-blue-400" />
                      <span className="text-xs text-blue-300 mt-1">Warm Transfer</span>
                    </button>
                  </div>
                )}

                {/* Hang Up */}
                <div className="mt-auto">
                  <button
                    onClick={handleHangup}
                    className="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl flex items-center justify-center space-x-2 transition-colors shadow-lg shadow-red-500/30"
                  >
                    <PhoneOff className="w-5 h-5" />
                    <span>End Call</span>
                  </button>
                </div>
              </div>
            )}

            {/* Disposition Panel */}
            {showDisposition && (
              <div className="flex-1 flex flex-col overflow-y-auto">
                <h3 className="text-lg font-bold text-white mb-4">Call Disposition</h3>
                <div className="space-y-2 mb-4">
                  {DISPOSITIONS.map(disposition => (
                    <button
                      key={disposition}
                      onClick={() => {
                        setSelectedDisposition(disposition);
                        if (disposition !== 'Sale Made') {
                          setSaleCarrier('');
                          setSalePlanType('');
                          setSaleAnnualPremium('');
                        }
                      }}
                      className={
                        'w-full p-3 rounded-lg text-left text-sm transition-all ' +
                        (selectedDisposition === disposition
                          ? 'bg-cyan-500/30 border border-cyan-500 text-cyan-300'
                          : 'bg-[#1e1e2e] border border-[#2e2e3e] text-gray-300 hover:border-gray-500')
                      }
                    >
                      {disposition}
                    </button>
                  ))}
                </div>

                {selectedDisposition === 'Sale Made' && (
                  <div className="bg-[#1e1e2e] border border-cyan-500/30 rounded-xl p-4 mb-4 space-y-3">
                    <h4 className="text-sm font-bold text-cyan-400 mb-3">
                      Sale Details (Required)
                    </h4>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Carrier</label>
                      <select
                        value={saleCarrier}
                        onChange={e => {
                          setSaleCarrier(e.target.value);
                          setSalePlanType('');
                        }}
                        className="w-full bg-[#13131a] border border-[#2e2e3e] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                      >
                        <option value="">Select Carrier...</option>
                        {CARRIERS.map(carrier => (
                          <option key={carrier} value={carrier}>
                            {carrier}
                          </option>
                        ))}
                      </select>
                    </div>
                    {saleCarrier && (
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block">Plan Type</label>
                        <select
                          value={salePlanType}
                          onChange={e => setSalePlanType(e.target.value)}
                          className="w-full bg-[#13131a] border border-[#2e2e3e] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                        >
                          <option value="">Select Plan Type...</option>
                          {CARRIER_PLANS[saleCarrier]?.map(plan => (
                            <option key={plan} value={plan}>
                              {plan}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Annual Premium ($)</label>
                      <input
                        type="number"
                        value={saleAnnualPremium}
                        onChange={e => setSaleAnnualPremium(e.target.value)}
                        placeholder="e.g. 1200"
                        className="w-full bg-[#13131a] border border-[#2e2e3e] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  </div>
                )}

                <button
                  onClick={handleSaveDisposition}
                  disabled={
                    !selectedDisposition ||
                    (selectedDisposition === 'Sale Made' &&
                      (!saleCarrier || !salePlanType || !saleAnnualPremium))
                  }
                  className="w-full py-3 bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors"
                >
                  Save and Continue
                </button>
              </div>
            )}

            {/* Idle State - Keypad */}
            {!isIncomingCall && !isCallActive && !showDisposition && (
              <div className="flex-1 flex flex-col">
                <div className="mb-4">
                  <input
                    type="text"
                    value={phoneNumber}
                    onChange={e =>
                      setPhoneNumber(formatPhoneNumber(e.target.value.replace(/\D/g, '')))
                    }
                    placeholder="(555) 123-4567"
                    className="w-full bg-transparent text-2xl text-white text-center font-mono py-3 border-b border-[#2e2e3e] focus:border-cyan-500 focus:outline-none transition-colors"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 mb-4">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(key => (
                    <button
                      key={key}
                      onClick={() => handleKeypadPress(key)}
                      className="aspect-square bg-[#1e1e2e] hover:bg-[#2e2e3e] rounded-xl flex items-center justify-center text-xl text-white font-medium transition-colors border border-[#2e2e3e]"
                    >
                      {key}
                    </button>
                  ))}
                </div>

                <div className="flex space-x-3 mt-auto">
                  <button
                    onClick={() => setPhoneNumber('')}
                    className="flex-1 py-3 bg-[#1e1e2e] hover:bg-[#2e2e3e] text-gray-400 rounded-xl transition-colors border border-[#2e2e3e]"
                  >
                    Clear
                  </button>
                  <button
                    disabled={phoneNumber.replace(/\D/g, '').length !== 10}
                    onClick={async () => {
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
                        callTimerRef.current = setInterval(
                          () => setCallTimer(prev => prev + 1),
                          1000
                        );
                        try {
                          await makeCall(dialNumber);
                        } catch (e) {
                          console.error(e);
                          setIsCallActive(false);
                          setAgentStatus('available');
                          if (callTimerRef.current) clearInterval(callTimerRef.current);
                        }
                      }
                    }}
                    className="flex-1 py-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl transition-colors flex items-center justify-center space-x-2"
                  >
                    <Phone className="w-5 h-5" />
                    <span>Call</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center/Right Column - Script or Queue */}
        <div className="flex-1 p-4 overflow-hidden flex flex-col">
          {isCallActive && activeCallData ? (
            <div className="flex-1 flex flex-col overflow-hidden gap-2">
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setActiveCallView('script')}
                  className={
                    'px-4 py-2 rounded-lg font-medium text-sm transition-all ' +
                    (activeCallView === 'script'
                      ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-500/30'
                      : 'bg-[#1e1e2e] text-gray-400 hover:text-white border border-[#2e2e3e]')
                  }
                >
                  Script and Call Guide
                </button>
                <button
                  onClick={() => setActiveCallView('data')}
                  className={
                    'px-4 py-2 rounded-lg font-medium text-sm transition-all ' +
                    (activeCallView === 'data'
                      ? 'bg-gradient-to-r from-purple-600 to-violet-600 text-white shadow-lg shadow-purple-500/30'
                      : 'bg-[#1e1e2e] text-gray-400 hover:text-white border border-[#2e2e3e]')
                  }
                >
                  Customer Data
                </button>
              </div>

              {activeCallView === 'script' && (
                <div className="flex-1 overflow-hidden">
                  {canAccessRetentionScript ? (
                    <RetentionScriptPanel
                      prospectData={activeCallData}
                      onDataUpdate={(data: Record<string, unknown>) =>
                        setActiveCallData(prev => (prev ? { ...prev, ...data } : null))
                      }
                    />
                  ) : (
                    <IntegratedScriptPanel
                      prospectData={activeCallData}
                      onDataUpdate={(data: Partial<ProspectData>) =>
                        setActiveCallData(prev => (prev ? { ...prev, ...data } : null))
                      }
                    />
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-4 overflow-hidden">
              {/* Stats Bar - Order: Total Calls | Applications | Conversion | Queue */}
              <div className="grid grid-cols-4 gap-4 flex-shrink-0">
                {/* 1. Total Calls */}
                <div className="glass-panel rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-500">Total Calls</p>
                      <p className="text-2xl font-bold text-white">{totalCallsCount}</p>
                    </div>
                    <Phone className="w-8 h-8 text-blue-500" />
                  </div>
                </div>
                {/* 2. Applications (Sales) */}
                <div className="glass-panel rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-500">Applications</p>
                      <p className="text-2xl font-bold text-white">{salesCount}</p>
                    </div>
                    <FileText className="w-8 h-8 text-cyan-500" />
                  </div>
                </div>
                {/* 3. Conversion - (Applications / Total Calls) * 100 */}
                <div className="glass-panel rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-500">Conversion</p>
                      <p className="text-2xl font-bold text-green-400">{conversionRate}%</p>
                    </div>
                    <CheckCircle className="w-8 h-8 text-green-500" />
                  </div>
                </div>
                {/* 4. Queue */}
                <div className="glass-panel rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-500">Queue</p>
                      <p className="text-2xl font-bold text-yellow-400">
                        {applications.filter(a => a.status === 'Submitted').length}
                      </p>
                    </div>
                    <Bell className="w-8 h-8 text-yellow-500" />
                  </div>
                </div>
              </div>

              <div className="flex-1 glass-panel rounded-2xl overflow-hidden flex flex-col">
                <div className="p-4 border-b border-[#2e2e3e] flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white">Application Queue</h2>
                  <button
                    onClick={fetchApplications}
                    disabled={loadingApplications}
                    className="flex items-center space-x-2 px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded-lg text-sm transition-colors disabled:opacity-50"
                  >
                    <RefreshCw
                      className={'w-4 h-4 ' + (loadingApplications ? 'animate-spin' : '')}
                    />
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {loadingApplications ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <RefreshCw className="w-12 h-12 text-cyan-500 mx-auto mb-3 animate-spin" />
                        <p className="text-gray-500">Loading applications...</p>
                      </div>
                    </div>
                  ) : applications.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <FileText className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                        <p className="text-gray-500">No applications in queue</p>
                      </div>
                    </div>
                  ) : (
                    <table className="w-full">
                      <thead className="bg-[#1e1e2e] sticky top-0">
                        <tr>
                          <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">
                            Customer
                          </th>
                          <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">
                            Phone
                          </th>
                          <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">
                            Carrier
                          </th>
                          <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">
                            Face Amount
                          </th>
                          <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">
                            Status
                          </th>
                          <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1e1e2e]">
                        {applications.map(app => (
                          <tr key={app.id} className="hover:bg-[#1e1e2e]/50 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center space-x-3">
                                <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center">
                                  <span className="text-xs font-bold text-white">
                                    {(app.firstName || app.name?.split(' ')[0] || '?')[0]}
                                    {(app.lastName || app.name?.split(' ')[1] || '')[0]}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-white text-sm font-medium block">
                                    {app.name || (app.firstName || '') + ' ' + (app.lastName || '')}
                                  </span>
                                  <span className="text-gray-500 text-xs">{app.state}</span>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-sm font-mono">
                              {app.phone || 'N/A'}
                            </td>
                            <td className="px-4 py-3 text-white text-sm">{app.carrier || 'N/A'}</td>
                            <td className="px-4 py-3 text-emerald-400 text-sm font-bold">
                              ${(app.faceAmount || 0).toLocaleString()}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={
                                  'px-2 py-1 rounded-full text-xs font-medium ' +
                                  (app.status === 'Submitted'
                                    ? 'bg-blue-500/20 text-blue-400'
                                    : app.status === 'Issued'
                                      ? 'bg-green-500/20 text-green-400'
                                      : 'bg-gray-500/20 text-gray-400')
                                }
                              >
                                {app.status}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => startCallWithApplication(app)}
                                className="flex items-center space-x-1 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs font-medium transition-colors"
                              >
                                <Phone className="w-3 h-3" />
                                <span>Call</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CallCenterPortal;
