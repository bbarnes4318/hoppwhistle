import { describe, expect, it } from 'vitest';

import { AgentStateService, ReconciliationReason, type ExternalTruth } from './service.js';
import { AgentState, isTransitionAllowed } from './state.js';

const T0 = 1_800_000_000_000;

const noTruth: ExternalTruth = { liveChannelUuids: new Set(), channelOwners: new Map() };

/**
 * Ownership entries carry the tenant. Matching on agent id alone let a live
 * channel in one tenant mark a same-named agent in another as ON_CALL.
 */
function truthWith(
  uuids: string[],
  owners: Array<[string, string]> = [],
  tenantId = 'tenant-a'
): ExternalTruth {
  return {
    liveChannelUuids: new Set(uuids),
    channelOwners: new Map(
      owners.map(([uuid, agentId]) => [
        uuid,
        { tenantId, agentId, channelUuid: uuid, callId: null, observedAtMs: T0 },
      ])
    ),
  };
}

function serviceWithAgent(state = AgentState.AVAILABLE, overrides = {}) {
  const svc = new AgentStateService({ heartbeatTimeoutMs: 30_000, sipGracePeriodMs: 10_000 });
  svc.upsertAgent('tenant-a', 'agent-1', 'user-1', T0, {
    state,
    sipRegistered: true,
    lastBrowserHeartbeatAtMs: T0,
    lastSipEventAtMs: T0,
    browserSessionId: 'session-1',
    campaignIds: ['camp-1'],
    ...overrides,
  });
  return svc;
}

describe('state transitions', () => {
  it('permits the documented happy path', () => {
    expect(isTransitionAllowed(AgentState.OFFLINE, AgentState.AUTHENTICATING)).toBe(true);
    expect(isTransitionAllowed(AgentState.AUTHENTICATING, AgentState.AVAILABLE)).toBe(true);
    expect(isTransitionAllowed(AgentState.AVAILABLE, AgentState.RESERVED)).toBe(true);
    expect(isTransitionAllowed(AgentState.RESERVED, AgentState.RINGING)).toBe(true);
    expect(isTransitionAllowed(AgentState.RINGING, AgentState.ON_CALL)).toBe(true);
    expect(isTransitionAllowed(AgentState.ON_CALL, AgentState.WRAP_UP)).toBe(true);
    expect(isTransitionAllowed(AgentState.WRAP_UP, AgentState.AVAILABLE)).toBe(true);
  });

  it('rejects nonsensical transitions', () => {
    expect(isTransitionAllowed(AgentState.OFFLINE, AgentState.ON_CALL)).toBe(false);
    expect(isTransitionAllowed(AgentState.LOGGING_OUT, AgentState.ON_CALL)).toBe(false);
    expect(isTransitionAllowed(AgentState.WRAP_UP, AgentState.ON_CALL)).toBe(false);
  });

  it('leaves the record untouched when a transition is refused', () => {
    const svc = serviceWithAgent(AgentState.OFFLINE);
    expect(svc.transition('tenant-a', 'agent-1', AgentState.ON_CALL, T0)).toBe(false);
    expect(svc.get('tenant-a', 'agent-1')?.state).toBe(AgentState.OFFLINE);
  });

  it('records the previous state and entry time', () => {
    const svc = serviceWithAgent(AgentState.AVAILABLE);
    svc.transition('tenant-a', 'agent-1', AgentState.RESERVED, T0 + 5_000);
    const record = svc.get('tenant-a', 'agent-1');
    expect(record?.previousState).toBe(AgentState.AVAILABLE);
    expect(record?.stateEnteredAtMs).toBe(T0 + 5_000);
  });

  it('allows STALE to recover', () => {
    expect(isTransitionAllowed(AgentState.STALE, AgentState.AUTHENTICATING)).toBe(true);
  });
});

describe('heartbeat expiry', () => {
  it('marks an agent STALE once the browser stops reporting', () => {
    const svc = serviceWithAgent(AgentState.AVAILABLE);
    const corrections = svc.reconcile(T0 + 31_000, noTruth);

    expect(corrections).toHaveLength(1);
    expect(corrections[0].reason).toBe(ReconciliationReason.HEARTBEAT_EXPIRED);
    expect(svc.get('tenant-a', 'agent-1')?.state).toBe(AgentState.STALE);
  });

  it('leaves a healthy agent alone', () => {
    const svc = serviceWithAgent(AgentState.AVAILABLE);
    expect(svc.reconcile(T0 + 5_000, noTruth)).toHaveLength(0);
  });

  it('treats an agent that never sent a heartbeat as stale', () => {
    const svc = serviceWithAgent(AgentState.AVAILABLE, { lastBrowserHeartbeatAtMs: null });
    const corrections = svc.reconcile(T0, noTruth);
    expect(corrections[0].reason).toBe(ReconciliationReason.HEARTBEAT_EXPIRED);
    expect(corrections[0].detail).toContain('never received');
  });
});

