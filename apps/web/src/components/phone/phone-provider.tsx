'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type AgentStatus = 'available' | 'on-call' | 'away' | 'dnd' | 'offline';

export type CallDirection = 'inbound' | 'outbound';

export type CallState = 'idle' | 'ringing' | 'connecting' | 'active' | 'hold' | 'ended';

export interface ScreenPopField {
  id: string;
  label: string;
  key: string;
  enabled: boolean;
  order: number;
}

export interface ProspectData {
  id?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  phoneNumber?: string;
  email?: string;
  company?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  leadSource?: string;
  campaignName?: string;
  customFields?: Record<string, string | number | boolean>;
  notes?: string;
  [key: string]: unknown;
}

export interface CallInfo {
  callId: string;
  direction: CallDirection;
  state: CallState;
  phoneNumber: string;
  callerName?: string;
  startTime?: Date;
  answerTime?: Date;
  endTime?: Date;
  duration: number;
  isMuted: boolean;
  isOnHold: boolean;
  recordingEnabled: boolean;
  prospectData?: ProspectData;
  queueName?: string;
  campaignId?: string;
}

export interface PhoneContextType {
  // State
  agentStatus: AgentStatus;
  currentCall: CallInfo | null;
  callHistory: CallInfo[];
  isPhonePanelOpen: boolean;
  isConnecting: boolean;
  audioDevices: MediaDeviceInfo[];
  selectedAudioInput: string | null;
  selectedAudioOutput: string | null;
  screenPopFields: ScreenPopField[];
  error: string | null;

  // Actions
  setAgentStatus: (status: AgentStatus) => void;
  openPhonePanel: () => void;
  closePhonePanel: () => void;
  togglePhonePanel: () => void;
  makeCall: (phoneNumber: string) => Promise<void>;
  answerCall: () => Promise<void>;
  hangupCall: () => Promise<void>;
  toggleMute: () => void;
  toggleHold: () => Promise<void>;
  sendDTMF: (digit: string) => void;
  transferCall: (destination: string, type: 'blind' | 'warm') => Promise<void>;
  setAudioInput: (deviceId: string) => void;
  setAudioOutput: (deviceId: string) => void;
  updateScreenPopFields: (fields: ScreenPopField[]) => void;
  clearError: () => void;
}

// ============================================================================
// Default Screen Pop Fields
// ============================================================================

const defaultScreenPopFields: ScreenPopField[] = [
  { id: 'fullName', label: 'Full Name', key: 'fullName', enabled: true, order: 1 },
  { id: 'phoneNumber', label: 'Phone Number', key: 'phoneNumber', enabled: true, order: 2 },
  { id: 'email', label: 'Email', key: 'email', enabled: true, order: 3 },
  { id: 'company', label: 'Company', key: 'company', enabled: true, order: 4 },
  { id: 'address', label: 'Address', key: 'address', enabled: false, order: 5 },
  { id: 'city', label: 'City', key: 'city', enabled: false, order: 6 },
  { id: 'state', label: 'State', key: 'state', enabled: false, order: 7 },
  { id: 'zipCode', label: 'Zip Code', key: 'zipCode', enabled: false, order: 8 },
  { id: 'leadSource', label: 'Lead Source', key: 'leadSource', enabled: true, order: 9 },
  { id: 'campaignName', label: 'Campaign', key: 'campaignName', enabled: true, order: 10 },
  { id: 'notes', label: 'Notes', key: 'notes', enabled: false, order: 11 },
];

// ============================================================================
// Context
// ============================================================================

const PhoneContext = createContext<PhoneContextType | null>(null);

export function usePhone(): PhoneContextType {
  const context = useContext(PhoneContext);
  if (!context) {
    throw new Error('usePhone must be used within a PhoneProvider');
  }
  return context;
}

// ============================================================================
// WebSocket Event Types
// ============================================================================

interface WebSocketEvent {
  type: string;
  channel?: string;
  payload?: {
    callId?: string;
    callerNumber?: string;
    from?: string;
    callerName?: string;
    prospectData?: ProspectData;
    screenPopData?: ProspectData;
    queueName?: string;
    campaignId?: string;
    isOnHold?: boolean;
    [key: string]: unknown;
  };
}

interface ApiResponse {
  callId?: string;
  error?: {
    message?: string;
  };
}

// ============================================================================
// Provider Component
// ============================================================================

interface PhoneProviderProps {
  children: ReactNode;
  wsUrl?: string;
  apiUrl?: string;
}

