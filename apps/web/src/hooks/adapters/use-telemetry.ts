'use client';

/**
 * Project Cortex | Read-Only Adapter Hook
 *
 * SAFETY: This hook ONLY READS from WebSocket streams.
 * It does NOT modify any message formats (Iron Dome compliant).
 */

import { useState, useCallback, useMemo } from 'react';

import { useWebSocket, type WebSocketMessage } from '@/components/hooks/use-websocket';

export interface TelemetryData {
  // Real-time metrics
  activeCalls: number;
  callsInQueue: number;
  averageWaitTime: number;

  // Performance
  callsToday: number;
  successRate: number;

  // Agents
  agentsOnline: number;
  agentsAvailable: number;

  // Connection state
  isConnected: boolean;
  lastUpdate: Date | null;
}

interface LiveStatsPayload {
  activeCalls?: number;
  callsInQueue?: number;
  avgWaitTime?: number;
  callsToday?: number;
  successRate?: number;
  agentsOnline?: number;
  agentsAvailable?: number;
}

/**
 * useTelemetry - Read-only adapter for live stats WebSocket stream.
 *
 * Transforms raw WebSocket payloads into Command Grid-ready data.
 * Uses active lexicon (Vectoring, Telemetry, etc.)
 */
export function useTelemetry(wsUrl?: string): TelemetryData {
  const [telemetry, setTelemetry] = useState<Omit<TelemetryData, 'isConnected' | 'lastUpdate'>>({
    activeCalls: 0,
    callsInQueue: 0,
    averageWaitTime: 0,
    callsToday: 0,
    successRate: 0,
    agentsOnline: 0,
    agentsAvailable: 0,
  });
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const handleMessage = useCallback((message: WebSocketMessage) => {
    if (message.type === 'live_stats' || message.type === 'stats_update') {
      const payload = message.payload as LiveStatsPayload;
      setTelemetry(prev => ({
        activeCalls: payload.activeCalls ?? prev.activeCalls,
        callsInQueue: payload.callsInQueue ?? prev.callsInQueue,
        averageWaitTime: payload.avgWaitTime ?? prev.averageWaitTime,
        callsToday: payload.callsToday ?? prev.callsToday,
        successRate: payload.successRate ?? prev.successRate,
        agentsOnline: payload.agentsOnline ?? prev.agentsOnline,
        agentsAvailable: payload.agentsAvailable ?? prev.agentsAvailable,
      }));
      setLastUpdate(new Date());
    }
  }, []);

  const defaultUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/stats`
      : '';

  const { isConnected } = useWebSocket(wsUrl || defaultUrl, {
    onMessage: handleMessage,
    autoReconnect: true,
    reconnectInterval: 3000,
  });

  return useMemo(
    () => ({
      ...telemetry,
      isConnected,
      lastUpdate,
    }),
    [telemetry, isConnected, lastUpdate]
  );
}

/**
 * useLiveCallCount - Simplified hook for active call count only.
 */
export function useLiveCallCount(wsUrl?: string): { count: number; isLive: boolean } {
  const { activeCalls, isConnected } = useTelemetry(wsUrl);

  return useMemo(
    () => ({
      count: activeCalls,
      isLive: isConnected,
    }),
    [activeCalls, isConnected]
  );
}
