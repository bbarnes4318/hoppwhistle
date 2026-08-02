import { describe, expect, it } from 'vitest';

import {
  InvalidKeySegmentError,
  agentKey,
  callerIdKey,
  campaignKey,
  campaignOwnerKey,
  eventDedupeKey,
  globalKey,
  keyBelongsToTenant,
  leadLeaseKey,
  tenantNamespace,
  tenantOfKey,
} from './redis-keys.js';

describe('tenant scoping', () => {
  it('puts the tenant in the second segment of every key', () => {
    const keys = [
      tenantNamespace('t1'),
      campaignKey('t1', 'c1', 'pacing'),
      agentKey('t1', 'a1', 'state'),
      callerIdKey('t1', '+18005551212', 'usage'),
      leadLeaseKey('t1', 'l1'),
      eventDedupeKey('t1', 'e1'),
      campaignOwnerKey('t1', 'c1'),
    ];

    for (const key of keys) {
      expect(key.split(':')[0]).toBe('dialer2');
      expect(key.split(':')[1]).toBe('t1');
      expect(keyBelongsToTenant(key, 't1')).toBe(true);
      expect(keyBelongsToTenant(key, 't2')).toBe(false);
      expect(tenantOfKey(key)).toBe('t1');
    }
  });

  it('never lets one tenant collide with another', () => {
    expect(campaignKey('t1', 'c1', 'pacing')).not.toBe(campaignKey('t2', 'c1', 'pacing'));
  });
});

describe('segment validation', () => {
  it('rejects a colon, which would forge a key in another namespace', () => {
    // Without this guard, tenantId "x" + campaignId "c:../../t2:campaign" style
    // input could address another tenant's data.
    expect(() => campaignKey('t1', 'c1:evil', 'f')).toThrow(InvalidKeySegmentError);
    expect(() => tenantNamespace('t1:t2')).toThrow(InvalidKeySegmentError);
  });

  it('rejects Redis Cluster hash-tag braces', () => {
    expect(() => tenantNamespace('{t1}')).toThrow(InvalidKeySegmentError);
    expect(() => agentKey('t1', '{a}', 'state')).toThrow(InvalidKeySegmentError);
  });

  it('rejects whitespace and empty segments', () => {
    expect(() => tenantNamespace('t 1')).toThrow(InvalidKeySegmentError);
    expect(() => tenantNamespace('')).toThrow(InvalidKeySegmentError);
    expect(() => campaignKey('t1', '', 'f')).toThrow(InvalidKeySegmentError);
  });

  it('rejects an over-long segment', () => {
    expect(() => tenantNamespace('x'.repeat(129))).toThrow(InvalidKeySegmentError);
  });

  it('reserves "global" so no tenant can address platform-wide keys', () => {
    expect(() => tenantNamespace('global')).toThrow(InvalidKeySegmentError);
    expect(() => campaignKey('global', 'c1', 'f')).toThrow(InvalidKeySegmentError);
  });
});

describe('global keys', () => {
  it('are enumerated, not freely constructed', () => {
    expect(globalKey('activeCalls')).toBe('dialer2:global:active_calls');
    expect(globalKey('emergencyStop')).toBe('dialer2:global:emergency_stop');
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
  });
});
