/**
 * inbound_route.lua, executed.
 *
 * Runs the real script in the Lua harness (helpers/lua-harness.ts) and checks
 * what it bridged and what it reported:
 *
 *   - every leg carries its per-leg routing variables;
 *   - the CDR's answeredParty is read off the leg that ANSWERED, not the plan;
 *   - an unanswered call, and a route with no eligible destination, report no
 *     answeredAt and no answering party;
 *   - our DID is presented only on external legs, the softphone shows the
 *     caller, and the softphone gets the call's id in X-Call-Id;
 *   - the script says "Hopwhistle" nowhere.
 */

import { describe, expect, it } from 'vitest';

import { inboundRouteSource, legsOf, runInboundRoute } from './helpers/lua-harness.js';

const UUID = '6f1c2d3e-aaaa-4bbb-8ccc-123456789abc';
const CALLER = '+14235551212';
const DID_CID = '18885550123';
const CONTACT = 'sofia/internal/sip:1000@10.0.0.5:5060;transport=ws';

const AGENT_LEG = '[x_leg_party=agent:agent-1,x_leg_number=1000,leg_timeout=20]1000';
const BUYER_A_LEG =
  '[x_leg_party=buyer:buyer-a,x_leg_target=ep-a,x_leg_number=+18005550100,leg_timeout=20]+18005550100';
const BUYER_B_LEG =
  '[x_leg_party=buyer:buyer-b,x_leg_target=ep-b,x_leg_number=+18005550200,leg_timeout=30]+18005550200';

function lookup(overrides: Record<string, unknown> = {}) {
  return {
    destination: '1000,+18005550100|+18005550200',
    dialString: `${AGENT_LEG},${BUYER_A_LEG}|${BUYER_B_LEG}`,
    externalGateways: 'fractel1,fractel2',
    externalBridgeTemplate: 'sofia/gateway/fractel1/1{DEST}|sofia/gateway/fractel2/1{DEST}',
    recordingEnabled: false,
    routeId: 'route-1',
    // The plan's first buyer. It must never be what the CDR credits.
    buyerId: 'buyer-a',
    targetId: 'ep-a',
    campaignId: 'campaign-1',
    tenantId: 'agency-a',
    ...overrides,
  };
}

describe('inbound_route.lua per-leg variables', () => {
  const run = runInboundRoute({
    lookup: lookup(),
    contacts: { '1000': CONTACT },
    bridges: [{ answer: false }, { answer: false }],
  });

  it('runs to completion', () => {
    expect(run.error).toBeNull();
    expect(run.bridges).toHaveLength(2);
  });

  it('tags every leg with its party, number and ring time', () => {
    const [agent, buyerA] = legsOf(run.bridges[0]);
    expect(agent.vars).toMatchObject({
      x_leg_party: 'agent:agent-1',
      x_leg_number: '1000',
      leg_timeout: '20',
    });
    expect(buyerA.vars).toMatchObject({
      x_leg_party: 'buyer:buyer-a',
      x_leg_target: 'ep-a',
      x_leg_number: '+18005550100',
      leg_timeout: '20',
    });
    for (const leg of legsOf(run.bridges[1])) {
      expect(leg.vars).toMatchObject({
        x_leg_party: 'buyer:buyer-b',
        x_leg_target: 'ep-b',
        leg_timeout: '30',
      });
    }
  });

  it('rings the registered softphone and the external number on the carrier chain', () => {
    const [agent, buyerA] = legsOf(run.bridges[0]);
    expect(agent.target).toBe(CONTACT);
    expect(buyerA.target).toBe('sofia/gateway/fractel1/18005550100');
    // A lone external leg fails over across every carrier, each leg tagged.
    expect(legsOf(run.bridges[1]).map(leg => leg.target)).toEqual([
      'sofia/gateway/fractel1/18005550200',
      'sofia/gateway/fractel2/18005550200',
    ]);
  });

  it('presents our DID only on external legs, and the caller on the softphone', () => {
    const [agent, buyerA] = legsOf(run.bridges[0]);
    expect(buyerA.vars).toMatchObject({
      sip_cid_type: 'pid',
      sip_from_user: DID_CID,
      origination_caller_id_number: DID_CID,
      effective_caller_id_number: DID_CID,
    });
    expect(agent.vars.origination_caller_id_number).toBe(CALLER);
    expect(agent.vars.origination_caller_id_name).toBe(CALLER);
    expect(Object.values(agent.vars)).not.toContain(DID_CID);
    // No bridge-wide {...} block stamps the DID on every leg.
    for (const bridge of run.bridges) expect(bridge.startsWith('{')).toBe(false);
  });

  it("sends the softphone the call's id as X-Call-Id", () => {
    const [agent, buyerA] = legsOf(run.bridges[0]);
    expect(agent.vars['sip_h_X-Call-Id']).toBe(`fs-${UUID}`);
    expect(buyerA.vars['sip_h_X-Call-Id']).toBeUndefined();
  });

  it('caps a leg timeout at the overall call timeout', () => {
    const capped = runInboundRoute({
      lookup: lookup({ dialString: BUYER_B_LEG.replace('leg_timeout=30', 'leg_timeout=600') }),
    });
    for (const leg of legsOf(capped.bridges[0])) expect(leg.vars.leg_timeout).toBe('120');
  });
});

