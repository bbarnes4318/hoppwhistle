'use client';

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
import { useState } from 'react';

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
    hangupCall,
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
      await makeCall(phoneNumber, undefined, 'CC_MANUAL');
    } catch (error) {
      console.error('Failed to initiate call:', error);
    }
  };

  // Handle hangup
  const handleHangup = async () => {
    try {
      await hangupCall();
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
        <div className="flex items-center justify-between p-3 bg-sunken rounded-lg border border-rule">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'w-10 h-10 rounded-full flex items-center justify-center',
                currentCall.direction === 'inbound'
                  ? 'bg-brand-tint text-brand-ink'
                  : 'bg-money-tint text-money-ink'
              )}
            >
              {currentCall.direction === 'inbound' ? (
                <PhoneCall className="w-5 h-5" />
              ) : (
                <PhoneForwarded className="w-5 h-5" />
              )}
            </div>
            <div>
              <p className="text-ink font-medium">
                {currentCall.callerName || formatPhoneNumber(currentCall.phoneNumber)}
              </p>
              <p className="text-ink-2 text-sm capitalize">
                {currentCall.state === 'ringing' ? 'Ringing...' : currentCall.state}
              </p>
            </div>
          </div>

          {/* Duration */}
          {currentCall.state === 'active' && (
            <div className="flex items-center gap-2 px-3 py-1 bg-live-tint rounded-full">
              <span className="w-2 h-2 bg-live rounded-full animate-pulse" />
              <span className="text-live-ink text-sm font-mono">
                {formatDuration(currentCall.duration)}
              </span>
            </div>
          )}
        </div>

        {/* Hold Indicator */}
        {currentCall.isOnHold && (
          <div className="flex items-center justify-center gap-2 py-2 bg-ringing-tint rounded-lg">
            <Pause className="w-4 h-4 text-ringing-ink" />
            <span className="text-ringing-ink text-sm">Call On Hold</span>
          </div>
        )}

        {/* Call Controls */}
        <div className="grid grid-cols-4 gap-2">
          {/* Mute */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleMute()}
            className={cn(
              'flex flex-col items-center gap-1 h-auto py-3',
              'border-rule hover:bg-sunken',
              currentCall.isMuted && 'bg-dropped-tint border-dropped text-dropped-ink'
            )}
          >
            {currentCall.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            <span className="text-xs">{currentCall.isMuted ? 'Unmute' : 'Mute'}</span>
          </Button>

          {/* Hold */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleHold()}
            className={cn(
              'flex flex-col items-center gap-1 h-auto py-3',
              'border-rule hover:bg-sunken',
              currentCall.isOnHold && 'bg-ringing-tint border-ringing text-ringing-ink'
            )}
          >
            {currentCall.isOnHold ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
            <span className="text-xs">{currentCall.isOnHold ? 'Resume' : 'Hold'}</span>
          </Button>

          {/* DTMF */}
          <Button
            variant="outline"
            size="sm"
            className="flex flex-col items-center gap-1 h-auto py-3 border-rule hover:bg-sunken"
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
            'bg-sunken border-rule text-ink text-center text-lg font-mono',
            'placeholder:text-ink-3 focus:border-brand-ink focus:ring-1 focus:ring-ring',
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
                'bg-sunken hover:bg-rule',
                'text-ink border border-rule'
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
          'w-full bg-brand text-brand-fg',
          'hover:bg-brand-ink hover:text-surface',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          compact ? 'h-10' : 'h-12'
        )}
      >
        <Phone className="w-5 h-5 mr-2" />
        {isConnecting ? 'Connecting...' : 'Dial'}
      </Button>

      {/* Status Indicator */}
      {agentStatus === 'offline' && (
        <p className="text-center text-sm text-ringing-ink">
          Phone is offline. Check your connection.
        </p>
      )}
    </div>
  );
}

export default DialerControls;