export function PhoneProvider({
  children,
  wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001',
  apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
}: PhoneProviderProps): JSX.Element {
  // Normalize apiUrl to just be the base (remove trailing /api/v1 if present)
  const normalizedApiUrl = apiUrl.replace(/\/api\/v1\/?$/, '');

  // API key for authenticated requests
  const apiKey = process.env.NEXT_PUBLIC_API_KEY || '';

  // Common headers for API requests
  const getApiHeaders = useCallback(
    (contentType = true): HeadersInit => {
      const headers: HeadersInit = {};
      if (contentType) {
        headers['Content-Type'] = 'application/json';
      }
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }
      return headers;
    },
    [apiKey]
  );

  // State
  const [agentStatus, setAgentStatusState] = useState<AgentStatus>('offline');
  const [currentCall, setCurrentCall] = useState<CallInfo | null>(null);
  const [callHistory, setCallHistory] = useState<CallInfo[]>([]);
  const [isPhonePanelOpen, setIsPhonePanelOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState<string | null>(null);
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<string | null>(null);
  const [screenPopFields, setScreenPopFields] = useState<ScreenPopField[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('screenPopFields');
      if (saved) {
        try {
          return JSON.parse(saved) as ScreenPopField[];
        } catch {
          return defaultScreenPopFields;
        }
      }
    }
    return defaultScreenPopFields;
  });
  const [error, setError] = useState<string | null>(null);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const callDurationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);

  // ============================================================================
  // Audio Utilities
  // ============================================================================

  const playRingtone = useCallback(() => {
    if (typeof window !== 'undefined' && !ringtoneRef.current) {
      ringtoneRef.current = new Audio('/sounds/ringtone.mp3');
      ringtoneRef.current.loop = true;
    }
    ringtoneRef.current?.play().catch(() => {
      // Ignore audio play errors
    });
  }, []);

  const stopRingtone = useCallback(() => {
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
    }
  }, []);

  // ============================================================================
  // Call Duration Timer
  // ============================================================================

  const startCallDurationTimer = useCallback(() => {
    if (callDurationIntervalRef.current) {
      clearInterval(callDurationIntervalRef.current);
    }

    callDurationIntervalRef.current = setInterval(() => {
      setCurrentCall(prev => {
        if (!prev || !prev.answerTime) return prev;
        return {
          ...prev,
          duration: Math.floor((Date.now() - prev.answerTime.getTime()) / 1000),
        };
      });
    }, 1000);
  }, []);

  const stopCallDurationTimer = useCallback(() => {
    if (callDurationIntervalRef.current) {
      clearInterval(callDurationIntervalRef.current);
      callDurationIntervalRef.current = null;
    }
  }, []);

  // ============================================================================
  // WebSocket Event Handlers
  // ============================================================================

  const handleIncomingCall = useCallback(
    (payload: WebSocketEvent['payload']) => {
      if (!payload) return;

      const callInfo: CallInfo = {
        callId: payload.callId ?? `call_${Date.now()}`,
        direction: 'inbound',
        state: 'ringing',
        phoneNumber: payload.callerNumber ?? payload.from ?? '',
        callerName: payload.callerName,
        startTime: new Date(),
        duration: 0,
        isMuted: false,
        isOnHold: false,
        recordingEnabled: true,
        prospectData: payload.prospectData ?? payload.screenPopData,
        queueName: payload.queueName,
        campaignId: payload.campaignId,
      };

      setCurrentCall(callInfo);
      setIsPhonePanelOpen(true);
      playRingtone();
    },
    [playRingtone]
  );

  const handleCallAnswered = useCallback(() => {
    setCurrentCall(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        state: 'active',
        answerTime: new Date(),
      };
    });
    setAgentStatusState('on-call');
    stopRingtone();
    startCallDurationTimer();
  }, [stopRingtone, startCallDurationTimer]);

  const handleCallEnded = useCallback(() => {
    setCurrentCall(prev => {
      if (prev) {
        const completedCall: CallInfo = {
          ...prev,
          state: 'ended',
          endTime: new Date(),
        };
        setCallHistory(history => [completedCall, ...history].slice(0, 50));
      }
      return null;
    });
    setAgentStatusState('available');
    stopRingtone();
    stopCallDurationTimer();
  }, [stopRingtone, stopCallDurationTimer]);

  const handleCallHold = useCallback((payload: WebSocketEvent['payload']) => {
    if (!payload) return;
    setCurrentCall(prev => {
      if (!prev) return prev;
      const isOnHold = payload.isOnHold ?? !prev.isOnHold;
      return {
        ...prev,
        isOnHold,
        state: isOnHold ? 'hold' : 'active',
      };
    });
  }, []);

  const handleWebSocketMessage = useCallback(
    (data: WebSocketEvent) => {
      const { type, channel, payload } = data;

      if (type === 'event') {
        switch (channel) {
          case 'agent.call.incoming':
            handleIncomingCall(payload);
            break;
          case 'agent.call.answered':
            handleCallAnswered();
            break;
          case 'agent.call.ended':
            handleCallEnded();
            break;
          case 'agent.call.hold':
            handleCallHold(payload);
            break;
        }
      }
    },
    [handleIncomingCall, handleCallAnswered, handleCallEnded, handleCallHold]
  );

  // ============================================================================
  // WebSocket Connection
  // ============================================================================

  useEffect(() => {
    // Skip WebSocket in SSR or if not in browser
    if (typeof window === 'undefined') return;

    const apiKey = process.env.NEXT_PUBLIC_API_KEY || 'demo-key';

    const connectWebSocket = () => {
      try {
        const ws = new WebSocket(`${wsUrl}/ws/events?apiKey=${apiKey}`);

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              type: 'subscribe',
              channels: ['agent.call.*', 'agent.status.*'],
            })
          );
        };

        ws.onmessage = (event: MessageEvent<string>) => {
          try {
            const data = JSON.parse(event.data) as WebSocketEvent;
            handleWebSocketMessage(data);
          } catch {
            // Ignore parse errors
          }
        };

        ws.onclose = () => {
          setTimeout(connectWebSocket, 3000);
        };

        wsRef.current = ws;
      } catch {
        setTimeout(connectWebSocket, 3000);
      }
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [wsUrl, handleWebSocketMessage]);

  // ============================================================================
  // Audio Device Management
  // ============================================================================

  useEffect(() => {
    // Skip if not in browser or mediaDevices not available (requires HTTPS)
    if (typeof window === 'undefined' || !navigator.mediaDevices) {
      return;
    }

    const loadAudioDevices = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevs = devices.filter(d => d.kind === 'audioinput' || d.kind === 'audiooutput');
        setAudioDevices(audioDevs);

        const defaultInput = audioDevs.find(d => d.kind === 'audioinput');
        const defaultOutput = audioDevs.find(d => d.kind === 'audiooutput');
        if (defaultInput && !selectedAudioInput) {
          setSelectedAudioInput(defaultInput.deviceId);
        }
        if (defaultOutput && !selectedAudioOutput) {
          setSelectedAudioOutput(defaultOutput.deviceId);
        }
      } catch {
        // Silently fail - microphone access is optional until making a call
      }
    };

    void loadAudioDevices();

    const handleDeviceChange = () => {
      void loadAudioDevices();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [selectedAudioInput, selectedAudioOutput]);

  // ============================================================================
  // Screen Pop Fields Persistence
  // ============================================================================

  const updateScreenPopFields = useCallback((fields: ScreenPopField[]) => {
    setScreenPopFields(fields);
    if (typeof window !== 'undefined') {
      localStorage.setItem('screenPopFields', JSON.stringify(fields));
    }
  }, []);

  // ============================================================================
  // Phone Actions
  // ============================================================================

  const setAgentStatus = useCallback(
    (status: AgentStatus) => {
      void fetch(`${normalizedApiUrl}/api/v1/agent/status`, {
        method: 'PUT',
        headers: getApiHeaders(),
        body: JSON.stringify({ status }),
      }).catch(() => {
        // Ignore errors, update locally anyway
      });
      setAgentStatusState(status);
    },
    [normalizedApiUrl, getApiHeaders]
  );

  const openPhonePanel = useCallback(() => setIsPhonePanelOpen(true), []);
  const closePhonePanel = useCallback(() => setIsPhonePanelOpen(false), []);
  const togglePhonePanel = useCallback(() => setIsPhonePanelOpen(prev => !prev), []);

  const makeCall = useCallback(
    async (phoneNumber: string) => {
      setIsConnecting(true);
      setError(null);

      try {
        const response = await fetch(`${normalizedApiUrl}/api/v1/agent/call/originate`, {
          method: 'POST',
          headers: getApiHeaders(),
          body: JSON.stringify({ phoneNumber }),
        });

        const data = (await response.json()) as ApiResponse;

        if (!response.ok) {
          throw new Error(data.error?.message ?? 'Failed to place call');
        }

        const callInfo: CallInfo = {
          callId: data.callId ?? `call_${Date.now()}`,
          direction: 'outbound',
          state: 'connecting',
          phoneNumber,
          startTime: new Date(),
          duration: 0,
          isMuted: false,
          isOnHold: false,
          recordingEnabled: true,
        };

        setCurrentCall(callInfo);
        setAgentStatusState('on-call');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to place call';
        setError(message);
      } finally {
        setIsConnecting(false);
      }
    },
    [normalizedApiUrl, getApiHeaders]
  );

  const answerCall = useCallback(async () => {
    if (!currentCall) return;

    try {
      await fetch(`${normalizedApiUrl}/api/v1/agent/call/${currentCall.callId}/answer`, {
        method: 'POST',
        headers: getApiHeaders(false),
      });

      setCurrentCall(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          state: 'active',
          answerTime: new Date(),
        };
      });

      setAgentStatusState('on-call');
      stopRingtone();
      startCallDurationTimer();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to answer call';
      setError(message);
    }
  }, [normalizedApiUrl, currentCall, stopRingtone, startCallDurationTimer, getApiHeaders]);

  const hangupCall = useCallback(async () => {
    if (!currentCall) return;

    try {
      await fetch(`${normalizedApiUrl}/api/v1/agent/call/${currentCall.callId}/hangup`, {
        method: 'POST',
        headers: getApiHeaders(false),
      });

      const completedCall: CallInfo = {
        ...currentCall,
        state: 'ended',
        endTime: new Date(),
      };
      setCallHistory(prev => [completedCall, ...prev].slice(0, 50));
      setCurrentCall(null);
      setAgentStatusState('available');
      stopCallDurationTimer();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to hang up';
      setError(message);
    }
  }, [normalizedApiUrl, currentCall, stopCallDurationTimer, getApiHeaders]);

  const toggleMute = useCallback(() => {
    setCurrentCall(prev => {
      if (!prev) return prev;
      return { ...prev, isMuted: !prev.isMuted };
    });
  }, []);

  const toggleHold = useCallback(async () => {
    if (!currentCall) return;

    try {
      await fetch(`${normalizedApiUrl}/api/v1/agent/call/${currentCall.callId}/hold`, {
        method: 'POST',
        headers: getApiHeaders(false),
      });

      setCurrentCall(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          isOnHold: !prev.isOnHold,
          state: !prev.isOnHold ? 'hold' : 'active',
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to toggle hold';
      setError(message);
    }
  }, [normalizedApiUrl, currentCall, getApiHeaders]);

  const sendDTMF = useCallback(
    (digit: string) => {
      if (!currentCall) return;
      // DTMF is handled client-side in WebRTC
      console.log('[Phone] Sending DTMF:', digit);
    },
    [currentCall]
  );

  const transferCall = useCallback(
    async (destination: string, type: 'blind' | 'warm') => {
      if (!currentCall) return;

      try {
        await fetch(`${normalizedApiUrl}/api/v1/agent/call/${currentCall.callId}/transfer`, {
          method: 'POST',
          headers: getApiHeaders(),
          body: JSON.stringify({ destination, type }),
        });

        if (type === 'blind') {
          setCurrentCall(null);
          setAgentStatusState('available');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to transfer call';
        setError(message);
      }
    },
    [normalizedApiUrl, currentCall, getApiHeaders]
  );

  const setAudioInput = useCallback((deviceId: string) => {
    setSelectedAudioInput(deviceId);
  }, []);

  const setAudioOutput = useCallback((deviceId: string) => {
    setSelectedAudioOutput(deviceId);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: PhoneContextType = {
    agentStatus,
    currentCall,
    callHistory,
    isPhonePanelOpen,
    isConnecting,
    audioDevices,
    selectedAudioInput,
    selectedAudioOutput,
    screenPopFields,
    error,
    setAgentStatus,
    openPhonePanel,
    closePhonePanel,
    togglePhonePanel,
    makeCall,
    answerCall,
    hangupCall,
    toggleMute,
    toggleHold,
    sendDTMF,
    transferCall,
    setAudioInput,
    setAudioOutput,
    updateScreenPopFields,
    clearError,
  };

  return <PhoneContext.Provider value={value}>{children}</PhoneContext.Provider>;
}

export default PhoneProvider;
