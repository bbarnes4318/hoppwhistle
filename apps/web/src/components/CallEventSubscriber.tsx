'use client';

import { useEffect, useState, useRef } from 'react';

import { isBackendAvailable } from '@/lib/backend-check';

interface CallEvent {
  type: string;
  channel?: string;
  payload?: {
    event: string;
    tenantId: string;
    data: {
      callId: string;
      callState?: {
        id: string;
        status: string;
        participants: Array<{
          id: string;
          number: string;
          role: string;
          status: string;
        }>;
        current_node?: string;
        timers: Array<unknown>;
      };
    };
    timestamp: string;
    id: string;
  };
  tenantId?: string;
  timestamp?: string;
}

interface CallEventSubscriberProps {
  apiKey?: string;
  wsUrl?: string;
}

export function CallEventSubscriber({
  apiKey = 'demo-key',
  wsUrl = 'ws://localhost:3001',
}: CallEventSubscriberProps) {
  const [events, setEvents] = useState<CallEvent[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected' | 'error'
  >('disconnected');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const connect = async () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        return;
      }

      // Check if WebSockets are disabled
      if (process.env.NEXT_PUBLIC_DISABLE_WEBSOCKET === 'true') {
        setConnectionStatus('disconnected');
        setError('WebSocket connections are disabled');
        return;
      }

      // Check backend availability before attempting connection
      const apiUrl = wsUrl.replace('ws://', 'http://').replace('wss://', 'https://');
      const backendAvailable = await isBackendAvailable(apiUrl);

      if (!backendAvailable) {
        // Backend not available, don't attempt WebSocket connection to prevent browser errors
        setConnectionStatus('disconnected');
        setError('Backend API is not available');
        return;
      }

      setConnectionStatus('connecting');
      setError(null);

      try {
        const url = `${wsUrl}/ws/events?apiKey=${encodeURIComponent(apiKey)}`;
        const ws = new WebSocket(url);

        ws.onopen = () => {
          setConnectionStatus('connected');
          setError(null);
          console.log('WebSocket connected');

          // Subscribe to call events
          ws.send(
            JSON.stringify({
              type: 'subscribe',
              channels: ['call.*'],
            })
          );
        };

        ws.onmessage = event => {
          try {
            const data = JSON.parse(event.data) as CallEvent;

            if (data.type === 'event') {
              setEvents(prev => [data, ...prev].slice(0, 50)); // Keep last 50 events
            } else if (data.type === 'connected') {
              console.log('WebSocket authenticated:', data);
            } else if (data.type === 'subscribed') {
              console.log('Subscribed to channels:', data);
            } else if (data.type === 'pong') {
              console.log('Pong received');
            }
          } catch (err) {
            console.error('Error parsing WebSocket message:', err);
          }
        };

        ws.onerror = err => {
          // Suppress repeated connection errors when backend isn't running
          if (process.env.NODE_ENV === 'development') {
            console.warn('WebSocket connection error (backend may not be running)');
          }
          setError('WebSocket connection error');
          setConnectionStatus('error');
        };

        ws.onclose = () => {
          setConnectionStatus('disconnected');
          console.log('WebSocket disconnected');

          // Attempt to reconnect after 3 seconds
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 3000);
        };

        wsRef.current = ws;
      } catch (err) {
        // Suppress repeated connection errors when backend isn't running
        if (process.env.NODE_ENV === 'development') {
          console.warn('Error creating WebSocket (backend may not be running):', err);
        }
        setError('Failed to create WebSocket connection');
        setConnectionStatus('error');
      }
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [apiKey, wsUrl]);

  const sendPing = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'ping' }));
    }
  };

  const clearEvents = () => {
    setEvents([]);
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'bg-live';
      case 'connecting':
        return 'bg-ringing';
      case 'error':
        return 'bg-dropped';
      default:
        return 'bg-ink-3';
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Call Event Subscriber</h2>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
          <span className="text-sm font-medium capitalize">{connectionStatus}</span>
        </div>
      </div>

      {error && (
        <div className="bg-dropped-tint border border-dropped/40 text-dropped-ink px-4 py-3 rounded">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={sendPing}
          disabled={connectionStatus !== 'connected'}
          className="px-4 py-2 bg-brand text-brand-fg rounded hover:bg-brand-ink hover:text-surface disabled:bg-sunken disabled:text-ink-3 disabled:cursor-not-allowed"
        >
          Send Ping
        </button>
        <button
          onClick={clearEvents}
          className="px-4 py-2 bg-sunken text-ink rounded hover:bg-rule"
        >
          Clear Events
        </button>
      </div>

      <div className="bg-surface border border-rule rounded-card shadow-sm">
        <div className="px-4 py-2 bg-sunken border-b border-rule">
          <h3 className="font-semibold">Events ({events.length})</h3>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {events.length === 0 ? (
            <div className="p-8 text-center text-ink-3">
              No events received yet. Events will appear here when call events are published.
            </div>
          ) : (
            <div className="divide-y divide-rule">
              {events.map((event, index) => (
                <div key={index} className="p-4 hover:bg-sunken">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className="font-mono text-sm font-semibold text-money-ink">
                        {event.payload?.event || event.type}
                      </span>
                      {event.channel && (
                        <span className="ml-2 text-xs text-ink-3">({event.channel})</span>
                      )}
                    </div>
                    <span className="text-xs text-ink-3">
                      {event.payload?.timestamp &&
                        new Date(event.payload.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  {event.payload?.data?.callState && (
                    <div className="mt-2 space-y-1 text-sm">
                      <div>
                        <span className="font-medium">Call ID:</span>{' '}
                        <span className="font-mono">{event.payload.data.callId}</span>
                      </div>
                      <div>
                        <span className="font-medium">Status:</span>{' '}
                        <span className="capitalize">{event.payload.data.callState.status}</span>
                      </div>
                      {event.payload.data.callState.current_node && (
                        <div>
                          <span className="font-medium">Current Node:</span>{' '}
                          <span className="font-mono">
                            {event.payload.data.callState.current_node}
                          </span>
                        </div>
                      )}
                      {event.payload.data.callState.participants.length > 0 && (
                        <div>
                          <span className="font-medium">Participants:</span>
                          <ul className="ml-4 list-disc">
                            {event.payload.data.callState.participants.map(p => (
                              <li key={p.id}>
                                {p.number} ({p.role}) - {p.status}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  <details className="mt-2">
                    <summary className="text-xs text-ink-3 cursor-pointer hover:text-ink-2">
                      View raw data
                    </summary>
                    <pre className="mt-2 p-2 bg-sunken rounded text-xs overflow-x-auto">
                      {JSON.stringify(event, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
