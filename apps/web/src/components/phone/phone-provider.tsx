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

// Helper to extract the actual SIP Call-ID header from a SIP.js Session object
function getSipCallId(session: any): string {
  if (!session) return '';

  // Strategy 1: Check request headers (standard SIP header)
  if (session.request && typeof session.request.getHeader === 'function') {
    const headerVal = session.request.getHeader('Call-ID');
    if (headerVal) return headerVal.trim();
  }

  // Strategy 2: Check request.callId
  if (session.request && session.request.callId) {
    return session.request.callId.trim();
  }

  // Strategy 3: Check incomingMessage or outgoingRequest
  if (session.incomingMessage && session.incomingMessage.callId) {
    return session.incomingMessage.callId.trim();
  }
  if (session.outgoingRequestMessage && session.outgoingRequestMessage.callId) {
    return session.outgoingRequestMessage.callId.trim();
  }

  // Fallback to session.id
  return (session.id || '').trim();
}

// ============================================================================
// Types & Interfaces
// ============================================================================

export type AgentStatus = 'available' | 'on-call' | 'away' | 'dnd' | 'offline';

export type CallDirection = 'inbound' | 'outbound';

export type CallState = 'idle' | 'ringing' | 'connecting' | 'active' | 'hold' | 'ended';

/** Preserved call data for post-call disposition when currentCall is cleared */
export interface PendingDispositionCall {
  callId: string;
  direction: CallDirection;
  phoneNumber: string;
  callerName?: string;
  duration: number;
  startTime?: Date;
  endTime: Date;
  prospectData?: ProspectData;
}

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
  dialerNumber: string; // Pre-filled dialer number
  pendingDispositionCall: PendingDispositionCall | null; // Post-call disposition data
  userNumbers: Array<{ id: string; number: string; provider?: string | null }>;
  selectedCallerId: string | null;

  // Actions
  setAgentStatus: (status: AgentStatus) => void;
  openPhonePanel: () => void;
  closePhonePanel: () => void;
  togglePhonePanel: () => void;
  setDialerNumber: (number: string) => void; // Pre-fill dialer
  makeCall: (phoneNumber: string, callerIdOverride?: string) => Promise<void>;
  answerCall: () => void;
  hangupCall: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
  sendDTMF: (digit: string) => void;
  transferCall: (destination: string, type: 'blind' | 'warm') => void;
  addThirdParty: (phoneNumber: string) => Promise<void>;
  mergeCalls: () => Promise<void>;
  hasHeldCalls: boolean;
  setAudioInput: (deviceId: string) => void;
  setAudioOutput: (deviceId: string) => void;
  updateScreenPopFields: (fields: ScreenPopField[]) => void;
  clearError: () => void;
  clearPendingDispositionCall: () => void;
  setSelectedCallerId: (callerId: string) => void;
  refreshUserNumbers: () => Promise<void>;
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

