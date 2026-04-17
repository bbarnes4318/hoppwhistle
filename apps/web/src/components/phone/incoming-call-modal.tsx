'use client';

import { Phone, PhoneOff, Tag, User } from 'lucide-react';
import { useEffect, useState } from 'react';

import { usePhone, type CallInfo } from './phone-provider';
import { ScreenPop } from './screen-pop';

import { cn } from '@/lib/utils';

// ============================================================================
// Incoming Call Modal
// ============================================================================

interface IncomingCallModalProps {
 call: CallInfo;
}

export function IncomingCallModal({ call }: IncomingCallModalProps): JSX.Element {
 const { answerCall, hangupCall } = usePhone();
 const [ringDuration, setRingDuration] = useState(0);

 // Track ring duration
 useEffect(() => {
 const interval = setInterval(() => {
 setRingDuration(prev => prev + 1);
 }, 1000);

 return () => clearInterval(interval);
 }, []);

 // Format ring duration
 const formatRingTime = (seconds: number): string => {
 const mins = Math.floor(seconds / 60);
 const secs = seconds % 60;
 return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
 };

 const handleAnswer = () => {
 void answerCall();
 };

 const handleDecline = () => {
 void hangupCall();
 };

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center">
 {/* Backdrop with blur */}
 <div className="absolute inset-0 bg-black/60 " />

 {/* Modal */}
 <div
 className={cn(
 'relative z-10 w-full max-w-md mx-4',
 'bg-muted',
 'rounded-3xl border border-white/10 shadow-sm ',
 'overflow-hidden animate-in fade-in-0 zoom-in-95 duration-300'
 )}
 >
 {/* Animated Ring Effect */}
 <div className="absolute inset-0 overflow-hidden pointer-events-none">
 <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full bg-cyan-500/20 animate-ping" />
 <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full bg-cyan-500/10 animate-pulse" />
 </div>

 {/* Header */}
 <div className="relative pt-8 pb-4 text-center">
 <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-cyan-500/10 rounded-full border border-cyan-500/20 mb-4">
 <Phone className="w-4 h-4 text-cyan-400 animate-bounce" />
 <span className="text-cyan-400 text-sm font-medium">Incoming Call</span>
 </div>

 <p className="text-gray-500 text-xs">Ringing for {formatRingTime(ringDuration)}</p>
 </div>

 {/* Caller Info */}
 <div className="relative px-6 pb-6 text-center">
 {/* Avatar */}
 <div
 className={cn(
 'w-24 h-24 mx-auto mb-4 rounded-full',
 'bg-primary',
 'border-2 border-cyan-500/30',
 'flex items-center justify-center',
 'shadow-lg '
 )}
 >
 <User className="w-12 h-12 text-cyan-400" />
 </div>

 {/* Name & Number */}
 <h2 className="text-white text-2xl font-bold mb-1">
 {call.callerName || 'Unknown Caller'}
 </h2>
 <p className="text-gray-400 text-lg font-mono">{call.phoneNumber}</p>

 {/* Queue/Campaign Info */}
 {call.queueName && (
 <div className="mt-3 flex items-center justify-center gap-2">
 <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-500/10 rounded-full text-purple-400 text-xs">
 <Tag className="w-3 h-3" />
 {call.queueName}
 </span>
 </div>
 )}
 </div>

 {/* Screen Pop - Prospect Data */}
 {call.prospectData && Object.keys(call.prospectData).length > 0 && (
 <div className="px-6 pb-6">
 <ScreenPop data={call.prospectData} variant="modal" />
 </div>
 )}

 {/* Action Buttons */}
 <div className="px-6 pb-8">
 <div className="flex items-center justify-center gap-6">
 {/* Decline */}
 <button
 onClick={handleDecline}
 className={cn(
 'group relative flex flex-col items-center gap-2',
 'transition-transform hover:scale-105 active:scale-95'
 )}
 >
 <div
 className={cn(
 'w-16 h-16 rounded-full',
 'bg-destructive',
 'flex items-center justify-center',
 'shadow-lg ',
 'group-hover:shadow-sm group-hover:',
 'transition-all duration-200'
 )}
 >
 <PhoneOff className="w-7 h-7 text-white" />
 </div>
 <span className="text-gray-400 text-sm">Decline</span>
 </button>

 {/* Answer */}
 <button
 onClick={handleAnswer}
 className={cn(
 'group relative flex flex-col items-center gap-2',
 'transition-transform hover:scale-105 active:scale-95'
 )}
 >
 <div
 className={cn(
 'w-20 h-20 rounded-full',
 'bg-primary',
 'flex items-center justify-center',
 'shadow-lg ',
 'group-hover:shadow-sm group-hover:',
 'transition-all duration-200',
 'animate-pulse'
 )}
 >
 <Phone className="w-9 h-9 text-white" />
 </div>
 <span className="text-gray-400 text-sm">Answer</span>
 </button>
 </div>
 </div>

 {/* Keyboard Hint */}
 <div className="px-6 pb-6 text-center">
 <p className="text-gray-600 text-xs">
 Press <kbd className="px-1.5 py-0.5 bg-white/5 rounded text-gray-400">A</kbd> to answer
 or <kbd className="px-1.5 py-0.5 bg-white/5 rounded text-gray-400">D</kbd> to decline
 </p>
 </div>
 </div>
 </div>
 );
}

export default IncomingCallModal;


