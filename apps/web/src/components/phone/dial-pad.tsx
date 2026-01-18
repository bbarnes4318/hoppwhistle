'use client';

import { Delete, Phone } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { usePhone } from './phone-provider';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ============================================================================
// Dial Pad Component
// ============================================================================

// Keypad buttons - standard phone layout with digits and letters
const keypadButtons = [
  { digit: '1', letters: '' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*', letters: '' },
  { digit: '0', letters: '+' },
  { digit: '#', letters: '' },
];

// DTMF tone frequencies
const dtmfFrequencies: Record<string, [number, number]> = {
  '1': [697, 1209],
  '2': [697, 1336],
  '3': [697, 1477],
  '4': [770, 1209],
  '5': [770, 1336],
  '6': [770, 1477],
  '7': [852, 1209],
  '8': [852, 1336],
  '9': [852, 1477],
  '*': [941, 1209],
  '0': [941, 1336],
  '#': [941, 1477],
};

export function DialPad(): JSX.Element {
  const { makeCall, sendDTMF, currentCall, isConnecting } = usePhone();
  const [phoneNumber, setPhoneNumber] = useState('');
  const audioContextRef = useRef<AudioContext | null>(null);

  // Format phone number for display
  const formatPhoneNumber = (number: string): string => {
    const digits = number.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  // Play DTMF tone
  const playDTMFTone = useCallback((digit: string) => {
    try {
      if (!audioContextRef.current) {
        const AudioContextClass =
          window.AudioContext ||
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass) {
          audioContextRef.current = new AudioContextClass();
        }
      }

      const context = audioContextRef.current;
      if (!context) return;

      const frequencies = dtmfFrequencies[digit];
      if (!frequencies) return;

      const duration = 0.15;

      // Create oscillators for both frequencies
      const osc1 = context.createOscillator();
      const osc2 = context.createOscillator();
      const gainNode = context.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.value = frequencies[0];
      osc2.frequency.value = frequencies[1];

      gainNode.gain.value = 0.1;

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(context.destination);

      osc1.start();
      osc2.start();

      setTimeout(() => {
        osc1.stop();
        osc2.stop();
      }, duration * 1000);
    } catch {
      // Ignore audio errors
    }
  }, []);

  // Handle digit press
  const handleDigitPress = useCallback(
    (digit: string) => {
      if (currentCall && currentCall.state !== 'ended') {
        // Send DTMF during active call
        sendDTMF(digit);
      } else {
        // Add to phone number
        setPhoneNumber(prev => prev + digit);
      }
      playDTMFTone(digit);
    },
    [currentCall, sendDTMF, playDTMFTone]
  );

  // Handle backspace
  const handleBackspace = useCallback(() => {
    setPhoneNumber(prev => prev.slice(0, -1));
  }, []);

  // Handle call
  const handleCall = useCallback(() => {
    if (!phoneNumber || isConnecting) return;
    void makeCall(phoneNumber);
    setPhoneNumber('');
  }, [phoneNumber, isConnecting, makeCall]);

  // Handle key events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (/^[0-9*#]$/.test(e.key)) {
        handleDigitPress(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Enter' && phoneNumber) {
        handleCall();
      }
    },
    [handleDigitPress, handleBackspace, handleCall, phoneNumber]
  );

  return (
    <div className="space-y-4" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Display */}
      <div
        className={cn(
          'h-16 px-4 rounded-xl flex items-center justify-between',
          'bg-white/5 border border-white/10'
        )}
      >
        <input
          type="text"
          value={phoneNumber}
          onChange={e => setPhoneNumber(e.target.value.replace(/[^0-9+*#()-\s]/g, ''))}
          placeholder="Enter number..."
          className={cn(
            'flex-1 bg-transparent text-2xl font-mono text-white',
            'placeholder:text-gray-600 outline-none'
          )}
        />
        {phoneNumber && (
          <button
            onClick={handleBackspace}
            className="p-2 text-gray-400 hover:text-white transition-colors"
          >
            <Delete className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Formatted Display */}
      {phoneNumber && (
        <p className="text-center text-gray-400 text-sm">{formatPhoneNumber(phoneNumber)}</p>
      )}

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-2">
        {keypadButtons.map(({ digit, letters }) => (
          <button
            key={digit}
            onClick={() => handleDigitPress(digit)}
            className={cn(
              'h-16 rounded-xl flex flex-col items-center justify-center',
              'bg-white/5 hover:bg-white/10 active:bg-cyan-500/20',
              'border border-transparent hover:border-white/10',
              'transition-all duration-150 ease-out',
              'active:scale-95'
            )}
          >
            <span className="text-2xl text-white font-medium">{digit}</span>
            {letters && (
              <span className="text-[10px] text-gray-500 tracking-widest -mt-0.5">{letters}</span>
            )}
          </button>
        ))}
      </div>

      {/* Call Button */}
      <Button
        onClick={handleCall}
        disabled={!phoneNumber || isConnecting}
        className={cn(
          'w-full h-14 rounded-xl text-lg font-medium',
          'bg-gradient-to-r from-cyan-600 to-blue-600',
          'hover:from-cyan-500 hover:to-blue-500',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'shadow-lg shadow-cyan-500/25 hover:shadow-xl hover:shadow-cyan-500/30',
          'transition-all duration-200'
        )}
      >
        <Phone className="w-5 h-5 mr-2" />
        {isConnecting ? 'Connecting...' : 'Call'}
      </Button>
    </div>
  );
}

export default DialPad;
