/**
 * Dialer V2 — agent state model.
 *
 * The central rule: **predictive capacity counts only agents proven ready to
 * receive a call.** Browser state alone is not proof. An agent whose tab says
 * AVAILABLE but whose SIP registration has gone is not capacity — dialing for
 * them produces an answered call with nobody to take it.
 */

export enum AgentState {
  OFFLINE = 'OFFLINE',
  AUTHENTICATING = 'AUTHENTICATING',
  AVAILABLE = 'AVAILABLE',
  RESERVED = 'RESERVED',
  RINGING = 'RINGING',
  CONNECTING = 'CONNECTING',
  ON_CALL = 'ON_CALL',
  HOLD = 'HOLD',
  TRANSFER = 'TRANSFER',
  CONFERENCE = 'CONFERENCE',
  WRAP_UP = 'WRAP_UP',
  PAUSED = 'PAUSED',
  BREAK = 'BREAK',
  TRAINING = 'TRAINING',
  INBOUND_RESERVED = 'INBOUND_RESERVED',
  LOGGING_OUT = 'LOGGING_OUT',
  STALE = 'STALE',
}

/**
 * Permitted transitions. Modelled explicitly because an agent state machine
 * that accepts anything cannot detect the contradictions §4.7 reconciliation
 * exists to find.
 */
const ALLOWED: Readonly<Record<AgentState, readonly AgentState[]>> = Object.freeze({
  [AgentState.OFFLINE]: [AgentState.AUTHENTICATING, AgentState.STALE],
  [AgentState.AUTHENTICATING]: [AgentState.AVAILABLE, AgentState.OFFLINE, AgentState.STALE],
  [AgentState.AVAILABLE]: [
    AgentState.RESERVED,
    AgentState.INBOUND_RESERVED,
    AgentState.RINGING,
    AgentState.CONNECTING,
    AgentState.ON_CALL,
    AgentState.PAUSED,
    AgentState.BREAK,
    AgentState.TRAINING,
    AgentState.LOGGING_OUT,
    AgentState.OFFLINE,
    AgentState.STALE,
  ],
  [AgentState.RESERVED]: [
    AgentState.RINGING,
    AgentState.CONNECTING,
    AgentState.ON_CALL,
    AgentState.AVAILABLE,
    AgentState.STALE,
    AgentState.OFFLINE,
  ],
  [AgentState.INBOUND_RESERVED]: [
    AgentState.RINGING,
    AgentState.CONNECTING,
    AgentState.ON_CALL,
    AgentState.AVAILABLE,
    AgentState.STALE,
    AgentState.OFFLINE,
  ],
  [AgentState.RINGING]: [
    AgentState.CONNECTING,
    AgentState.ON_CALL,
    AgentState.AVAILABLE,
    AgentState.WRAP_UP,
    AgentState.STALE,
    AgentState.OFFLINE,
  ],
  [AgentState.CONNECTING]: [
    AgentState.ON_CALL,
    AgentState.AVAILABLE,
    AgentState.WRAP_UP,
    AgentState.STALE,
    AgentState.OFFLINE,
  ],
  [AgentState.ON_CALL]: [
    AgentState.HOLD,
    AgentState.TRANSFER,
    AgentState.CONFERENCE,
    AgentState.WRAP_UP,
    AgentState.AVAILABLE,
    AgentState.STALE,
    AgentState.OFFLINE,
  ],
  [AgentState.HOLD]: [
    AgentState.ON_CALL,
    AgentState.TRANSFER,
    AgentState.CONFERENCE,
    AgentState.WRAP_UP,
    AgentState.STALE,
    AgentState.OFFLINE,
  ],
  [AgentState.TRANSFER]: [
    AgentState.ON_CALL,
    AgentState.CONFERENCE,
    AgentState.WRAP_UP,
    AgentState.AVAILABLE,
    AgentState.STALE,
    AgentState.OFFLINE,
  ],
  [AgentState.CONFERENCE]: [
    AgentState.ON_CALL,
    AgentState.HOLD,
    AgentState.WRAP_UP,
    AgentState.STALE,
    AgentState.OFFLINE,
  ],
  [AgentState.WRAP_UP]: [
    AgentState.AVAILABLE,
    AgentState.PAUSED,
    AgentState.BREAK,
    AgentState.LOGGING_OUT,
    AgentState.STALE,
    AgentState.OFFLINE,
  ],
  [AgentState.PAUSED]: [
    AgentState.AVAILABLE,
    AgentState.BREAK,
    AgentState.TRAINING,
    AgentState.LOGGING_OUT,
    AgentState.STALE,
    AgentState.OFFLINE,
  ],
  [AgentState.BREAK]: [
    AgentState.AVAILABLE,
    AgentState.PAUSED,
    AgentState.LOGGING_OUT,
    AgentState.STALE,
    AgentState.OFFLINE,
  ],
  [AgentState.TRAINING]: [
    AgentState.AVAILABLE,
    AgentState.PAUSED,
    AgentState.LOGGING_OUT,
    AgentState.STALE,
    AgentState.OFFLINE,
  ],
  [AgentState.LOGGING_OUT]: [AgentState.OFFLINE, AgentState.STALE],
  // STALE is recoverable: a agent whose browser reconnects re-authenticates.
  [AgentState.STALE]: [AgentState.AUTHENTICATING, AgentState.AVAILABLE, AgentState.OFFLINE],
});

