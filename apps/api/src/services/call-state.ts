import { getRedisClient } from './redis.js';

export interface CallParticipant {
  id: string;
  number: string;
  role: 'caller' | 'callee' | 'agent';
  status: 'ringing' | 'answered' | 'completed' | 'failed';
  joinedAt?: string;
  leftAt?: string;
}

export interface CallTimer {
  id: string;
  name: string;
  startedAt: string;
  duration?: number;
  completedAt?: string;
}

export interface CallState {
  id: string;
  tenantId: string;
  status: 'initiated' | 'ringing' | 'answered' | 'completed' | 'failed';
  current_node?: string;
  participants: CallParticipant[];
  timers: CallTimer[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const CALL_KEY_PREFIX = 'call:';
const CALL_TTL = 86400; // 24 hours in seconds

/**
 * Live call state, in Redis, keyed by call id.
 *
 * ── Why the key is not tenant-scoped, and what that costs ────────────────────
 *
 * A call id is a UUID and is globally unique, so `call:<id>` cannot collide
 * between agencies and the row itself carries `tenantId`. That makes the KEY
 * safe. It does not make the ACCESS safe: a call id arrives from the wire as a
 * path parameter on several agent routes, and a bare `getCallState(callId)`
 * answers for whichever agency owns it. The value here is a caller's name,
 * number and screen-pop history.
 *
 * So reads and writes reachable from a request go through the `...ForTenant`
 * variants below, which compare the stored `tenantId` against the acting tenant
 * and answer null for a mismatch -- the same answer as "no such call", so the
 * endpoint is not an existence oracle for other agencies' call ids either.
 *
 * The unguarded methods remain for the paths where the tenant is not a
 * question: the flow engine, which created the state and holds the tenant, and
 * the platform-gated demo publisher.
 */
export class CallStateService {
  private redis = getRedisClient();

  /**
   * Get call state by ID
   */
  async getCallState(callId: string): Promise<CallState | null> {
    const key = `${CALL_KEY_PREFIX}${callId}`;
    const data = await this.redis.get(key);
    if (!data) {
      return null;
    }
    return JSON.parse(data) as CallState;
  }

  /**
   * Set call state
   */
  async setCallState(callState: CallState): Promise<void> {
    const key = `${CALL_KEY_PREFIX}${callState.id}`;
    const updatedState = {
      ...callState,
      updatedAt: new Date().toISOString(),
    };
    await this.redis.setex(key, CALL_TTL, JSON.stringify(updatedState));
  }

  /**
   * Get call state, but only if it belongs to this agency.
   *
   * Null both for "no such call" and for "another agency's call": the caller
   * must not be able to tell those apart, or the route becomes a way to probe
   * which call ids exist on the platform.
   */
  async getCallStateForTenant(callId: string, tenantId: string): Promise<CallState | null> {
    const state = await this.getCallState(callId);
    if (!state) return null;
    // A state row written before this carried a tenant is not assumed to be
    // ours. Absent is a mismatch.
    if (state.tenantId !== tenantId) return null;
    return state;
  }

  /**
   * Partially update call state, but only if it belongs to this agency.
   *
   * Returns null without writing anything when it does not.
   */
  async updateCallStateForTenant(
    callId: string,
    tenantId: string,
    updates: Partial<CallState>
  ): Promise<CallState | null> {
    const existing = await this.getCallStateForTenant(callId, tenantId);
    if (!existing) return null;

    // `tenantId` is never taken from `updates`: an update must not be able to
    // move a call into another agency.
    const safeUpdates = { ...updates };
    delete safeUpdates.tenantId;
    return this.updateCallState(callId, safeUpdates);
  }

  /**
   * Update call state (partial update)
   */
  async updateCallState(
    callId: string,
    updates: Partial<CallState>
  ): Promise<CallState | null> {
    const existing = await this.getCallState(callId);
    if (!existing) {
      return null;
    }

    const updated: CallState = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.setCallState(updated);
    return updated;
  }

  /**
   * Add participant to call
   */
  async addParticipant(
    callId: string,
    participant: CallParticipant
  ): Promise<CallState | null> {
    const existing = await this.getCallState(callId);
    if (!existing) {
      return null;
    }

    const updated: CallState = {
      ...existing,
      participants: [...existing.participants, participant],
      updatedAt: new Date().toISOString(),
    };

    await this.setCallState(updated);
    return updated;
  }

  /**
   * Update participant status
   */
  async updateParticipant(
    callId: string,
    participantId: string,
    updates: Partial<CallParticipant>
  ): Promise<CallState | null> {
    const existing = await this.getCallState(callId);
    if (!existing) {
      return null;
    }

    const updated: CallState = {
      ...existing,
      participants: existing.participants.map((p) =>
        p.id === participantId ? { ...p, ...updates } : p
      ),
      updatedAt: new Date().toISOString(),
    };

    await this.setCallState(updated);
    return updated;
  }

  /**
   * Add timer to call
   */
  async addTimer(callId: string, timer: CallTimer): Promise<CallState | null> {
    const existing = await this.getCallState(callId);
    if (!existing) {
      return null;
    }

    const updated: CallState = {
      ...existing,
      timers: [...existing.timers, timer],
      updatedAt: new Date().toISOString(),
    };

    await this.setCallState(updated);
    return updated;
  }

  /**
   * Update timer
   */
  async updateTimer(
    callId: string,
    timerId: string,
    updates: Partial<CallTimer>
  ): Promise<CallState | null> {
    const existing = await this.getCallState(callId);
    if (!existing) {
      return null;
    }

    const updated: CallState = {
      ...existing,
      timers: existing.timers.map((t) =>
        t.id === timerId ? { ...t, ...updates } : t
      ),
      updatedAt: new Date().toISOString(),
    };

    await this.setCallState(updated);
    return updated;
  }

  /**
   * Update current node
   */
  async updateCurrentNode(
    callId: string,
    nodeId: string
  ): Promise<CallState | null> {
    return this.updateCallState(callId, { current_node: nodeId });
  }

  /**
   * Delete call state
   */
  async deleteCallState(callId: string): Promise<void> {
    const key = `${CALL_KEY_PREFIX}${callId}`;
    await this.redis.del(key);
  }
}

export const callStateService = new CallStateService();

