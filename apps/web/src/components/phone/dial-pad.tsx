'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { usePhone } from './phone-provider';
import { useKeypadKeyboard } from './softphone/hooks';
import { Keypad } from './softphone/keypad';

// ============================================================================
// Dial Pad Component
// ============================================================================

// DTMF tone frequencies, for the local key-press tone before a call.
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

export interface DialPadProps {
  compact?: boolean;
  /**
   * Take digits, Backspace and Enter from the physical keyboard while this
   * pad is on screen. Off by default: the call-centre portal renders this pad
   * beside its own fields and has its own key handling.
   */
  captureKeyboard?: boolean;
  /** Above the number field — the softphone puts the caller ID picker here. */
  header?: ReactNode;
}

export function DialPad({
  compact = false,
  captureKeyboard = false,
  header,
}: DialPadProps): JSX.Element {
  const { makeCall, sendDTMF, currentCall, isConnecting, dialerNumber, setDialerNumber } =
    usePhone();
  const [phoneNumber, setPhoneNumber] = useState('');
  const audioContextRef = useRef<AudioContext | null>(null);

  // Sync with dialerNumber from context (for intake form pre-fill)
  useEffect(() => {
    if (dialerNumber && dialerNumber !== phoneNumber) {
      setPhoneNumber(dialerNumber);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialerNumber]);

  const updatePhoneNumber = useCallback(
    (value: string) => {
      setPhoneNumber(value);
      setDialerNumber(value);
    },
    [setDialerNumber]
  );

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

  const handleDigitPress = useCallback(
    (digit: string) => {
      if (currentCall && currentCall.state !== 'ended') {
        // Send DTMF during active call
        sendDTMF(digit);
      } else {
        updatePhoneNumber(phoneNumber + digit);
        playDTMFTone(digit);
      }
    },
    [currentCall, sendDTMF, playDTMFTone, phoneNumber, updatePhoneNumber]
  );

  const handleBackspace = useCallback(() => {
    updatePhoneNumber(phoneNumber.slice(0, -1));
  }, [phoneNumber, updatePhoneNumber]);

  const handleCall = useCallback(() => {
    if (!phoneNumber || isConnecting) return;
    void makeCall(phoneNumber);
    updatePhoneNumber('');
  }, [phoneNumber, isConnecting, makeCall, updatePhoneNumber]);

  const pressedKey = useKeypadKeyboard(captureKeyboard, {
    onDigit: handleDigitPress,
    onBackspace: handleBackspace,
    onEnter: handleCall,
  });

  return (
    <Keypad
      mode="dial"
      size={compact ? 'compact' : 'default'}
      value={phoneNumber}
      onChange={updatePhoneNumber}
      onDigit={handleDigitPress}
      onBackspace={handleBackspace}
      onDial={handleCall}
      dialing={isConnecting}
      pressedKey={pressedKey}
      header={header}
    />
  );
}

export default DialPad;
