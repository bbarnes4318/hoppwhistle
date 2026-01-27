'use client';

import { useState } from 'react';
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Pause,
  Play,
  User,
  Clock,
  PhoneCall,
  PhoneForwarded,
} from 'lucide-react';

import { usePhone } from '@/components/phone/phone-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ============================================================================
// Dialer Controls Component
// Wires directly to hopbot's existing usePhone() hook
// ============================================================================

interface DialerControlsProps {
  phoneNumber?: string;
  onPhoneNumberChange?: (value: string) => void;
  compact?: boolean;
}

export function DialerControls({
  phoneNumber: externalPhoneNumber,
  onPhoneNumberChange,
  compact = false,
}: DialerControlsProps): JSX.Element {
  const {
    currentCall,
    agentStatus,
    makeCall,
    hangup,
    toggleMute,
    toggleHold,
    sendDTMF,
    isConnecting,
  } = usePhone();

  const [internalPhoneNumber, setInternalPhoneNumber] = useState('');
  const phoneNumber = externalPhoneNumber ?? internalPhoneNumber;

  const handlePhoneNumberChange = (value: string) => {
    if (onPhoneNumberChange) {
      onPhoneNumberChange(value);
    } else {
      setInternalPhoneNumber(value);
    }
  };

  // Format phone number for display
  const formatPhoneNumber = (num: string): string => {
    const cleaned = num.replace(/\D/g, '');
    if (cleaned.length >= 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
    }
    return num;
  };

  // Format duration as MM:SS
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle dial button click
  const handleDial = async () => {
    if (!phoneNumber.trim()) return;
    try {
      await makeCall(phoneNumber);
    } catch (error) {
      console.error('Failed to initiate call:', error);
    }
  };

  // Handle hangup
  const handleHangup = async () => {
    try {
      await hangup();
    } catch (error) {
      console.error('Failed to end call:', error);
    }
  };

  // DTMF pad for in-call tones
  const dtmfKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

  // ============================================================================
  // Active Call View
  // ============================================================================
  if (currentCall && currentCall.state !== 'ended') {
    return (
      <div className={cn('space-y-4', compact && 'space-y-2')}>
        {/* Call Info */}
        <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-white/5">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'w-10 h-10 rounded-full flex items-center justify-center',
                currentCall.direction === 'inbound'
                  ? 'bg-cyan-500/20 text-cyan-400'
                  : 'bg-blue-500/20 text-blue-400'
              )}
            >
              {currentCall.direction === 'inbound' ? (
                <PhoneCall className="w-5 h-5" />
              ) : (
                <PhoneForwarded className="w-5 h-5" />
              )}
            </div>
            <div>
              <p className="text-white font-medium">
                {currentCall.callerName || formatPhoneNumber(currentCall.phoneNumber)}
              </p>
              <p className="text-gray-400 text-sm capitalize">
                {currentCall.state === 'ringing' ? 'Ringing...' : currentCall.state}
              </p>
            </div>
          </div>

          {/* Duration */}
          {currentCall.state === 'active' && (
            <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 rounded-full">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-emerald-400 text-sm font-mono">
                {formatDuration(currentCall.duration)}
              </span>
            </div>
          )}
        </div>

        {/* Hold Indicator */}
        {currentCall.isOnHold && (
          <div className="flex items-center justify-center gap-2 py-2 bg-amber-500/10 rounded-lg">
            <Pause className="w-4 h-4 text-amber-400" />
            <span className="text-amber-400 text-sm">Call On Hold</span>
          </div>
        )}

        {/* Call Controls */}
        <div className="grid grid-cols-4 gap-2">
          {/* Mute */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleMute(!currentCall.isMuted)}
            className={cn(
              'flex flex-col items-center gap-1 h-auto py-3',
              'border-white/10 hover:bg-white/5',
              currentCall.isMuted && 'bg-red-500/10 border-red-500/30 text-red-400'
            )}
          >
            {currentCall.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            <span className="text-xs">{currentCall.isMuted ? 'Unmute' : 'Mute'}</span>
          </Button>

          {/* Hold */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleHold(!currentCall.isOnHold)}
            className={cn(
              'flex flex-col items-center gap-1 h-auto py-3',
              'border-white/10 hover:bg-white/5',
              currentCall.isOnHold && 'bg-amber-500/10 border-amber-500/30 text-amber-400'
            )}
          >
            {currentCall.isOnHold ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
            <span className="text-xs">{currentCall.isOnHold ? 'Resume' : 'Hold'}</span>
          </Button>

          {/* DTMF */}
          <Button
            variant="outline"
            size="sm"
            className="flex flex-col items-center gap-1 h-auto py-3 border-white/10 hover:bg-white/5"
          >
            <span className="text-lg font-mono">#</span>
            <span className="text-xs">Keypad</span>
          </Button>

          {/* Hangup */}
          <Button
            variant="destructive"
            size="sm"
            onClick={handleHangup}
            className="flex flex-col items-center gap-1 h-auto py-3"
          >
            <PhoneOff className="w-5 h-5" />
            <span className="text-xs">End</span>
          </Button>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Idle View - Dial Pad
  // ============================================================================
  return (
    <div className={cn('space-y-4', compact && 'space-y-2')}>
      {/* Phone Number Input */}
      <div className="relative">
        <Input
          type="tel"
          value={phoneNumber}
          onChange={e => handlePhoneNumberChange(e.target.value)}
          placeholder="Enter phone number"
          className={cn(
            'bg-slate-800/50 border-white/10 text-white text-center text-lg font-mono',
            'placeholder:text-gray-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500',
            compact ? 'h-10' : 'h-12'
          )}
        />
      </div>

      {/* Dial Pad */}
      {!compact && (
        <div className="grid grid-cols-3 gap-2">
          {dtmfKeys.map(key => (
            <Button
              key={key}
              variant="ghost"
              onClick={() => handlePhoneNumberChange(phoneNumber + key)}
              className={cn(
                'h-12 text-lg font-medium',
                'bg-slate-800/30 hover:bg-slate-700/50',
                'text-white border border-white/5'
              )}
            >
              {key}
            </Button>
          ))}
        </div>
      )}

      {/* Dial Button */}
      <Button
        onClick={handleDial}
        disabled={!phoneNumber.trim() || isConnecting || agentStatus === 'offline'}
        className={cn(
          'w-full bg-gradient-to-r from-emerald-600 to-green-600',
          'hover:from-emerald-500 hover:to-green-500',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          compact ? 'h-10' : 'h-12'
        )}
      >
        <Phone className="w-5 h-5 mr-2" />
        {isConnecting ? 'Connecting...' : 'Dial'}
      </Button>

      {/* Status Indicator */}
      {agentStatus === 'offline' && (
        <p className="text-center text-sm text-amber-400">
          Phone is offline. Check your connection.
        </p>
      )}
    </div>
  );
}

export default DialerControls;
