/**
 * inbound_route.lua, AI callbacks: a lead calling back one of the AI's caller
 * IDs is bridged to Dograh's Asterisk with the lead's own number, and a call
 * Dograh transferred to us tells the lookup so, so it is never sent back.
 */

import { describe, expect, it } from 'vitest';

import { runInboundRoute } from './helpers/lua-harness.js';

const CALLER = '+14235551212';
const BRIDGE = 'sofia/external/+18885550123@10.0.0.9:5070';

describe('inbound_route.lua AI callback', () => {
  it('bridges to Dograh with the lead as caller ID and posts no CDR', () => {
    const run = runInboundRoute({
      callerNumber: CALLER,
      lookup: { aiAgentBridge: BRIDGE, tenantId: 'agency-a', routeType: 'AI_CALLBACK' },
      bridges: [{ answer: true }],
    });
    expect(run.error).toBeNull();
    expect(run.bridges).toEqual([
      `[origination_caller_id_number=${CALLER},origination_caller_id_name=${CALLER}]${BRIDGE}`,
    ]);
    expect(run.cdrs).toEqual([]);
  });

  it('hangs up cleanly when Dograh does not take the call', () => {
    const run = runInboundRoute({
      lookup: { aiAgentBridge: BRIDGE, tenantId: 'agency-a' },
      bridges: [{ answer: false, disposition: 'NO_ROUTE_DESTINATION' }],
    });
    expect(run.error).toBeNull();
    expect(run.bridges).toHaveLength(1);
    expect(run.hangups).toEqual(['NORMAL_TEMPORARY_FAILURE']);
  });

  it('marks a Dograh transfer on the lookup so it is not routed back to the AI', () => {
    const run = runInboundRoute({
      lookup: { aiAgentBridge: '', destination: '', routeId: 'r1', noEligibleDestination: true },
      channelVars: { 'sip_h_X-Hopwhistle-Source': 'dograh-transfer' },
    });
    expect(run.lookupUrl).toContain('&via=dograh');
  });

  it('leaves an ordinary call unmarked', () => {
    const run = runInboundRoute({
      lookup: { destination: '', routeId: 'r1', noEligibleDestination: true },
    });
    expect(run.lookupUrl).not.toContain('via=dograh');
  });
});