describe('SIP contradiction', () => {
  it('withdraws an AVAILABLE agent whose SIP registration is gone', () => {
    const svc = serviceWithAgent(AgentState.AVAILABLE, {
      sipRegistered: false,
      lastSipEventAtMs: T0 - 20_000,
    });
    const corrections = svc.reconcile(T0, noTruth);

    expect(corrections[0].reason).toBe(ReconciliationReason.BROWSER_AVAILABLE_BUT_SIP_UNREGISTERED);
    expect(svc.get('tenant-a', 'agent-1')?.state).toBe(AgentState.STALE);
  });

  it('respects the grace period for a brief re-registration', () => {
    const svc = serviceWithAgent(AgentState.AVAILABLE, {
      sipRegistered: false,
      lastSipEventAtMs: T0 - 1_000,
    });
    expect(svc.reconcile(T0, noTruth)).toHaveLength(0);
  });
});

describe('FreeSWITCH contradiction', () => {
  it('moves an agent out of ON_CALL when the channel is gone', () => {
    const svc = serviceWithAgent(AgentState.ON_CALL, {
      currentChannelUuid: 'chan-1',
      currentCallId: 'call-1',
    });
    const corrections = svc.reconcile(T0, truthWith([]));

    expect(corrections[0].reason).toBe(ReconciliationReason.ASSIGNED_CALL_NO_LONGER_EXISTS);
    expect(svc.get('tenant-a', 'agent-1')?.state).toBe(AgentState.WRAP_UP);
    expect(svc.get('tenant-a', 'agent-1')?.currentChannelUuid).toBeNull();
  });

  it('flags ON_CALL with no channel recorded at all', () => {
    const svc = serviceWithAgent(AgentState.ON_CALL, { currentChannelUuid: null });
    const corrections = svc.reconcile(T0, noTruth);
    expect(corrections[0].reason).toBe(ReconciliationReason.BROWSER_ON_CALL_BUT_NO_CHANNEL);
  });

  it('moves an AVAILABLE agent to ON_CALL when FreeSWITCH says they own a live channel', () => {
    // Counting this agent as capacity would dial for someone already talking.
    const svc = serviceWithAgent(AgentState.AVAILABLE);
    const corrections = svc.reconcile(T0, truthWith(['chan-9'], [['chan-9', 'agent-1']]));

    expect(corrections[0].reason).toBe(
      ReconciliationReason.CHANNEL_EXISTS_BUT_AGENT_STATE_AVAILABLE
    );
    expect(svc.get('tenant-a', 'agent-1')?.state).toBe(AgentState.ON_CALL);
    expect(svc.get('tenant-a', 'agent-1')?.currentChannelUuid).toBe('chan-9');
  });

  it('leaves an ON_CALL agent alone while the channel is live', () => {
    const svc = serviceWithAgent(AgentState.ON_CALL, { currentChannelUuid: 'chan-1' });
    expect(svc.reconcile(T0, truthWith(['chan-1']))).toHaveLength(0);
  });
});

describe('duplicate sessions', () => {
  it('withdraws capacity when a second browser session claims the same agent', () => {
    const svc = serviceWithAgent(AgentState.AVAILABLE);
    const result = svc.heartbeat('tenant-a', 'agent-1', 'session-2', T0 + 1_000);

    expect(result.duplicateSession).toBe(true);
    expect(svc.get('tenant-a', 'agent-1')?.state).toBe(AgentState.STALE);
    expect(svc.recentCorrections()[0].reason).toBe(ReconciliationReason.DUPLICATE_ACTIVE_SESSION);
  });

  it('accepts repeat heartbeats from the same session', () => {
    const svc = serviceWithAgent(AgentState.AVAILABLE);
    const result = svc.heartbeat('tenant-a', 'agent-1', 'session-1', T0 + 1_000);
    expect(result.duplicateSession).toBe(false);
    expect(svc.get('tenant-a', 'agent-1')?.state).toBe(AgentState.AVAILABLE);
  });
});

describe('wrap-up expiry', () => {
  it('returns the agent to AVAILABLE when the timer elapses', () => {
    const svc = serviceWithAgent(AgentState.WRAP_UP, { wrapUpExpiresAtMs: T0 + 1_000 });
    const corrections = svc.reconcile(T0 + 2_000, noTruth);
    expect(corrections[0].reason).toBe(ReconciliationReason.WRAP_UP_EXPIRED);
    expect(svc.get('tenant-a', 'agent-1')?.state).toBe(AgentState.AVAILABLE);
  });

  it('waits while the timer is still running', () => {
    const svc = serviceWithAgent(AgentState.WRAP_UP, { wrapUpExpiresAtMs: T0 + 10_000 });
    expect(svc.reconcile(T0 + 1_000, noTruth)).toHaveLength(0);
  });
});

