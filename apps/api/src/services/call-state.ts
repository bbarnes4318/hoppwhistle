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