export function PhoneProvider({ children, apiUrl }: PhoneProviderProps): JSX.Element {
  // In the browser, always derive the API base from the current origin so
  // requests use the same protocol/domain (avoids Mixed Content when the
  // build-time NEXT_PUBLIC_API_URL was baked with an http:// address).
  const resolvedApiUrl =
    apiUrl ||
    (typeof window !== 'undefined'
      ? window.location.origin
      : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001');
  // Normalize apiUrl to just be the base (remove trailing /api/v1 if present)
  const normalizedApiUrl = resolvedApiUrl.replace(/\/api\/v1\/?$/, '');

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
      if (typeof window !== 'undefined') {
        const token = localStorage.getItem('token');
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        const demoMode = localStorage.getItem('demoMode') === 'true';
        const demoTenantId = localStorage.getItem('demoTenantId');
        if (demoMode && demoTenantId) {
          headers['X-Demo-Tenant-Id'] = demoTenantId;
        }
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
  const [pendingDispositionCall, setPendingDispositionCall] =
    useState<PendingDispositionCall | null>(null);
  const [dialerNumber, setDialerNumber] = useState<string>('');
  const [userNumbers, setUserNumbers] = useState<
    Array<{ id: string; number: string; provider?: string | null }>
  >([]);
  const [selectedCallerId, setSelectedCallerId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('selectedCallerId');
    }
    return null;
  });

  // Refs

  const callDurationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const userAgentRef = useRef<UserAgent | null>(null);
  const registererRef = useRef<Registerer | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const heldSessionRef = useRef<Session | null>(null);
  const heldCallInfoRef = useRef<CallInfo | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [hasHeldCalls, setHasHeldCalls] = useState(false);
  const reportedAnsweredCallsRef = useRef<Set<string>>(new Set());
  const reportedEndedCallsRef = useRef<Set<string>>(new Set());
  const audioContextRef = useRef<AudioContext | null>(null);
  const ringOscRef = useRef<{ interval: ReturnType<typeof setInterval> } | null>(null);

  // ============================================================================
  // Audio Utilities
  // ============================================================================

  // Unlock audio (ringtone + AudioContext) on user interaction to bypass autoplay.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!ringtoneRef.current) {
      ringtoneRef.current = new Audio('/sounds/ringtone.mp3');
      ringtoneRef.current.loop = true;
    }
    const unlock = () => {
      try {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AC) {
          if (!audioContextRef.current) audioContextRef.current = new AC();
          if (audioContextRef.current.state === 'suspended') void audioContextRef.current.resume();
        }
      } catch {
        /* ignore */
      }
      if (ringtoneRef.current) {
        ringtoneRef.current
          .play()
          .then(() => {
            ringtoneRef.current?.pause();
            if (ringtoneRef.current) ringtoneRef.current.currentTime = 0;
          })
          .catch(() => {});
      }
    };
    window.addEventListener('click', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };
  }, []);

  // Fetch user's assigned phone numbers for caller ID selection
  const refreshUserNumbers = useCallback(async () => {
    try {
      const url = `${normalizedApiUrl}/api/v1/agent/my-numbers`;
      const response = await fetch(url, { headers: getApiHeaders() });
      if (response.ok) {
        const data = await response.json();
        setUserNumbers(data.numbers || []);
        // Auto-select first number if no selection stored
        if (data.numbers?.length > 0 && !selectedCallerId) {
          setSelectedCallerId(data.numbers[0].number);
        }
      }
    } catch (err) {
      console.error('[Phone] Failed to fetch user numbers:', err);
    }
  }, [normalizedApiUrl, getApiHeaders, selectedCallerId]);

  useEffect(() => {
    void refreshUserNumbers();
  }, [refreshUserNumbers]);

  // Persist selected caller ID to localStorage
  useEffect(() => {
    if (selectedCallerId && typeof window !== 'undefined') {
      localStorage.setItem('selectedCallerId', selectedCallerId);
    }
  }, [selectedCallerId]);

  const playRingtone = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioContextRef.current) audioContextRef.current = new AC();
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') void ctx.resume();
      const ringOnce = () => {
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(ctx.destination);
        const o1 = ctx.createOscillator();
        o1.type = 'sine';
        o1.frequency.value = 440;
        o1.connect(gain);
        const o2 = ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = 480;
        o2.connect(gain);
        const t = ctx.currentTime;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.35, t + 0.03);
        gain.gain.setValueAtTime(0.35, t + 1.8);
        gain.gain.linearRampToValueAtTime(0, t + 1.9);
        o1.start(t);
        o2.start(t);
        o1.stop(t + 1.95);
        o2.stop(t + 1.95);
      };
      if (ringOscRef.current?.interval) clearInterval(ringOscRef.current.interval);
      ringOnce();
      ringOscRef.current = { interval: setInterval(ringOnce, 4000) };
    } catch (err) {
      console.warn('[Phone] Ring failed:', err);
    }
  }, []);

  const stopRingtone = useCallback(() => {
    if (ringOscRef.current?.interval) {
      clearInterval(ringOscRef.current.interval);
      ringOscRef.current = null;
    }
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

  // ============================================================================
  // Remote Audio Setup — race-condition-proof implementation
  // ============================================================================

  /**
   * Installs ontrack listener on a PeerConnection (idempotent).
   * Must be called as early as possible — ideally BEFORE accept() resolves.
   * Also picks up any tracks that are already on the receivers.
   *
   * Uses a WeakSet to guarantee it only runs ONCE per PeerConnection,
   * preventing the play() AbortError from double srcObject assignment.
   */
  const wiredPcsRef = useRef<WeakSet<RTCPeerConnection>>(new WeakSet());

  const wireRemoteAudio = useCallback((pc: RTCPeerConnection) => {
    const audioEl = remoteAudioRef.current;
    if (!audioEl) {
      console.warn('[Phone] wireRemoteAudio: no audio element');
      return;
    }

    // Only install ontrack listener once per PC, but always check for existing tracks
    const alreadyWired = wiredPcsRef.current.has(pc);

    // Helper: attach stream to audio element and play
    const attachAndPlay = (src: MediaStream) => {
      if (src.getAudioTracks().length === 0) return;
      audioEl.srcObject = src;
      audioEl.play().catch(e => console.warn('[Phone] audio.play() blocked:', e));
    };

    if (!alreadyWired) {
      wiredPcsRef.current.add(pc);

      // Create a single MediaStream that accumulates tracks
      const stream = new MediaStream();

      // Install ontrack for any tracks that arrive (covers async ICE negotiation)
      pc.addEventListener('track', (event: RTCTrackEvent) => {
        console.log(
          '[Phone] ontrack fired:',
          event.track.kind,
          event.track.id,
          'readyState:',
          event.track.readyState
        );
        // Prefer the event's stream if available
        if (event.streams?.[0]) {
          attachAndPlay(event.streams[0]);
        } else {
          stream.addTrack(event.track);
          attachAndPlay(stream);
        }
      });
    }

    // ALWAYS check for existing tracks (even on repeated calls) — this catches
    // tracks that arrived between wiring and the stateChange Established event
    const existingStream = new MediaStream();
    pc.getReceivers().forEach(r => {
      if (r.track && r.track.readyState === 'live') {
        console.log('[Phone] wireRemoteAudio: existing receiver track', r.track.kind, r.track.id);
        existingStream.addTrack(r.track);
      }
    });

    if (existingStream.getAudioTracks().length > 0) {
      console.log(
        '[Phone] wireRemoteAudio: attaching',
        existingStream.getAudioTracks().length,
        'existing tracks'
      );
      attachAndPlay(existingStream);
    } else {
      // No tracks yet — retry in 500ms (covers late ICE negotiation on inbound calls)
      setTimeout(() => {
        const retryStream = new MediaStream();
        try {
          pc.getReceivers().forEach(r => {
            if (r.track && r.track.readyState === 'live') {
              console.log('[Phone] wireRemoteAudio retry: found track', r.track.kind, r.track.id);
              retryStream.addTrack(r.track);
            }
          });
          if (retryStream.getAudioTracks().length > 0) {
            attachAndPlay(retryStream);
          }
        } catch {
          /* PC may be closed */
        }
      }, 500);
    }
  }, []);

  // Keep handleCallAnswered / handleCallEnded in refs so stateChange listeners
  // always call the latest versions (avoids stale closures).
  const handleCallAnsweredRef = useRef<() => void>(() => {});
  const handleCallEndedRef = useRef<() => void>(() => {});

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

      // Fetch prospect data for screen pop (async, non-blocking)
      if (callerNumber && callerNumber !== 'Unknown') {
        fetch(`${normalizedApiUrl}/api/v1/prospects/by-phone/${encodeURIComponent(callerNumber)}`, {
          method: 'GET',
          headers: getApiHeaders(false),
        })
          .then(response => response.json())
          .then((data: { prospect?: ProspectData }) => {
            if (data.prospect) {
              console.log('[Phone] Screen pop data loaded:', data.prospect);
              setCurrentCall(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  prospectData: {
                    id: data.prospect?.id,
                    firstName: data.prospect?.firstName,
                    lastName: data.prospect?.lastName,
                    fullName:
                      `${data.prospect?.firstName || ''} ${data.prospect?.lastName || ''}`.trim(),
                    phoneNumber: data.prospect?.phone as string | undefined,
                    email: data.prospect?.email,
                    address: data.prospect?.street as string | undefined,
                    city: data.prospect?.city,
                    state: data.prospect?.state,
                    zipCode: data.prospect?.zip as string | undefined,
                    ...data.prospect,
                  },
                };
              });
            }
          })
          .catch(err => {
            console.log('[Phone] No screen pop data found:', err);
          });
      }

      // Use refs for the callbacks to avoid stale closures in the listener
      invitation.stateChange.addListener(newState => {
        console.log('[Phone] Invitation state changed:', newState);
        if (newState === SessionState.Terminated) {
          if (sessionRef.current === invitation) {
            handleCallEndedRef.current();
          } else if (heldSessionRef.current === invitation) {
            console.log('[Phone] Held inbound session terminated in background');
            heldSessionRef.current = null;
            heldCallInfoRef.current = null;
            setHasHeldCalls(false);
          }
        } else if (newState === SessionState.Established) {
          handleCallAnsweredRef.current();
          // Re-wire as a safety net — the primary wire is in answerCall
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pc = (invitation.sessionDescriptionHandler as any)?.peerConnection as
            | RTCPeerConnection
            | undefined;
          if (pc) wireRemoteAudio(pc);
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playRingtone, normalizedApiUrl, getApiHeaders, wireRemoteAudio]
  );

  /**
   * Legacy compat wrapper — called from outbound (Inviter) flows.
   * Delegates to the new wireRemoteAudio.
   */
  const setupRemoteAudio = (session: Session) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pc = (session.sessionDescriptionHandler as any)?.peerConnection as
      | RTCPeerConnection
      | undefined;
    if (!pc) {
      console.warn('[Phone] setupRemoteAudio: no peerConnection on session');
      return;
    }
    wireRemoteAudio(pc);
  };

  const handleCallAnswered = useCallback(() => {
    setCurrentCall(prev => {
      if (!prev) return prev;

      if (prev.direction === 'outbound') {
        const callId = prev.callId;
        if (!reportedAnsweredCallsRef.current.has(callId)) {
          reportedAnsweredCallsRef.current.add(callId);
          const url = `${normalizedApiUrl}/api/v1/agent/call/${callId}/answer`;
          fetch(url, {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({}),
          })
            .then(res => {
              if (!res.ok) {
                console.error('[Phone] Failed to report answer to backend');
              } else {
                console.log('[Phone] Answer successfully reported to backend');
              }
            })
            .catch(err => console.error('[Phone] Failed to report answer:', err));
        }
      }

      return {
        ...prev,
        state: 'active',
        answerTime: new Date(),
      };
    });
    setAgentStatusState('on-call');
    // Sync on-call status to Redis so routing service knows agent is busy
    void fetch(`${normalizedApiUrl}/api/v1/agent/status`, {
      method: 'PUT',
      headers: getApiHeaders(),
      body: JSON.stringify({ status: 'on-call' }),
    }).catch(() => {});
    stopRingtone();
    startCallDurationTimer();
  }, [stopRingtone, startCallDurationTimer, normalizedApiUrl, getApiHeaders]);

  const handleCallEnded = useCallback(() => {
    // If there is a held call stashed, restore it instead of ending the session entirely
    if (heldSessionRef.current) {
      console.log('[Phone] Active call ended, restoring stashed held session');
      sessionRef.current = heldSessionRef.current;
      heldSessionRef.current = null;
      setHasHeldCalls(false);

      const restoredCall = heldCallInfoRef.current;
      heldCallInfoRef.current = null;

      if (restoredCall) {
        restoredCall.isOnHold = false;
        restoredCall.state = 'active';

        // Unhold/unmute audio tracks in the browser RTCPeerConnection
        try {
          const sdh = sessionRef.current.sessionDescriptionHandler as any;
          if (sdh && sdh.peerConnection) {
            const pc = sdh.peerConnection as RTCPeerConnection;
            const senders = pc.getSenders();
            for (const sender of senders) {
              if (sender.track && sender.track.kind === 'audio') {
                sender.track.enabled = true; // unmute
              }
            }

            // Re-bind the restored call's stream to the browser HTML audio element
            wireRemoteAudio(pc);
          }
        } catch (e) {
          console.warn('[Phone] Failed to unmute track on restore:', e);
        }

        setCurrentCall(restoredCall);
      }
      return;
    }

    // Otherwise, normal call ended
    setCurrentCall(prev => {
      if (prev) {
        const completedCall: CallInfo = {
          ...prev,
          state: 'ended',
          endTime: new Date(),
        };

        const duration = prev.answerTime
          ? Math.floor((Date.now() - prev.answerTime.getTime()) / 1000)
          : 0;

        if (prev.direction === 'outbound') {
          const callId = prev.callId;
          if (!reportedEndedCallsRef.current.has(callId)) {
            reportedEndedCallsRef.current.add(callId);
            const url = `${normalizedApiUrl}/api/v1/agent/call/${callId}/hangup`;
            fetch(url, {
              method: 'POST',
              headers: getApiHeaders(),
              body: JSON.stringify({
                duration,
                startedAt: prev.startTime?.toISOString(),
                answeredAt: prev.answerTime?.toISOString(),
                endedAt: new Date().toISOString(),
                endReason: 'sip_terminated',
              }),
            })
              .then(res => {
                if (!res.ok) {
                  console.error('[Phone] Failed to report hangup to backend');
                } else {
                  console.log('[Phone] Hangup successfully reported to backend');
                }
              })
              .catch(err => console.error('[Phone] Failed to report hangup:', err));
          }
        }

        setCallHistory(history => [completedCall, ...history].slice(0, 50));
        // Preserve call data for disposition modal
        setPendingDispositionCall({
          callId: prev.callId,
          direction: prev.direction,
          phoneNumber: prev.phoneNumber,
          callerName: prev.callerName,
          duration: duration,
          startTime: prev.startTime,
          endTime: new Date(),
          prospectData: prev.prospectData,
        });
      }
      return null;
    });
    setAgentStatusState('available');
    // Sync available status to Redis so routing service knows agent is free
    void fetch(`${normalizedApiUrl}/api/v1/agent/status`, {
      method: 'PUT',
      headers: getApiHeaders(),
      body: JSON.stringify({ status: 'available' }),
    }).catch(() => {});
    setIsConnecting(false);
    stopRingtone();
    stopCallDurationTimer();
    sessionRef.current = null;
  }, [stopRingtone, stopCallDurationTimer, normalizedApiUrl, getApiHeaders, wireRemoteAudio]);

  // Keep refs in sync so stateChange listeners always call latest versions
  useEffect(() => {
    handleCallAnsweredRef.current = handleCallAnswered;
  }, [handleCallAnswered]);
  useEffect(() => {
    handleCallEndedRef.current = handleCallEnded;
  }, [handleCallEnded]);

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
    async (phoneNumber: string, callerIdOverride?: string) => {
      if (!userAgentRef.current) {
        setError('Phone not connected');
        throw new Error('Phone not connected');
      }

      if (!isRegistered && !sessionRef.current && !heldSessionRef.current) {
        setError('Phone not connected');
        throw new Error('Phone not connected');
      }

      // Clean up any leftover session from a previous call to prevent
      // "Peer connection closed" errors when re-dialing quickly after hangup
      if (sessionRef.current) {
        try {
          if (sessionRef.current.state !== SessionState.Terminated) {
            console.log('[Phone] Cleaning up stale session before new call');
            void sessionRef.current.dispose();
          }
        } catch {
          /* ignore disposal errors */
        }
        sessionRef.current = null;
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
          body: JSON.stringify({
            phoneNumber,
            callerId: callerIdOverride || selectedCallerId || undefined,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error?.message || 'Failed to initiate call');
        }

        const data = (await response.json()) as ApiResponse & { callerId?: string };
        // Call ID from API for tracking
        const apiCallId = data.callId;
        const chosenCallerId = data.callerId || '';

        // SIP INVITE - use registered server host for the target domain (must match FreeSWITCH)
        const sipTargetDomain =
          userAgentRef.current?.configuration.uri.host ||
          process.env.NEXT_PUBLIC_SIP_DOMAIN ||
          process.env.NEXT_PUBLIC_IP ||
          (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
        const target = UserAgent.makeURI(`sip:${phoneNumber}@${sipTargetDomain}`);
        if (!target) throw new Error('Invalid target URI');

        const extraHeaders: string[] = [];
        if (chosenCallerId) {
          extraHeaders.push(`X-Caller-ID: ${chosenCallerId}`);
        }
        if (apiCallId) {
          extraHeaders.push(`X-Hopwhistle-Call-Id: ${apiCallId}`);
        }

        console.log('[Phone] Creating Inviter with extraHeaders:', extraHeaders);

        const inviter = new Inviter(userAgentRef.current, target, {
          extraHeaders,
          sessionDescriptionHandlerOptions: {
            constraints: { audio: true, video: false },
            peerConnectionConfiguration: {
              iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
              ],
            },
          },
        });
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
            handleCallAnsweredRef.current();
            setupRemoteAudio(inviter);
          } else if (newState === SessionState.Terminated) {
            if (sessionRef.current === inviter) {
              handleCallEndedRef.current();
            } else if (heldSessionRef.current === inviter) {
              console.log('[Phone] Held outbound session terminated in background');
              heldSessionRef.current = null;
              heldCallInfoRef.current = null;
              setHasHeldCalls(false);
            }
          }
        });

        inviter
          .invite({
            requestOptions: {
              extraHeaders,
            },
          })
          .then(() => {
            console.log('[Phone] INVITE sent with caller ID:', chosenCallerId);
          })
          .catch(e => {
            console.error('[Phone] INVITE failed', e);
            setError('Call failed');
            handleCallEndedRef.current();
          });
      } catch (err) {
        console.error('[Phone] Call failed:', err);
        const message = err instanceof Error ? err.message : 'Failed to place call';
        setError(message);
        setIsConnecting(false);
        throw err;
      }
    },
    [normalizedApiUrl, getApiHeaders, isRegistered, selectedCallerId]
  );

  const answerCall = useCallback(() => {
    if (
      sessionRef.current &&
      sessionRef.current.state === SessionState.Initial &&
      sessionRef.current instanceof Invitation
    ) {
      const invitation = sessionRef.current;
      console.log('[Phone] Answering inbound call...');

      // Immediately provide UI feedback that the call is answering
      stopRingtone();
      setCurrentCall(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          state: 'connecting',
        };
      });

      // Accept with explicit media constraints to ensure mic capture
      invitation
        .accept({
          sessionDescriptionHandlerOptions: {
            constraints: { audio: true, video: false },
            peerConnectionConfiguration: {
              iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
              ],
            },
          },
        })
        .then(() => {
          console.log('[Phone] Call accepted — wiring remote audio (post-accept safety net)');
          // The stateChange → Established listener already calls wireRemoteAudio,
          // but this is a belt-and-suspenders call. wireRemoteAudio uses
          // addEventListener('track', ...) so duplicate installs are safe.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pc = (invitation.sessionDescriptionHandler as any)?.peerConnection as
            | RTCPeerConnection
            | undefined;
          if (pc) {
            wireRemoteAudio(pc);
          } else {
            console.error('[Phone] CRITICAL: No peerConnection after accept()');
          }
        })
        .catch(e => {
          console.error('[Phone] Failed to accept inbound call', e);
          setError('Failed to answer');
          setCurrentCall(prev => {
            if (!prev) return prev;
            return { ...prev, state: 'ended' };
          });
        });
    } else {
      console.warn('[Phone] answerCall called but no valid Invitation in Initial state');
    }
  }, [wireRemoteAudio, stopRingtone]);

  const hangupCall = useCallback(() => {
    if (sessionRef.current) {
      switch (sessionRef.current.state) {
        case SessionState.Initial:
        case SessionState.Establishing:
          if (sessionRef.current instanceof Inviter) {
            void sessionRef.current.cancel();
          } else if (sessionRef.current instanceof Invitation) {
            void sessionRef.current.reject();
          }
          break;
        case SessionState.Established:
          void sessionRef.current.bye();
          break;
      }
    }
    // Safety net: force local call end if SIP.js is stuck or already terminated
    handleCallEndedRef.current();
  }, []);

  const toggleMute = useCallback(() => {
    // TODO: Implement SIP mute
    // sessionRef.current?.mute() / unmute()
    setCurrentCall(prev => {
      if (!prev) return prev;
      return { ...prev, isMuted: !prev.isMuted };
    });
  }, []);

  const toggleHold = useCallback(() => {
    if (!sessionRef.current || sessionRef.current.state !== SessionState.Established) {
      return;
    }

    const session = sessionRef.current;
    const currentlyOnHold = currentCall?.isOnHold ?? false;

    try {
      // Send re-INVITE with hold/unhold SDP modifiers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdh = session.sessionDescriptionHandler as any;
      if (sdh && sdh.peerConnection) {
        const pc = sdh.peerConnection as RTCPeerConnection;
        const senders = pc.getSenders();
        for (const sender of senders) {
          if (sender.track && sender.track.kind === 'audio') {
            sender.track.enabled = currentlyOnHold; // unmute for resume, mute for hold
          }
        }
      }

      setCurrentCall(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          isOnHold: !currentlyOnHold,
          state: !currentlyOnHold ? 'hold' : 'active',
        };
      });
    } catch (err) {
      console.error('[Phone] Hold toggle failed:', err);
      // Fallback: still update UI state so user isn't stuck
      setCurrentCall(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          isOnHold: !currentlyOnHold,
          state: !currentlyOnHold ? 'hold' : 'active',
        };
      });
    }
  }, [currentCall?.isOnHold]);

  const playDTMFTone = useCallback((digit: string) => {
    try {
      if (!audioContextRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
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

      gainNode.gain.value = 0.05; // Comfort volume for DTMF tones during active call

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

  const sendDTMF = useCallback(
    (digit: string) => {
      playDTMFTone(digit);

      if (sessionRef.current && sessionRef.current.state === SessionState.Established) {
        const sdh = sessionRef.current.sessionDescriptionHandler;
        if (sdh && typeof (sdh as any).sendDtmf === 'function') {
          console.log('[Phone] Sending DTMF via SessionDescriptionHandler:', digit);
          (sdh as any).sendDtmf(digit);
        } else {
          console.warn(
            '[Phone] SessionDescriptionHandler does not support sendDtmf, trying legacy .dtmf'
          );
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (sessionRef.current as any).dtmf(digit);
          } catch (e) {
            console.error('[Phone] Failed to send DTMF via legacy method:', e);
          }
        }
      }
    },
    [playDTMFTone]
  );

  const transferCall = useCallback((_destination: string, _type: 'blind' | 'warm') => {
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

        // 1. Put the current call on hold (await so SIP processes)
        toggleHold();

        // 2. Stash the current session and call info
        heldCallInfoRef.current = currentCall
          ? { ...currentCall, isOnHold: true, state: 'hold' }
          : null;
        heldSessionRef.current = sessionRef.current;
        setHasHeldCalls(true);
        sessionRef.current = null; // Clear so makeCall starts fresh

        // 3. Small delay to let FreeSWITCH process the hold
        await new Promise(resolve => setTimeout(resolve, 500));

        // 4. Dial the new number
        await makeCall(phoneNumber);
      } catch (err) {
        console.error('[Phone] Add third party failed:', err);
        const message = err instanceof Error ? err.message : 'Failed to add party';
        setError(message);

        // Restore if failed
        if (heldSessionRef.current) {
          sessionRef.current = heldSessionRef.current;
          heldSessionRef.current = null;
          heldCallInfoRef.current = null;
          setHasHeldCalls(false);
          // Try to unhold the original call
          try {
            toggleHold();
          } catch {
            /* best effort */
          }
        }
      }
    },
    [toggleHold, makeCall, currentCall]
  );

  const mergeCalls = useCallback(async () => {
    if (!sessionRef.current || !heldSessionRef.current) {
      setError('Need two calls to merge');
      return;
    }

    // Get call IDs using the exact SIP Call-ID header to match FreeSWITCH's sip_call_id
    const activeCallId = getSipCallId(sessionRef.current);
    const heldCallId = getSipCallId(heldSessionRef.current);

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
      // Hang up the held session locally to clean up WebRTC state in the browser
      if (heldSessionRef.current) {
        try {
          void heldSessionRef.current.bye();
        } catch (e) {
          console.warn('[Phone] Failed to send BYE for held session:', e);
        }
        heldSessionRef.current = null;
        heldCallInfoRef.current = null;
      }
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
  const clearPendingDispositionCall = useCallback(() => setPendingDispositionCall(null), []);

  // Main SIP Initialization - Moved to bottom to satisfy dependencies
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let ua: UserAgent | null = null;
    let active = true;

    async function initSip() {
      try {
        console.log('[Phone] Fetching WebRTC credentials...');
        const url = `${normalizedApiUrl}/api/v1/agent/webrtc/credentials`;
        const response = await fetch(url, {
          method: 'GET',
          headers: getApiHeaders(),
        });

        if (!response.ok) {
          throw new Error('Failed to fetch WebRTC credentials');
        }

        const creds = await response.json();
        if (!active) return;

        // Extract extension from username (e.g. "1000@default-tenant-id" -> "1000")
        const [sipUser] = creds.username.split('@');
        const sipPass = creds.password;

        // SIP realm must match FreeSWITCH's configured domain
        const sipDomain =
          creds.realm ||
          process.env.NEXT_PUBLIC_SIP_DOMAIN ||
          process.env.NEXT_PUBLIC_IP ||
          (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
        // WebSocket host uses window hostname for SSL cert validation
        const wsHost = window.location.hostname;
        const isSecure = window.location.protocol === 'https:';
        // Connect directly to FreeSWITCH's native WSS (7443) / WS (8083) binding.
        // Direct connection preserves the WSS transport label so FreeSWITCH can
        // route call responses back over the same socket. (A TLS-terminating
        // reverse proxy hands FreeSWITCH a plain-WS connection while the client
        // still advertises Via WSS, which breaks INVITE response routing.)
        let sipWsUrl = creds.wsUrl;
        if (isSecure) {
          sipWsUrl = `wss://${wsHost}:7443`;
        } else {
          sipWsUrl = `ws://${wsHost}:8083`;
        }

        console.log('[Phone] Initializing SIP UA dynamically:', { sipUser, sipDomain, sipWsUrl });

        const uri = UserAgent.makeURI(`sip:${sipUser}@${sipDomain}`);
        if (!uri) {
          setError('Invalid SIP URI');
          return;
        }

        // Request persistent mic stream to prevent browser sleep / tab suspension
        try {
          console.log('[Phone] Requesting persistent mic stream to prevent browser sleep...');
          persistentMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          console.log('[Phone] Persistent mic stream acquired successfully');
        } catch (err) {
          console.warn(
            '[Phone] Failed to acquire persistent mic stream (will continue initializing):',
            err
          );
        }

        const options: UserAgentOptions = {
          uri,
          transportOptions: {
            server: sipWsUrl,
          },
          authorizationUsername: sipUser,
          authorizationPassword: sipPass,
          reconnectionAttempts: 1000,
          reconnectionDelay: 5,
          sessionDescriptionHandlerFactoryOptions: {
            peerConnectionConfiguration: {
              iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
              ],
            },
          },
          delegate: {
            onConnect: () => {
              console.log('[Phone] SIP Transport Connected');
              setError(null);
              if (registererRef.current) {
                console.log('[Phone] Re-registering on transport connect');
                registererRef.current.register().then(() => {
                  console.log('[Phone] Re-registration succeeded, syncing available to Redis');
                  setIsRegistered(true);
                  setAgentStatusState('available');
                  void fetch(`${normalizedApiUrl}/api/v1/agent/status`, {
                    method: 'PUT',
                    headers: getApiHeaders(),
                    body: JSON.stringify({ status: 'available' }),
                  }).catch(() => {});
                }).catch(err => {
                  console.error('[Phone] Re-registration failed:', err);
                });
              }
            },
            onDisconnect: error => {
              console.log('[Phone] SIP Transport Disconnected', error);
              setIsRegistered(false);
              if (error) setError('SIP connection lost');
              // Sync offline status to Redis so routing service excludes this agent
              void fetch(`${normalizedApiUrl}/api/v1/agent/status`, {
                method: 'PUT',
                headers: getApiHeaders(),
                body: JSON.stringify({ status: 'offline' }),
              }).catch(() => {});
            },
            onInvite: (invitation: Invitation) => {
              console.log('[Phone] Incoming SIP Invite');
              handleIncomingSipCall(invitation);
            },
          },
        };

        ua = new UserAgent(options);
        userAgentRef.current = ua;

        await ua.start();
        console.log('[Phone] SIP UA Started');
        const registerer = new Registerer(ua);
        registererRef.current = registerer;
        await registerer.register();
        console.log('[Phone] SIP Registered');
        setIsRegistered(true);
        setAgentStatusState('available');
        // Sync available status to Redis so routing service includes this agent
        void fetch(`${normalizedApiUrl}/api/v1/agent/status`, {
          method: 'PUT',
          headers: getApiHeaders(),
          body: JSON.stringify({ status: 'available' }),
        }).catch(() => {});
      } catch (e) {
        console.error('[Phone] SIP UA Initialization/Start Failed', e);
        if (active) {
          setError('Phone initialization failed');
        }
      }
    }

    let persistentMicStream: MediaStream | null = null;
    void initSip();

    return () => {
      active = false;
      // Sync offline status to Redis before tearing down SIP
      void fetch(`${normalizedApiUrl}/api/v1/agent/status`, {
        method: 'PUT',
        headers: getApiHeaders(),
        body: JSON.stringify({ status: 'offline' }),
      }).catch(() => {});
      if (registererRef.current) {
        void registererRef.current.unregister();
        registererRef.current = null;
      }
      if (ua) {
        void ua.stop();
      }
      if (persistentMicStream) {
        console.log('[Phone] Stopping persistent mic stream tracks...');
        persistentMicStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [handleIncomingSipCall, normalizedApiUrl, getApiHeaders]);

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
    dialerNumber, // Pre-filled dialer number
    pendingDispositionCall, // Post-call disposition data
    userNumbers,
    selectedCallerId,
    setAgentStatus,
    openPhonePanel,
    closePhonePanel,
    togglePhonePanel,
    setDialerNumber, // Pre-fill dialer action
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
    clearPendingDispositionCall,
    setSelectedCallerId,
    refreshUserNumbers,
  };

  return <PhoneContext.Provider value={value}>{children}</PhoneContext.Provider>;
}

export default PhoneProvider;
