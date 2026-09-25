'use client';

import type { ReactNode } from 'react';

import { usePhone, type CallInfo } from './phone-provider';
import { formatLocation, knownCallerName } from './softphone/format';
import { useElapsedSeconds } from './softphone/hooks';
import { IncomingCallView } from './softphone/incoming-call-view';

// ============================================================================
// Incoming Call
// ============================================================================

/*
 * Kept under its old name for the barrel export, but no longer a full-screen
 * overlay: the ringing call is the open softphone's body, where the answer
 * button stays put whether or not the agent was mid-form. The provider opens
 * the panel when a call arrives, so it is on screen either way.
 */
interface IncomingCallModalProps {
  call: CallInfo;
  /** From the panel's own prospect lookup, which may beat the provider's. */
  prospectName?: string | null;
  city?: string | null;
  state?: string | null;
  /** Prospect details, under the caller. */
  children?: ReactNode;
}

export function IncomingCallModal({
  call,
  prospectName,
  city,
  state,
  children,
}: IncomingCallModalProps): JSX.Element {
  const { answerCall, hangupCall } = usePhone();
  const ringSeconds = useElapsedSeconds(call.startTime ?? null);

  const name =
    knownCallerName(call.callerName) ??
    knownCallerName(prospectName) ??
    knownCallerName(call.prospectData?.fullName) ??
    null;
  const location = formatLocation(
    city ?? call.prospectData?.city,
    state ?? call.prospectData?.state
  );

  return (
    <IncomingCallView
      callerName={name}
      phoneNumber={call.phoneNumber}
      source={call.queueName ?? call.prospectData?.campaignName ?? null}
      location={location}
      ringSeconds={ringSeconds}
      onAnswer={() => void answerCall()}
      onDecline={() => void hangupCall()}
    >
      {children}
    </IncomingCallView>
  );
}

export default IncomingCallModal;