describe('cross-tenant protection', () => {
  it('rejects an unusable tenant id outright', () => {
    const svc = new AgentStateService();
    expect(svc.upsertAgent('global', 'agent-1', 'u', T0)).toBeNull();
    expect(svc.upsertAgent('tenant:evil', 'agent-1', 'u', T0)).toBeNull();
    expect(svc.upsertAgent('', 'agent-1', 'u', T0)).toBeNull();
    expect(svc.size()).toBe(0);
  });

  it('keeps identically named agents in different tenants separate', () => {
    const svc = new AgentStateService();
    svc.upsertAgent('tenant-a', 'agent-1', 'u1', T0, { state: AgentState.AVAILABLE });
    svc.upsertAgent('tenant-b', 'agent-1', 'u2', T0, { state: AgentState.ON_CALL });

    expect(svc.get('tenant-a', 'agent-1')?.state).toBe(AgentState.AVAILABLE);
    expect(svc.get('tenant-b', 'agent-1')?.state).toBe(AgentState.ON_CALL);
    expect(svc.listForTenant('tenant-a')).toHaveLength(1);
  });

  it('never counts another tenant agents as capacity', () => {
    const svc = new AgentStateService();
    for (let i = 0; i < 5; i++) {
      svc.upsertAgent('tenant-b', `agent-${i}`, 'u', T0, {
        state: AgentState.AVAILABLE,
        lastBrowserHeartbeatAtMs: T0,
      });
    }
    expect(svc.capacity('tenant-a', T0).available).toBe(0);
    expect(svc.capacity('tenant-b', T0).available).toBe(5);
  });
});

describe('capacity accounting', () => {
  function populated() {
    const svc = new AgentStateService();
    const add = (id: string, state: AgentState) =>
      svc.upsertAgent('tenant-a', id, 'u', T0, {
        state,
        lastBrowserHeartbeatAtMs: T0,
        sipRegistered: true,
        campaignIds: ['camp-1'],
      });
    add('a1', AgentState.AVAILABLE);
    add('a2', AgentState.AVAILABLE);
    add('a3', AgentState.ON_CALL);
    add('a4', AgentState.WRAP_UP);
    add('a5', AgentState.RESERVED);
    add('a6', AgentState.STALE);
    add('a7', AgentState.PAUSED);
    add('a8', AgentState.OFFLINE);
    return svc;
  }

  it('counts each category correctly', () => {
    const c = populated().capacity('tenant-a', T0);
    expect(c.available).toBe(2);
    expect(c.onCall).toBe(1);
    expect(c.wrapUp).toBe(1);
    expect(c.reserved).toBe(1);
    expect(c.stale).toBe(1);
    expect(c.paused).toBe(1);
    // Eligible = available + onCall + wrapUp + reserved. Never stale, paused,
    // or offline.
    expect(c.eligible).toBe(5);
  });

  it('excludes stale agents from predictive capacity', () => {
    const svc = populated();
    const before = svc.capacity('tenant-a', T0).available;
    svc.reconcile(T0 + 60_000, noTruth);
    const after = svc.capacity('tenant-a', T0 + 60_000);

    expect(before).toBe(2);
    expect(after.available).toBe(0);
    expect(after.eligible).toBe(0);
    expect(after.stale).toBeGreaterThan(0);
  });

  it('scopes to a campaign when asked', () => {
    const svc = new AgentStateService();
    svc.upsertAgent('tenant-a', 'a1', 'u', T0, {
      state: AgentState.AVAILABLE,
      lastBrowserHeartbeatAtMs: T0,
      campaignIds: ['camp-1'],
    });
    svc.upsertAgent('tenant-a', 'a2', 'u', T0, {
      state: AgentState.AVAILABLE,
      lastBrowserHeartbeatAtMs: T0,
      campaignIds: ['camp-2'],
    });

    expect(svc.capacity('tenant-a', T0, 'camp-1').available).toBe(1);
    expect(svc.capacity('tenant-a', T0).available).toBe(2);
  });
});

