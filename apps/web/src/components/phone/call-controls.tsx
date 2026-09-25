'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { usePhone } from './phone-provider';
import { ActiveCallView } from './softphone/active-call-view';
import { isDialing, knownCallerName } from './softphone/format';
import { useElapsedSeconds, useKeypadKeyboard, useSinceTrue } from './softphone/hooks';
import { Keypad } from './softphone/keypad';

// ============================================================================
// Call Controls — the connected / on-hold call card, fed from the provider
// ============================================================================

export interface CallControlsProps {
  /** "Tampa, FL" from the prospect match, when there is one. */
  location?: string | null;
  keypadOpen: boolean;
  onKeypadToggle: () => void;
  onTransfer: () => void;
  onAddCall: () => void;
  /** Prospect details under the controls. */
  children?: ReactNode;
}

export function CallControls({
  location,
  keypadOpen,
  onKeypadToggle,
  onTransfer,
  onAddCall,
  children,
}: CallControlsProps): JSX.Element | null {
  const { currentCall, toggleMute, toggleHold, hangupCall, hasHeldCalls, mergeCalls, sendDTMF } =
    usePhone();

  const isOnHold = currentCall?.isOnHold ?? false;
  const holdSeconds = useElapsedSeconds(useSinceTrue(isOnHold));

  // The tones sent on this call, so the agent can check an IVR choice.
  const [sent, setSent] = useState('');
  const callId = currentCall?.callId;
  useEffect(() => {
    setSent('');
  }, [callId]);

  const handleDigit = useCallback(
    (digit: string) => {
      sendDTMF(digit);
      setSent(prev => (prev + digit).slice(-24));
    },
    [sendDTMF]
  );

  const pressedKey = useKeypadKeyboard(keypadOpen && Boolean(currentCall), {
    onDigit: handleDigit,
    onBackspace: () => {},
    onEnter: () => {},
  });

  if (!currentCall) return null;

  const dialing = isDialing(currentCall);

  return (
    <ActiveCallView
      callerName={knownCallerName(currentCall.callerName)}
      phoneNumber={currentCall.phoneNumber}
      source={currentCall.queueName ?? currentCall.prospectData?.campaignName ?? null}
      location={location}
      callSeconds={currentCall.duration}
      dialing={dialing}
      isMuted={currentCall.isMuted}
      isOnHold={isOnHold}
      holdSeconds={holdSeconds}
      keypadOpen={keypadOpen}
      hasHeldCalls={hasHeldCalls}
      onMute={toggleMute}
      onHold={() => void toggleHold()}
      onKeypad={onKeypadToggle}
      onTransfer={onTransfer}
      onAddCall={onAddCall}
      onMerge={() => void mergeCalls()}
      onHangup={() => void hangupCall()}
      keypad={
        <Keypad
          mode="dtmf"
          size="compact"
          value={sent}
          onDigit={handleDigit}
          pressedKey={pressedKey}
        />
      }
    >
      {children}
    </ActiveCallView>
  );
}

export default CallControls;
