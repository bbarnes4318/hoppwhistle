/**
 * useLeadInjection Hook
 *
 * Connects to the lead injection SSE stream to receive real-time lead data
 * before a call connects. This allows the agent UI to be pre-populated with
 * customer details.
 *
 * Usage:
 * ```tsx
 * const { leadData, isConnected, error } = useLeadInjection();
 *
 * useEffect(() => {
 *   if (leadData) {
 *     // Update your form/state with the received lead data
 *     setProspectData(leadData);
 *   }
 * }, [leadData]);
 * ```
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export interface LeadData {
  lead_token?: string;
  caller_id?: string;
  first_name?: string;
  last_name?: string;
  firstName?: string; // Alias
  lastName?: string; // Alias
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  zip?: string;
  dob?: string;
  date_of_birth?: string;
  age?: number;
  gender?: string;
  coverage_amount?: number;
  beneficiary?: string;
  source?: string;
  campaign_id?: string;
  custom_fields?: Record<string, unknown>;
  receivedAt?: string;
}

interface SSEMessage {
  type: 'connected' | 'lead';
  data?: LeadData;
  timestamp?: string;
}

interface UseLeadInjectionReturn {
  /** The most recently received lead data */
  leadData: LeadData | null;
  /** Whether the SSE connection is active */
  isConnected: boolean;
  /** Any error that occurred */
  error: string | null;
  /** Manually reconnect to the SSE stream */
  reconnect: () => void;
  /** Look up lead data by phone number */
  lookupLead: (phoneNumber: string) => Promise<LeadData | null>;
  /** Clear the current lead data */
  clearLead: () => void;
}

export function useLeadInjection(): UseLeadInjectionReturn {
  const [leadData, setLeadData] = useState<LeadData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  const connect = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const apiBase =
      typeof window !== 'undefined' && window.location.hostname === 'localhost'
        ? 'http://localhost:3001'
        : '';

    const url = `${apiBase}/api/v1/lead-inject/stream`;

    console.log('[LeadInjection] Connecting to SSE stream:', url);

    try {
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('[LeadInjection] SSE connection established');
        setIsConnected(true);
        setError(null);
        reconnectAttempts.current = 0;
      };

      eventSource.onmessage = event => {
        try {
          const message: SSEMessage = JSON.parse(event.data);

          if (message.type === 'connected') {
            console.log('[LeadInjection] SSE confirmed connected at:', message.timestamp);
          } else if (message.type === 'lead' && message.data) {
            console.log('[LeadInjection] Received lead data:', message.data);

            // Normalize the data (handle both snake_case and camelCase)
            const normalizedData: LeadData = {
              ...message.data,
              firstName: message.data.first_name || message.data.firstName,
              lastName: message.data.last_name || message.data.lastName,
            };

            setLeadData(normalizedData);
          }
        } catch (err) {
          console.error('[LeadInjection] Error parsing SSE message:', err);
        }
      };

      eventSource.onerror = err => {
        console.error('[LeadInjection] SSE error:', err);
        setIsConnected(false);
        setError('Connection lost');

        eventSource.close();
        eventSourceRef.current = null;

        // Attempt reconnection with exponential backoff
        if (reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          console.log(
            `[LeadInjection] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1}/${maxReconnectAttempts})`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current++;
            connect();
          }, delay);
        } else {
          setError('Max reconnection attempts reached. Please refresh the page.');
        }
      };
    } catch (err) {
      console.error('[LeadInjection] Failed to create EventSource:', err);
      setError('Failed to connect to lead stream');
    }
  }, []);

  const reconnect = useCallback(() => {
    reconnectAttempts.current = 0;
    connect();
  }, [connect]);

  const lookupLead = useCallback(async (phoneNumber: string): Promise<LeadData | null> => {
    const apiBase =
      typeof window !== 'undefined' && window.location.hostname === 'localhost'
        ? 'http://localhost:3001'
        : '';

    const normalizedPhone = phoneNumber.replace(/\D/g, '');
    const url = `${apiBase}/api/v1/lead-inject/lookup/${normalizedPhone}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.found && data.lead) {
        const lead = data.lead as LeadData;
        setLeadData(lead);
        return lead;
      }
      return null;
    } catch (err) {
      console.error('[LeadInjection] Lookup failed:', err);
      return null;
    }
  }, []);

  const clearLead = useCallback(() => {
    setLeadData(null);
  }, []);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  return {
    leadData,
    isConnected,
    error,
    reconnect,
    lookupLead,
    clearLead,
  };
}

export default useLeadInjection;