export function isTransitionAllowed(from: AgentState, to: AgentState): boolean {
  if (from === to) return true;
  return (ALLOWED[from] ?? []).includes(to);
}

/**
 * States that count toward predictive capacity as *immediately* usable.
 * Deliberately only AVAILABLE — anything else is either busy, uncertain, or
 * deliberately withdrawn from the pool.
 */
export function countsAsAvailable(state: AgentState): boolean {
  return state === AgentState.AVAILABLE;
}

/** States where the agent is handling a call and will free up in due course. */
export function countsAsOnCall(state: AgentState): boolean {
  return (
    state === AgentState.ON_CALL ||
    state === AgentState.HOLD ||
    state === AgentState.TRANSFER ||
    state === AgentState.CONFERENCE
  );
}

export function countsAsWrapUp(state: AgentState): boolean {
  return state === AgentState.WRAP_UP;
}

export function countsAsReserved(state: AgentState): boolean {
  return (
    state === AgentState.RESERVED ||
    state === AgentState.INBOUND_RESERVED ||
    state === AgentState.RINGING ||
    state === AgentState.CONNECTING
  );
}

/**
 * Eligible for predictive capacity accounting at all — logged in and working.
 * PAUSED/BREAK/TRAINING agents are logged in but not dialable, and counting
 * them would inflate the forecast.
 */
export function countsAsEligible(state: AgentState): boolean {
  return (
    countsAsAvailable(state) ||
    countsAsOnCall(state) ||
    countsAsWrapUp(state) ||
    countsAsReserved(state)
  );
}

export interface AgentRecord {
  tenantId: string;
  agentId: string;
  userId: string;
  extension: string | null;

  state: AgentState;
  previousState: AgentState | null;

  browserSessionId: string | null;
  sipRegistered: boolean;

  campaignIds: string[];
  queueIds: string[];

  currentCallId: string | null;
  currentChannelUuid: string | null;
  currentReservationId: string | null;

  lastBrowserHeartbeatAtMs: number | null;
  lastSipEventAtMs: number | null;
  lastFreeswitchEventAtMs: number | null;

  stateEnteredAtMs: number;
  wrapUpExpiresAtMs: number | null;
  pauseCode: string | null;
  maxConcurrentCalls: number;

  /** Why the service last corrected this agent, if it did. */
  lastReconciliationReason: string | null;
}

export function createAgentRecord(
  tenantId: string,
  agentId: string,
  userId: string,
  nowMs: number,
  overrides: Partial<AgentRecord> = {}
): AgentRecord {
  return {
    tenantId,
    agentId,
    userId,
    extension: null,
    state: AgentState.OFFLINE,
    previousState: null,
    browserSessionId: null,
    sipRegistered: false,
    campaignIds: [],
    queueIds: [],
    currentCallId: null,
    currentChannelUuid: null,
    currentReservationId: null,
    lastBrowserHeartbeatAtMs: null,
    lastSipEventAtMs: null,
    lastFreeswitchEventAtMs: null,
    stateEnteredAtMs: nowMs,
    wrapUpExpiresAtMs: null,
    pauseCode: null,
    maxConcurrentCalls: 1,
    lastReconciliationReason: null,
    ...overrides,
  };
}