describe('inbound_route.lua answeredParty', () => {
  it('is read off the answered channel, not taken from the plan', () => {
    const run = runInboundRoute({
      lookup: lookup(),
      contacts: { '1000': CONTACT },
      bridges: [
        { answer: false },
        {
          answer: true,
          channel: 'sofia/gateway/fractel1/18005550200',
          bUuid: 'b-leg-2',
          bVars: {
            x_leg_party: 'buyer:buyer-b',
            x_leg_number: '+18005550200',
            x_leg_target: 'ep-b',
          },
        },
      ],
    });

    expect(run.error).toBeNull();
    expect(run.cdrs).toHaveLength(1);
    expect(run.cdrs[0]).toMatchObject({
      answeredParty: 'buyer:buyer-b',
      answeredNumber: '+18005550200',
      answeredTarget: 'ep-b',
      bridgeChannelName: 'sofia/gateway/fractel1/18005550200',
    });
    expect(run.cdrs[0].answeredAt).not.toBe('');
  });

  it('credits an agent who answered in a shared step', () => {
    const run = runInboundRoute({
      lookup: lookup(),
      contacts: { '1000': CONTACT },
      bridges: [
        {
          answer: true,
          channel: CONTACT,
          bUuid: 'b-leg-1',
          bVars: { x_leg_party: 'agent:agent-1', x_leg_number: '1000' },
        },
      ],
    });
    expect(run.cdrs[0]).toMatchObject({ answeredParty: 'agent:agent-1', answeredNumber: '1000' });
  });

  it('falls back to what the leg stamped on answer when the B-leg is already gone', () => {
    const run = runInboundRoute({
      lookup: lookup(),
      contacts: { '1000': CONTACT },
      bridges: [
        {
          answer: true,
          channel: 'sofia/gateway/fractel1/18005550100',
          bUuid: 'b-leg-gone',
          stampedLeg: 'buyer:buyer-a/ep-a/+18005550100',
        },
      ],
    });
    expect(run.cdrs[0]).toMatchObject({
      answeredParty: 'buyer:buyer-a',
      answeredTarget: 'ep-a',
      answeredNumber: '+18005550100',
    });
  });

  it('stamps the answer onto our leg from every tagged leg', () => {
    const run = runInboundRoute({ lookup: lookup(), contacts: { '1000': CONTACT } });
    const [agent] = legsOf(run.bridges[0]);
    expect(agent.vars.api_on_answer).toBe(`uuid_setvar ${UUID} x_answered_leg agent:agent-1//1000`);
  });

  it('is empty, with no answeredAt, when nobody answered', () => {
    const run = runInboundRoute({
      lookup: lookup(),
      contacts: { '1000': CONTACT },
      bridges: [{ answer: false }, { answer: false }],
    });
    // The no-agent prompt answers our leg; that is not the call being answered.
    expect(run.hangups).toContain('NO_USER_RESPONSE');
    expect(run.cdrs[0]).toMatchObject({
      answeredParty: '',
      answeredNumber: '',
      answeredAt: '',
      hangupCause: 'NO_USER_RESPONSE',
    });
  });
});

describe('inbound_route.lua with no eligible destination', () => {
  it('posts a CDR with no answering party before it returns', () => {
    const run = runInboundRoute({
      lookup: lookup({ destination: '', dialString: '', noEligibleDestination: true }),
    });

    expect(run.error).toBeNull();
    expect(run.bridges).toHaveLength(0);
    expect(run.cdrs).toHaveLength(1);
    expect(run.cdrs[0]).toMatchObject({
      callId: UUID,
      routeId: 'route-1',
      tenantId: 'agency-a',
      hangupCause: 'NO_USER_RESPONSE',
      answeredAt: '',
      answeredParty: '',
      buyerId: '',
    });
  });
});

describe('inbound_route.lua against an API that sends no dialString', () => {
  it('still bridges the plain destination', () => {
    const run = runInboundRoute({
      lookup: lookup({ dialString: undefined, destination: '1000' }),
      contacts: { '1000': CONTACT },
    });
    expect(run.error).toBeNull();
    const [leg] = legsOf(run.bridges[0]);
    expect(leg.target).toBe(CONTACT);
    expect(leg.vars.x_leg_party).toBeUndefined();
    expect(leg.vars['sip_h_X-Call-Id']).toBe(`fs-${UUID}`);
  });
});

describe('inbound_route.lua source', () => {
  it('does not say "Hopwhistle" anywhere', () => {
    expect(inboundRouteSource()).not.toContain('Hopwhistle');
  });
});
