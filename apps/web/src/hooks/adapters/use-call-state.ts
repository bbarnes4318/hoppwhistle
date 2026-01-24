'use client';

/**
 * Project Cortex | Read-Only Adapter Hook
 *
 * SAFETY: This hook ONLY READS from the PhoneProvider context.
 * It does NOT modify any SIP/telephony logic (Iron Dome compliant).
 */

import { useMemo } from 'react';

import { usePhone } from '@/components/phone/phone-provider';

export interface CallTelemetry {
  // Core state
  isActive: boolean;
  callId: string | null;
  direction: 'inbound' | 'outbound' | null;

  // Timing
  duration: number;
  startTime: Date | null;

  // Status
  state: 'idle' | 'ringing' | 'connected' | 'on-hold' | 'ended';
  isMuted: boolean;
  isOnHold: boolean;

  // Caller info
  phoneNumber: string | null;
  callerName: string | null;

  // Agent
  agentStatus: 'available' | 'busy' | 'away' | 'offline';
}

export interface CallHistory {
  recentCalls: Array<{
    callId: string;
    direction: 'inbound' | 'outbound';
    phoneNumber: string;
    duration: number;
    endTime?: Date;
  }>;
  totalCalls: number;
}

/**
 * useCallState - Read-only adapter for call state telemetry.
 *
 * Consumes data from PhoneProvider without touching SIP logic.
 * Transform data for UI consumption with active lexicon.
 */
export function useCallState(): CallTelemetry {
  const { currentCall, agentStatus } = usePhone();

  return useMemo(
    () => ({
      // Core state
      isActive: currentCall !== null && currentCall.state !== 'ended',
      callId: currentCall?.callId ?? null,
      direction: currentCall?.direction ?? null,

      // Timing
      duration: currentCall?.duration ?? 0,
      startTime: currentCall?.startTime ?? null,

      // Status (mapped to Iron Dome-safe types)
      state: currentCall?.state ?? 'idle',
      isMuted: currentCall?.isMuted ?? false,
      isOnHold: currentCall?.isOnHold ?? false,

      // Caller info
      phoneNumber: currentCall?.phoneNumber ?? null,
      callerName: currentCall?.callerName ?? null,

      // Agent status
      agentStatus: agentStatus as 'available' | 'busy' | 'away' | 'offline',
    }),
    [currentCall, agentStatus]
  );
}

/**
 * useCallHistory - Read-only adapter for call history.
 *
 * Returns the last 10 calls for display in the Command Grid.
 */
export function useCallHistory(): CallHistory {
  const { callHistory } = usePhone();

  return useMemo(
    () => ({
      recentCalls: callHistory.slice(0, 10).map(call => ({
        callId: call.callId,
        direction: call.direction,
        phoneNumber: call.phoneNumber,
        duration: call.duration,
        endTime: call.endTime,
      })),
      totalCalls: callHistory.length,
    }),
    [callHistory]
  );
}

/**
 * useAgentStatus - Read-only adapter for agent availability.
 */
export function useAgentStatus() {
  const { agentStatus, isConnecting } = usePhone();

  return useMemo(
    () => ({
      status: agentStatus,
      isConnecting,
      isOnline: agentStatus !== 'offline',
      isAvailable: agentStatus === 'available',
      isBusy: agentStatus === 'busy',
    }),
    [agentStatus, isConnecting]
  );
}
