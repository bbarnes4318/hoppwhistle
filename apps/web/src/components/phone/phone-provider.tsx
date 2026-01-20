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
import {
  UserAgent,
  Registerer,
  Inviter,
  Session,
  SessionState,
  Invitation,
  UserAgentOptions,
} from 'sip.js';

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
  isRegistered: boolean; // SIP Registration status

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
  addThirdParty: (phoneNumber: string) => Promise<void>;
  mergeCalls: () => Promise<void>;
  hasHeldCalls: boolean;
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
  const [isRegistered, setIsRegistered] = useState(false);
  const [audioDevices] = useState<MediaDeviceInfo[]>([]);
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

  const callDurationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const userAgentRef = useRef<UserAgent | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const heldSessionRef = useRef<Session | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [hasHeldCalls, setHasHeldCalls] = useState(false);

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

  // Ensure remote audio element exists
  useEffect(() => {
    if (typeof window !== 'undefined' && !remoteAudioRef.current) {
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.style.display = 'none'; // Hidden audio element
      document.body.appendChild(audio);
      remoteAudioRef.current = audio;
    }
    return () => {
      if (remoteAudioRef.current && remoteAudioRef.current.parentNode) {
        remoteAudioRef.current.parentNode.removeChild(remoteAudioRef.current);
      }
    };
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
  // SIP / WebRTC Implementation
  // ============================================================================

  const handleIncomingSipCall = useCallback(
    (invitation: Invitation) => {
      sessionRef.current = invitation;
      const remoteIdentity = invitation.remoteIdentity;
      const callerNumber = remoteIdentity.uri.user || 'Unknown';
      const callerName = remoteIdentity.displayName || 'Unknown';

      const callInfo: CallInfo = {
        callId: invitation.request.headers['Call-ID']?.[0]?.raw || `call_${Date.now()}`,
        direction: 'inbound',
        state: 'ringing',
        phoneNumber: callerNumber,
        callerName,
        startTime: new Date(),
        duration: 0,
        isMuted: false,
        isOnHold: false,
        recordingEnabled: true,
      };

      setCurrentCall(callInfo);
      setIsPhonePanelOpen(true);
      playRingtone();

      invitation.stateChange.addListener(newState => {
        console.log('[Phone] Invitation state changed:', newState);
        if (newState === SessionState.Terminated) {
          handleCallEnded();
        } else if (newState === SessionState.Established) {
          handleCallAnswered();
          setupRemoteAudio(invitation);
        }
      });
    },
    [playRingtone]
  );

  const setupRemoteAudio = (session: Session) => {
    const stream = new MediaStream();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pc = (session.sessionDescriptionHandler as any)?.peerConnection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pc?.getReceivers().forEach((receiver: any) => {
      if (receiver.track) {
        stream.addTrack(receiver.track);
      }
    });
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = stream;
      remoteAudioRef.current.play().catch(console.error);
    }
  };

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
    setIsConnecting(false); // Reset connecting state so user can make new calls
    stopRingtone();
    stopCallDurationTimer();
    sessionRef.current = null;
  }, [stopRingtone, stopCallDurationTimer]);

  // ============================================================================
  // Phone Actions
  // ============================================================================

  const setAgentStatus = useCallback(
    (status: AgentStatus) => {
      // Sync with API
      void fetch(`${normalizedApiUrl}/api/v1/agent/status`, {
        method: 'PUT',
        headers: getApiHeaders(),
        body: JSON.stringify({ status }),
      }).catch(() => {});
      setAgentStatusState(status);
    },
    [normalizedApiUrl, getApiHeaders]
  );

  const openPhonePanel = useCallback(() => setIsPhonePanelOpen(true), []);
  const closePhonePanel = useCallback(() => setIsPhonePanelOpen(false), []);
  const togglePhonePanel = useCallback(() => setIsPhonePanelOpen(prev => !prev), []);

  const makeCall = useCallback(
    async (phoneNumber: string) => {
      if (!userAgentRef.current || !isRegistered) {
        setError('Phone not connected');
        return;
      }

      console.log('[Phone] Initiating call to:', phoneNumber);
      setIsConnecting(true);
      setError(null);

      // Track call via API
      try {
        const url = `${normalizedApiUrl}/api/v1/agent/call/originate`;
        const response = await fetch(url, {
          method: 'POST',
          headers: getApiHeaders(),
          body: JSON.stringify({ phoneNumber }),
        });
        const data = (await response.json()) as ApiResponse;
        // Call ID from API for tracking
        const apiCallId = data.callId;

        // SIP INVITE
        const target = UserAgent.makeURI(
          `sip:${phoneNumber}@${process.env.NEXT_PUBLIC_IP || window.location.hostname}`
        );
        if (!target) throw new Error('Invalid target URI');

        const inviter = new Inviter(userAgentRef.current, target);
        sessionRef.current = inviter;

        const callInfo: CallInfo = {
          callId: apiCallId ?? `call_${Date.now()}`,
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
        setIsPhonePanelOpen(true);

        inviter.stateChange.addListener(newState => {
          console.log('[Phone] Session state:', newState);
          if (newState === SessionState.Established) {
            handleCallAnswered();
            setupRemoteAudio(inviter);
          } else if (newState === SessionState.Terminated) {
            handleCallEnded();
          }
        });

        inviter
          .invite()
          .then(() => {
            console.log('[Phone] INVITE sent');
          })
          .catch(e => {
            console.error('[Phone] INVITE failed', e);
            setError('Call failed');
            handleCallEnded();
          });
      } catch (err) {
        console.error('[Phone] Call failed:', err);
        const message = err instanceof Error ? err.message : 'Failed to place call';
        setError(message);
        setIsConnecting(false);
      }
    },
    [normalizedApiUrl, getApiHeaders, handleCallAnswered, handleCallEnded, isRegistered]
  );

  const answerCall = useCallback(async () => {
    if (
      sessionRef.current &&
      sessionRef.current.state === SessionState.Initial &&
      sessionRef.current instanceof Invitation
    ) {
      sessionRef.current
        .accept()
        .then(() => {
          console.log('[Phone] Call accepted');
          // update API status?
        })
        .catch(e => {
          console.error('Failed to accept', e);
          setError('Failed to answer');
        });
    } else {
      // Fallback to API answer logic if not SIP (or hybrid state)
      // ... (preserving original API logic if needed?)
      // For now, assuming SIP is primary.
    }
  }, []);

  const hangupCall = useCallback(async () => {
    if (sessionRef.current) {
      switch (sessionRef.current.state) {
        case SessionState.Initial:
        case SessionState.Establishing:
          if (sessionRef.current instanceof Inviter) {
            sessionRef.current.cancel();
          } else if (sessionRef.current instanceof Invitation) {
            sessionRef.current.reject();
          }
          break;
        case SessionState.Established:
          sessionRef.current.bye();
          break;
      }
    }
  }, []);

  const toggleMute = useCallback(() => {
    // TODO: Implement SIP mute
    // sessionRef.current?.mute() / unmute()
    setCurrentCall(prev => {
      if (!prev) return prev;
      return { ...prev, isMuted: !prev.isMuted };
    });
  }, []);

  const toggleHold = useCallback(async () => {
    // TODO: Implement SIP hold
    // sessionRef.current?.invite({ sessionDescriptionHandlerOptions: { hold: true } })
    setCurrentCall(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        isOnHold: !prev.isOnHold,
        state: !prev.isOnHold ? 'hold' : 'active',
      };
    });
  }, []);

  const sendDTMF = useCallback((digit: string) => {
    if (sessionRef.current && sessionRef.current.state === SessionState.Established) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sessionRef.current as any).dtmf(digit);
    }
  }, []);

  const transferCall = useCallback(async (_destination: string, _type: 'blind' | 'warm') => {
    // TODO: Implement SIP REFER
    console.log('Transfer not fully implemented in SIP yet');
  }, []);

  // Add third party to call (for 3-way calling)
  // This puts the current call on hold and dials the new number
  const addThirdParty = useCallback(
    async (phoneNumber: string) => {
      if (!sessionRef.current || sessionRef.current.state !== SessionState.Established) {
        setError('No active call to add party to');
        return;
      }

      if (!userAgentRef.current) {
        setError('Phone not connected');
        return;
      }

      try {
        console.log('[Phone] Adding third party:', phoneNumber);

        // 1. Put the current call on hold
        void toggleHold();

        // 2. Stash the current session
        heldSessionRef.current = sessionRef.current;
        setHasHeldCalls(true);
        sessionRef.current = null; // Clear so makeCall starts fresh

        // 3. Dial the new number
        await makeCall(phoneNumber);
      } catch (err) {
        console.error('[Phone] Add third party failed:', err);
        const message = err instanceof Error ? err.message : 'Failed to add party';
        setError(message);

        // Restore if failed
        if (heldSessionRef.current) {
          sessionRef.current = heldSessionRef.current;
          heldSessionRef.current = null;
          setHasHeldCalls(false);
        }
      }
    },
    [toggleHold, makeCall]
  );

  const mergeCalls = useCallback(async () => {
    if (!sessionRef.current || !heldSessionRef.current) {
      setError('Need two calls to merge');
      return;
    }

    // Get call IDs using the SIP Call-ID header or internal id
    // Note: sip.js session.id is usually the Call-ID
    const activeCallId = sessionRef.current.id;
    const heldCallId = heldSessionRef.current.id;

    console.log('[Phone] Merging calls...', {
      active: activeCallId,
      held: heldCallId,
    });

    try {
      // Call backend API to merge
      const response = await fetch(`${normalizedApiUrl}/api/v1/agent/call/merge`, {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          activeCallId,
          heldCallId,
        }),
      });

      if (!response.ok) {
        throw new Error('Merge failed');
      }

      // On success, the held session is effectively consumed/merged.
      // We should probably rely on the backend events, but simpler to clean up local state
      heldSessionRef.current = null;
      setHasHeldCalls(false);

      // The active session remains as the "Conference" session
      console.log('[Phone] Merge command sent successfully');
    } catch (err) {
      console.error('[Phone] Merge failed:', err);
      setError('Failed to merge calls');
    }
  }, [normalizedApiUrl, getApiHeaders]);

  const setAudioInput = useCallback((deviceId: string) => {
    setSelectedAudioInput(deviceId);
  }, []);

  const setAudioOutput = useCallback((deviceId: string) => {
    setSelectedAudioOutput(deviceId);
  }, []);

  const updateScreenPopFields = useCallback((fields: ScreenPopField[]) => {
    setScreenPopFields(fields);
    if (typeof window !== 'undefined') {
      localStorage.setItem('screenPopFields', JSON.stringify(fields));
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // Main SIP Initialization - Moved to bottom to satisfy dependencies
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Use existing FreeSWITCH user (1000-1019 available, password is 1234)
    const sipUser = '1000';
    const sipPass = '1234';
    // Use PUBLIC_IP from env, fallback to window location if local
    const domain = process.env.NEXT_PUBLIC_IP || window.location.hostname;
    // SIP WS endpoint - use /ws path via nginx (terminates SSL and proxies to FreeSWITCH:8083)
    // For local dev, connect directly to ws://domain:8083
    const isSecure = window.location.protocol === 'https:';
    const sipWsUrl = isSecure ? `wss://${domain}/ws` : `ws://${domain}:8083`;

    console.log('[Phone] Initializing SIP UA:', { sipUser, domain, sipWsUrl });

    const uri = UserAgent.makeURI(`sip:${sipUser}@${domain}`);
    if (!uri) {
      setError('Invalid SIP URI');
      return;
    }

    const options: UserAgentOptions = {
      uri,
      transportOptions: {
        server: sipWsUrl,
      },
      authorizationUsername: sipUser,
      authorizationPassword: sipPass,
      delegate: {
        onConnect: () => {
          console.log('[Phone] SIP Transport Connected');
          setError(null);
        },
        onDisconnect: error => {
          console.log('[Phone] SIP Transport Disconnected', error);
          setIsRegistered(false);
          if (error) setError('SIP connection lost');
        },
        onInvite: (invitation: Invitation) => {
          console.log('[Phone] Incoming SIP Invite');
          handleIncomingSipCall(invitation);
        },
      },
    };

    const ua = new UserAgent(options);
    userAgentRef.current = ua;

    ua.start()
      .then(() => {
        console.log('[Phone] SIP UA Started');
        const registerer = new Registerer(ua);
        registerer
          .register()
          .then(() => {
            console.log('[Phone] SIP Registered');
            setIsRegistered(true);
            setAgentStatusState('available');
          })
          .catch(e => {
            console.error('[Phone] SIP Registration Failed', e);
            setError('Registration failed');
          });
      })
      .catch(e => {
        console.error('[Phone] SIP UA Start Failed', e);
        setError('Phone initialization failed');
      });

    return () => {
      if (ua) {
        ua.stop();
      }
    };
  }, [handleIncomingSipCall]);

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
    isRegistered, // Exported for UI
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
    addThirdParty,
    mergeCalls,
    hasHeldCalls,
    setAudioInput,
    setAudioOutput,
    updateScreenPopFields,
    clearError,
  };

  return <PhoneContext.Provider value={value}>{children}</PhoneContext.Provider>;
}

export default PhoneProvider;
