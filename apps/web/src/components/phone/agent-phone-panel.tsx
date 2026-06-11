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

export function AgentPhonePanel(): JSX.Element {
 const {
 agentStatus,
 currentCall,
 isPhonePanelOpen,
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
 const apiUrl = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001');
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
 return 'bg-emerald-500';
 case 'on-call':
 return 'bg-amber-500';
 case 'away':
 return 'bg-red-500';
 case 'dnd':
 return 'bg-purple-500';
 case 'offline':
 return 'bg-gray-500';
 default:
 return 'bg-gray-500';
 }
 };

 // ============================================================================
 // Floating Phone Button (when panel is closed)
 // ============================================================================

 if (!isPhonePanelOpen) {
 return (
 <button
 onClick={togglePhonePanel}
 className={cn(
 'fixed bottom-6 right-6 z-50',
 'flex items-center gap-3 px-5 py-3 rounded-full',
 'bg-primary',
 'hover: hover:',
 'text-white font-medium shadow-sm',
 'transition-all duration-300 ease-out',
 'hover:scale-105 hover:',
 'border border-white/10',
 currentCall?.state === 'ringing' && 'animate-pulse'
 )}
 aria-label="Open phone"
 >
 <div className="relative">
 <Phone className="w-5 h-5" />
 {currentCall?.state === 'ringing' && (
 <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />
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
 'fixed bottom-6 right-6 z-40',
 'w-[380px] overflow-hidden',
 'bg-muted',
 ' border-white/10',
 'shadow-sm shadow-black/50',
 'transition-all duration-300 ease-out',
 isExpanded ? 'h-auto' : 'h-[72px]'
 )}
 >
 {/* Header */}
 <CardHeader className="p-4 pb-3 space-y-0 flex flex-row items-center justify-between border-b border-white/5">
 <div className="flex items-center gap-3">
 <div
 className={cn(
 'w-10 h-10 rounded-xl flex items-center justify-center',
 'bg-primary',
 'border border-cyan-500/30'
 )}
 >
 <Phone className="w-5 h-5 text-cyan-400" />
 </div>
 <div>
 <h3 className="font-semibold text-white text-sm">Agent Phone</h3>
 <div className="flex items-center gap-2">
 <AgentStatusSelector />
 </div>
 </div>
 </div>

 <div className="flex items-center gap-1">
 {currentCall?.state === 'active' && (
 <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 rounded-full mr-2">
 <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
 <span className="text-emerald-400 text-xs font-mono">
 {formatDuration(currentCall.duration)}
 </span>
 </div>
 )}

 <Button
 variant="ghost"
 size="icon"
 className="h-8 w-8 text-gray-400 hover:text-white"
 onClick={() => setShowSettings(true)}
 >
 <Settings className="w-4 h-4" />
 </Button>

 <Button
 variant="ghost"
 size="icon"
 className="h-8 w-8 text-gray-400 hover:text-white"
 onClick={() => setIsExpanded(!isExpanded)}
 >
 {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
 </Button>

 <Button
 variant="ghost"
 size="icon"
 className="h-8 w-8 text-gray-400 hover:text-white"
 onClick={closePhonePanel}
 >
 <X className="w-4 h-4" />
 </Button>
 </div>
 </CardHeader>

 {/* Error Banner */}
 {error && (
 <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20">
 <div className="flex items-center justify-between">
 <span className="text-red-400 text-xs">{error}</span>
 <button onClick={clearError} className="text-red-400 hover:text-red-300">
 <X className="w-3 h-3" />
 </button>
 </div>
 </div>
 )}

 {/* Intake Match Badge */}
 {intakeMatchDetected && (
 <div className="px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/20">
 <div className="flex items-center gap-2">
 <CheckCircle2 className="w-4 h-4 text-emerald-400" />
 <span className="text-emerald-400 text-xs font-medium">
 {matchedProspect ? 'Matched to Database Record' : 'Matched to Intake Form'}
 </span>
 {matchedProspect && (
 <span className="text-emerald-400/70 text-xs">
 ({matchedProspect.firstName} {matchedProspect.lastName})
 </span>
 )}
 </div>
 </div>
 )}

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

 {isExpanded && (
 <CardContent className="p-0">
 {/* Active Call View */}
 {currentCall && currentCall.state !== 'ringing' && currentCall.state !== 'ended' && (
 <div className="p-4 space-y-4">
 {/* Screen Pop */}
 {currentCall.prospectData && <ScreenPop data={currentCall.prospectData} />}

 {/* Caller Info */}
 <div className="text-center py-4">
 <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-primary flex items-center justify-center border border-cyan-500/30">
 <User className="w-8 h-8 text-cyan-400" />
 </div>
 <h4 className="text-white font-semibold text-lg">
 {currentCall.callerName || 'Unknown Caller'}
 </h4>
 <p className="text-gray-400 text-sm">{currentCall.phoneNumber}</p>
 {currentCall.queueName && (
 <p className="text-cyan-400 text-xs mt-1">From: {currentCall.queueName}</p>
 )}
 </div>

 {/* Call Status Indicator */}
 {currentCall.isOnHold && (
 <div className="flex items-center justify-center gap-2 py-2 bg-amber-500/10 rounded-lg">
 <Pause className="w-4 h-4 text-amber-400" />
 <span className="text-amber-400 text-sm">Call On Hold</span>
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
 <div className="flex gap-1 p-1 bg-white/5 rounded-lg">
 {(['dialpad', 'history', 'settings'] as const).map(tab => (
 <button
 key={tab}
 onClick={() => setActiveTab(tab)}
 className={cn(
 'flex-1 py-2 px-3 rounded-md text-xs font-medium transition-all',
 activeTab === tab
 ? 'bg-primary text-white shadow-lg'
 : 'text-gray-400 hover:text-white hover:bg-white/5'
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
   <DialPad />
 </>
 )}
 {activeTab === 'history' && <CallHistory />}
 {activeTab === 'settings' && <PhoneSettings />}
 </div>
 )}
 </CardContent>
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

 const formatTime = (date?: Date): string => {
 if (!date) return '';
 return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
 };

 const handleCallClick = (phoneNumber: string) => {
 void makeCall(phoneNumber);
 };

 if (callHistory.length === 0) {
 return (
 <div className="text-center py-8">
 <Clock className="w-10 h-10 mx-auto mb-3 text-gray-600" />
 <p className="text-gray-500 text-sm">No recent calls</p>
 </div>
 );
 }

 return (
 <div className="space-y-2 max-h-[300px] overflow-y-auto">
 {callHistory.map((call: CallInfo, index: number) => (
 <button
 key={`${call.callId}-${index}`}
 onClick={() => handleCallClick(call.phoneNumber)}
 className={cn(
 'w-full p-3 rounded-lg text-left transition-all',
 'bg-white/5 hover:bg-white/10 border border-transparent hover:border-white/10'
 )}
 >
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div
 className={cn(
 'w-8 h-8 rounded-full flex items-center justify-center',
 call.direction === 'inbound'
 ? 'bg-cyan-500/20 text-cyan-400'
 : 'bg-blue-500/20 text-blue-400'
 )}
 >
 {call.direction === 'inbound' ? (
 <Phone className="w-4 h-4" />
 ) : (
 <PhoneForwarded className="w-4 h-4" />
 )}
 </div>
 <div>
 <p className="text-white text-sm font-medium">
 {call.callerName || call.phoneNumber}
 </p>
 <p className="text-gray-500 text-xs">
 {call.direction === 'inbound' ? 'Incoming' : 'Outgoing'}
 {call.duration > 0 &&
 ` • ${Math.floor(call.duration / 60)}m ${call.duration % 60}s`}
 </p>
 </div>
 </div>
 <span className="text-gray-500 text-xs">{formatTime(call.startTime)}</span>
 </div>
 </button>
 ))}
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
 <label className="block text-xs text-gray-400 mb-2">Microphone</label>
 <select
 value={selectedAudioInput ?? ''}
 onChange={e => setAudioInput(e.target.value)}
 className={cn(
 'w-full px-3 py-2 rounded-lg text-sm',
 'bg-white/5 border border-white/10',
 'text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500',
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
 <label className="block text-xs text-gray-400 mb-2">Speaker</label>
 <select
 value={selectedAudioOutput ?? ''}
 onChange={e => setAudioOutput(e.target.value)}
 className={cn(
 'w-full px-3 py-2 rounded-lg text-sm',
 'bg-white/5 border border-white/10',
 'text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500',
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
 <div className="pt-2 border-t border-white/5">
 <p className="text-gray-400 text-xs mb-2">
 Configure which prospect fields appear during incoming calls.
 </p>
 <Button
 variant="outline"
 size="sm"
 className="w-full border-white/10 text-gray-300 hover:bg-white/5"
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

 if (userNumbers.length === 1) {
   return (
     <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-white/5 border border-white/10">
       <Phone className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
       <span className="text-xs text-gray-400">Calling from:</span>
       <span className="text-xs text-white font-medium">{formatPhone(userNumbers[0].number)}</span>
     </div>
   );
 }

 return (
   <div className="mb-2">
     <label className="flex items-center gap-2 text-xs text-gray-400 mb-1.5">
       <Phone className="w-3 h-3 text-cyan-400" />
       Calling from:
     </label>
     <select
       value={selectedCallerId || ''}
       onChange={e => setSelectedCallerId(e.target.value)}
       className={cn(
         'w-full px-3 py-2 rounded-lg text-sm',
         'bg-white/5 border border-white/10',
         'text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500',
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


