import { describe, expect, it } from 'vitest';

import { agentPresence } from '../routes/white-label-today.js';

/**
 * The Today screen's presence buckets, without a database: white-label-today.test.ts
 * seeds agencies for the whole route, and this only needs the mapping it counts by.
 */
describe('Today: agent presence', () => {
  it("an 'on-call' agent counts as on a call", () => {
    // 'on-call' is what the softphone writes (routes/agent-phone.ts).
    expect(agentPresence('on-call')).toBe('ON_CALL');
    expect(agentPresence('on_call')).toBe('ON_CALL');
    expect(agentPresence('ON-CALL')).toBe('ON_CALL');
    expect(agentPresence('busy')).toBe('ON_CALL');
  });

  it('reads do-not-disturb as away, and anything unknown as offline', () => {
    expect(agentPresence('dnd')).toBe('AWAY');
    expect(agentPresence('away')).toBe('AWAY');
    expect(agentPresence('available')).toBe('READY');
    expect(agentPresence('ringing')).toBe('OFFLINE');
    expect(agentPresence(null)).toBe('OFFLINE');
  });
});
