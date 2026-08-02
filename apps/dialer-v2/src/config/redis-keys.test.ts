import { describe, expect, it } from 'vitest';

import {
  InvalidKeySegmentError,
  agentStateKey,
  callStateKey,
  callerIdUsageKey,
  campaignOwnerKey,
  campaignRuntimeKey,
  eventDedupeKey,
  globalKey,
  isValidTenantId,
  keyBelongsToTenant,
  leadLeaseKey,
  tenantHealthKey,
  tenantNamespace,
  tenantOfKey,
} from './redis-keys.js';

describe('layout', () => {
  it('matches the documented shape', () => {
    expect(agentStateKey('t1', 'a1')).toBe('tenant:t1:dialer:v2:agent:a1:state');
    expect(campaignRuntimeKey('t1', 'c1')).toBe('tenant:t1:dialer:v2:campaign:c1:runtime');
    expect(callStateKey('t1', 'call1')).toBe('tenant:t1:dialer:v2:call:call1:state');
    expect(eventDedupeKey('t1', 'e1')).toBe('tenant:t1:dialer:v2:events:dedupe:e1');
    expect(tenantHealthKey('t1')).toBe('tenant:t1:dialer:v2:health');
  });
});

describe('tenant scoping', () => {
  it('scopes every key to its tenant', () => {
    const keys = [
      tenantNamespace('t1'),
      agentStateKey('t1', 'a1'),
      campaignRuntimeKey('t1', 'c1'),
      campaignOwnerKey('t1', 'c1'),
      callStateKey('t1', 'call1'),
      eventDedupeKey('t1', 'e1'),
      callerIdUsageKey('t1', '+18005551212', 'hour'),
      leadLeaseKey('t1', 'lead1'),
      tenantHealthKey('t1'),
    ];

    for (const key of keys) {
      expect(key.startsWith('tenant:t1:dialer:v2')).toBe(true);
      expect(keyBelongsToTenant(key, 't1')).toBe(true);
      expect(keyBelongsToTenant(key, 't2')).toBe(false);
      expect(tenantOfKey(key)).toBe('t1');
    }
  });

  it('never lets two tenants collide', () => {
    expect(agentStateKey('t1', 'a1')).not.toBe(agentStateKey('t2', 'a1'));
  });

  it('does not let one tenant id prefix-match another', () => {
    // "t1" must not be treated as owning "t10" keys.
    expect(keyBelongsToTenant(agentStateKey('t10', 'a1'), 't1')).toBe(false);
    expect(tenantOfKey(agentStateKey('t10', 'a1'))).toBe('t10');
  });
});

describe('reserved tenant ids', () => {
  it('rejects names that would escape into the platform namespace', () => {
    for (const reserved of ['global', 'platform', 'admin', 'system', 'dialer', 'tenant']) {
      expect(() => tenantNamespace(reserved)).toThrow(InvalidKeySegmentError);
      expect(isValidTenantId(reserved)).toBe(false);
      expect(keyBelongsToTenant('tenant:global:dialer:v2:x', reserved)).toBe(false);
    }
  });

  it('rejects them case-insensitively', () => {
    expect(() => tenantNamespace('GLOBAL')).toThrow(InvalidKeySegmentError);
    expect(() => tenantNamespace('Admin')).toThrow(InvalidKeySegmentError);
  });
});

describe('delimiter injection', () => {
  it('rejects a colon, which would forge a key in another namespace', () => {
    expect(() => tenantNamespace('t1:t2')).toThrow(InvalidKeySegmentError);
    expect(() => agentStateKey('t1', 'a1:evil')).toThrow(InvalidKeySegmentError);
    expect(isValidTenantId('t1:t2')).toBe(false);
  });

  it('rejects Redis Cluster hash-tag braces', () => {
    expect(() => tenantNamespace('{t1}')).toThrow(InvalidKeySegmentError);
    expect(() => agentStateKey('t1', '{a}')).toThrow(InvalidKeySegmentError);
  });

  it('rejects glob characters that would widen a SCAN or KEYS pattern', () => {
    for (const bad of ['t*', 't?', 't[a]']) {
      expect(isValidTenantId(bad)).toBe(false);
    }
  });

  it('rejects whitespace, newlines, and empty segments', () => {
    expect(() => tenantNamespace('t 1')).toThrow(InvalidKeySegmentError);
    expect(() => tenantNamespace('t\n1')).toThrow(InvalidKeySegmentError);
    expect(() => tenantNamespace('')).toThrow(InvalidKeySegmentError);
    expect(() => agentStateKey('t1', '')).toThrow(InvalidKeySegmentError);
  });

  it('rejects an over-long segment', () => {
    expect(() => tenantNamespace('x'.repeat(129))).toThrow(InvalidKeySegmentError);
  });

  it('never throws from isValidTenantId', () => {
    for (const bad of [undefined, null, 42, {}, [], '', 'global', 'a:b']) {
      expect(() => isValidTenantId(bad)).not.toThrow();
      expect(isValidTenantId(bad)).toBe(false);
    }
  });
});

describe('global keys', () => {
  it('are enumerated, not freely constructed', () => {
    expect(globalKey('activeCalls')).toBe('dialer:v2:global:active_calls');
    expect(globalKey('emergencyStop')).toBe('dialer:v2:global:emergency_stop');
    expect(globalKey('quarantineStream')).toBe('dialer:v2:global:events:quarantine');
  });

  it('are not attributed to any tenant', () => {
    expect(tenantOfKey(globalKey('activeCalls'))).toBeNull();
    expect(keyBelongsToTenant(globalKey('activeCalls'), 'global')).toBe(false);
  });
});

describe('foreign keys', () => {
  it('are not mistaken for V2 keys', () => {
    // The Hopper's un-scoped key from CURRENT_STATE_AUDIT.md F-9.
    expect(tenantOfKey('dialer:active_calls')).toBeNull();
    expect(tenantOfKey('call:abc')).toBeNull();
    expect(tenantOfKey('tenant:t1:other:thing')).toBeNull();
    expect(tenantOfKey('')).toBeNull();
  });
});