describe('correction audit trail', () => {
  it('records an explanation for every automatic correction', () => {
    const svc = serviceWithAgent(AgentState.AVAILABLE);
    svc.reconcile(T0 + 60_000, noTruth);

    const corrections = svc.recentCorrections();
    expect(corrections).toHaveLength(1);
    expect(corrections[0].detail.length).toBeGreaterThan(0);
    expect(corrections[0].fromState).toBe(AgentState.AVAILABLE);
    expect(corrections[0].toState).toBe(AgentState.STALE);
    expect(svc.get('tenant-a', 'agent-1')?.lastReconciliationReason).toBe(
      ReconciliationReason.HEARTBEAT_EXPIRED
    );
  });

  it('uses the documented machine-readable reason strings', () => {
    expect(ReconciliationReason.BROWSER_AVAILABLE_BUT_SIP_UNREGISTERED).toBe(
      'browser_available_but_sip_unregistered'
    );
    expect(ReconciliationReason.BROWSER_ON_CALL_BUT_NO_CHANNEL).toBe(
      'browser_on_call_but_no_channel'
    );
    expect(ReconciliationReason.CHANNEL_EXISTS_BUT_AGENT_STATE_AVAILABLE).toBe(
      'channel_exists_but_agent_state_available'
    );
    expect(ReconciliationReason.HEARTBEAT_EXPIRED).toBe('heartbeat_expired');
    expect(ReconciliationReason.DUPLICATE_ACTIVE_SESSION).toBe('duplicate_active_session');
    expect(ReconciliationReason.UNKNOWN_TENANT).toBe('unknown_tenant');
    expect(ReconciliationReason.UNRESOLVED_CHANNEL_OWNER).toBe('unresolved_channel_owner');
  });

  it('bounds the correction history', () => {
    const svc = new AgentStateService({ maxCorrectionHistory: 5, heartbeatTimeoutMs: 1 });
    for (let i = 0; i < 20; i++) {
      svc.upsertAgent('tenant-a', `agent-${i}`, 'u', T0, {
        state: AgentState.AVAILABLE,
        lastBrowserHeartbeatAtMs: T0,
      });
    }
    svc.reconcile(T0 + 10_000, noTruth);
    expect(svc.recentCorrections(100).length).toBeLessThanOrEqual(5);
  });

  it('never lets an observer block a safety correction', () => {
    const svc = new AgentStateService({
      heartbeatTimeoutMs: 1,
      onCorrection: () => {
        throw new Error('observer exploded');
      },
    });
    svc.upsertAgent('tenant-a', 'a1', 'u', T0, {
      state: AgentState.AVAILABLE,
      lastBrowserHeartbeatAtMs: T0,
    });
    expect(() => svc.reconcile(T0 + 10_000, noTruth)).not.toThrow();
    expect(svc.get('tenant-a', 'a1')?.state).toBe(AgentState.STALE);
  });
});

describe('channel ownership is tenant-scoped', () => {
  it('ignores a live channel owned by the same agent id in another tenant', () => {
    // Agent ids are unique within a tenant, not across the platform.
    const svc = serviceWithAgent(AgentState.AVAILABLE);
    const corrections = svc.reconcile(
      T0 + 1_000,
      truthWith(['uuid-b'], [['uuid-b', 'agent-1']], 'tenant-b')
    );

    expect(corrections).toHaveLength(0);
    expect(svc.get('tenant-a', 'agent-1')?.state).toBe(AgentState.AVAILABLE);
  });

  it('still moves the agent when the channel belongs to their own tenant', () => {
    const svc = serviceWithAgent(AgentState.AVAILABLE);
    svc.reconcile(T0 + 1_000, truthWith(['uuid-a'], [['uuid-a', 'agent-1']], 'tenant-a'));
    expect(svc.get('tenant-a', 'agent-1')?.state).toBe(AgentState.ON_CALL);
  });

  it('does not hold an agent ON_CALL against another tenant’s live channel', () => {
    // The agent cannot hang up a channel that is not theirs, so treating it as
    // theirs would pin them out of capacity indefinitely.
    const svc = serviceWithAgent(AgentState.ON_CALL, { currentChannelUuid: 'uuid-x' });
    svc.reconcile(T0 + 1_000, truthWith(['uuid-x'], [['uuid-x', 'agent-1']], 'tenant-b'));

    expect(svc.get('tenant-a', 'agent-1')?.state).toBe(AgentState.WRAP_UP);
  });
});

describe('the cache can be rebuilt from durable state', () => {
  it('hydrates records and drops ones with an unusable tenant', () => {
    const svc = new AgentStateService();
    const loaded = svc.hydrate([
      { tenantId: 'tenant-a', agentId: 'agent-1', state: AgentState.AVAILABLE },
      { tenantId: 'global', agentId: 'agent-2', state: AgentState.AVAILABLE },
    ] as never);

    expect(loaded).toBe(1);
    expect(svc.get('tenant-a', 'agent-1')?.state).toBe(AgentState.AVAILABLE);
  });

  it('adopts the authoritative record after a refused write', () => {
    const svc = serviceWithAgent(AgentState.AVAILABLE);
    svc.adopt({
      ...svc.get('tenant-a', 'agent-1')!,
      revision: 12,
      state: AgentState.ON_CALL,
    });

    expect(svc.get('tenant-a', 'agent-1')?.revision).toBe(12);
    expect(svc.get('tenant-a', 'agent-1')?.state).toBe(AgentState.ON_CALL);
  });
});
