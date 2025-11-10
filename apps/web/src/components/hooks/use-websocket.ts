'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

import { isBackendAvailable } from '@/lib/backend-check';

export interface WebSocketMessage {
  type: string;
  payload?: unknown;
  [key: string]: unknown;
}

export function useWebSocket(url: string, options: {
  onMessage?: (message: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  enabled?: boolean; // New option to enable/disable WebSocket
} = {}) {
  const {
    onMessage,
    onConnect,
    onDisconnect,
    autoReconnect = true,
    reconnectInterval = 3000,
    enabled = true,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const urlRef = useRef(url);
  const shouldConnectRef = useRef(true);
  const checkingRef = useRef(false);

  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  const connect = useCallback(async () => {
    // Don't connect if disabled or already connected
    if (!enabled || !shouldConnectRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Prevent multiple simultaneous checks
    if (checkingRef.current) {
      return;
    }

    checkingRef.current = true;

    try {
      // Check backend availability before attempting connection
      const baseUrl = urlRef.current.split('/ws/')[0].replace('ws://', 'http://').replace('wss://', 'https://');
      const backendAvailable = await isBackendAvailable(baseUrl);
      
      if (!backendAvailable) {
        // Backend is not available, don't attempt connection to prevent browser errors
        shouldConnectRef.current = false;
        checkingRef.current = false;
        return;
      }

      shouldConnectRef.current = true;

      // Double-check we're not already connected
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        checkingRef.current = false;
        return;
      }

      const ws = new WebSocket(urlRef.current);

      ws.onopen = () => {
        setIsConnected(true);
        onConnect?.();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          setLastMessage(message);
          onMessage?.(message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = () => {
        // Silently handle errors - browser will log them but we don't need to add more noise
      };

      ws.onclose = () => {
        setIsConnected(false);
        onDisconnect?.();

        if (autoReconnect && enabled && shouldConnectRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };

      wsRef.current = ws;
      checkingRef.current = false;
    } catch {
      // Silently handle connection errors - browser will log them
      checkingRef.current = false;
    }
  }, [onMessage, onConnect, onDisconnect, autoReconnect, reconnectInterval, enabled]);

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [connect, disconnect, enabled]);

  return {
    isConnected,
    lastMessage,
    sendMessage,
    connect,
    disconnect,
  };
}

