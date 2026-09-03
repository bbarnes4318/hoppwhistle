import { describe, it, expect } from 'vitest';

import {
  CIRCUIT_FAILURE_THRESHOLD,
  DEFAULT_PROGRESS_TIMEOUT_SECONDS,
  LEGACY_FALLBACK_GATEWAYS,
  applyOutcome,
  buildBridgeString,
  formatForGateway,
  isCarrierFault,
  normalizeNanp,
  resolveChain,
  rotatePrimaryGateways,
  type RouteRow,
  type StepRow,
} from '../index.js';

const NOW = new Date('2026-08-16T12:00:00.000Z');

function gw(name: string, over: Partial<StepRow['gateways'][number]> = {}) {
  return {
    name,
    priority: 0,
    enabled: true,
    numberFormat: 'NANP11' as const,
    circuitOpenUntil: null,
    consecutiveFailures: 0,
    ...over,
  };
}

function step(carrierCode: string, position: number, gateways: StepRow['gateways'], over: Partial<StepRow> = {}): StepRow {
  return {
    position,
    enabled: true,
    carrierCode,
    carrierName: carrierCode,
    carrierStatus: 'ACTIVE',
    gateways,
    ...over,
  };
}

function route(steps: StepRow[], over: Partial<RouteRow> = {}): RouteRow {
  return { callType: 'SOFTPHONE_MANUAL', enabled: true, legTimeoutSeconds: 20, steps, ...over };
}

describe('resolveChain ordering', () => {
  it('orders by step position, then gateway priority', () => {
    const r = route([
      step('BULKVS', 1, [gw('bulkvs')]),
      step('FRACTEL', 0, [gw('fractel2', { priority: 1 }), gw('fractel1', { priority: 0 })]),
    ]);

    expect(resolveChain(r, 'SOFTPHONE_MANUAL', NOW).gateways.map(g => g.gateway)).toEqual([
      'fractel1',
      'fractel2',
      'bulkvs',
    ]);
  });

  it('reproduces the previously hardcoded fractel1..6 chain from the seeded default', () => {
    const r = route([
      step(
        'FRACTEL',
        0,
        [1, 2, 3, 4, 5, 6].map((n, i) => gw(`fractel${n}`, { priority: i }))
      ),
      step('BULKVS', 1, [gw('bulkvs')], { enabled: false }),
    ]);

    expect(resolveChain(r, 'SOFTPHONE_MANUAL', NOW).gateways.map(g => g.gateway)).toEqual([
      ...LEGACY_FALLBACK_GATEWAYS,
    ]);
  });

  it('skips disabled steps, disabled gateways, and INACTIVE carriers', () => {
    const r = route([
      step('FRACTEL', 0, [gw('fractel1', { enabled: false }), gw('fractel2')]),
      step('BULKVS', 1, [gw('bulkvs')], { enabled: false }),
      step('TELNYX', 2, [gw('telnyx')], { carrierStatus: 'INACTIVE' }),
      step('SIGNALWIRE', 3, [gw('signalwire')]),
    ]);

    expect(resolveChain(r, 'SOFTPHONE_MANUAL', NOW).gateways.map(g => g.gateway)).toEqual([
      'fractel2',
      'signalwire',
    ]);
  });

  it('breaks position and priority ties on name so the chain is stable', () => {
    const a = resolveChain(route([step('B', 0, [gw('b')]), step('A', 0, [gw('a')])]), 'INBOUND', NOW);
    const b = resolveChain(route([step('A', 0, [gw('a')]), step('B', 0, [gw('b')])]), 'INBOUND', NOW);
    expect(a.gateways.map(g => g.gateway)).toEqual(b.gateways.map(g => g.gateway));
  });
});

describe('resolveChain circuit breaker', () => {
  const open = new Date(NOW.getTime() + 60_000).toISOString();

  it('demotes an open-circuit gateway behind healthy ones instead of dropping it', () => {
    const r = route([
      step('FRACTEL', 0, [gw('fractel1', { circuitOpenUntil: open })]),
      step('BULKVS', 1, [gw('bulkvs')]),
    ]);

    const chain = resolveChain(r, 'SOFTPHONE_MANUAL', NOW);
    expect(chain.gateways.map(g => g.gateway)).toEqual(['bulkvs', 'fractel1']);
    expect(chain.gateways.map(g => g.demoted)).toEqual([false, true]);
  });

  it('still dials when every gateway is circuit-open — degraded beats silent', () => {
    const r = route([
      step('FRACTEL', 0, [gw('fractel1', { circuitOpenUntil: open })]),
      step('BULKVS', 1, [gw('bulkvs', { circuitOpenUntil: open })]),
    ]);

    const chain = resolveChain(r, 'SOFTPHONE_MANUAL', NOW);
    expect(chain.gateways).toHaveLength(2);
    expect(chain.source).toBe('db');
  });

  it('restores full rank once the circuit window has passed', () => {
    const past = new Date(NOW.getTime() - 1000).toISOString();
    const r = route([
      step('FRACTEL', 0, [gw('fractel1', { circuitOpenUntil: past })]),
      step('BULKVS', 1, [gw('bulkvs')]),
    ]);

    expect(resolveChain(r, 'SOFTPHONE_MANUAL', NOW).gateways.map(g => g.gateway)).toEqual([
      'fractel1',
      'bulkvs',
    ]);
  });
});

describe('resolveChain fallback', () => {
  it.each([
    ['no route at all', null],
    ['a disabled route', route([step('FRACTEL', 0, [gw('fractel1')])], { enabled: false })],
    ['a route with no enabled steps', route([step('FRACTEL', 0, [gw('fractel1')], { enabled: false })])],
    ['a route whose only carrier has no enabled gateway', route([step('FRACTEL', 0, [gw('fractel1', { enabled: false })])])],
    ['a route with no steps', route([])],
  ])('falls back to the legacy chain for %s', (_label, input) => {
    const chain = resolveChain(input as RouteRow | null, 'INBOUND', NOW);
    expect(chain.source).toBe('fallback');
    expect(chain.gateways.map(g => g.gateway)).toEqual([...LEGACY_FALLBACK_GATEWAYS]);
    expect(chain.fallbackReason).toBeTruthy();
  });

  it('never returns an empty chain', () => {
    for (const input of [null, undefined, route([])]) {
      expect(resolveChain(input, 'INBOUND', NOW).gateways.length).toBeGreaterThan(0);
    }
  });
});

describe('number formatting', () => {
  it.each([
    ['+1 (281) 699-1120', '2816991120'],
    ['12816991120', '2816991120'],
    ['2816991120', '2816991120'],
    ['281-699-1120', '2816991120'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeNanp(input)).toBe(expected);
  });

  it.each([['Campaign'], [''], ['1234'], ['123456789012345678']])('rejects %s', input => {
    expect(normalizeNanp(input)).toBeNull();
  });

  it('renders each carrier format the way that carrier already received it', () => {
    expect(formatForGateway('2816991120', 'NANP11')).toBe('12816991120');
    expect(formatForGateway('2816991120', 'E164')).toBe('+12816991120');
    expect(formatForGateway('2816991120', 'NANP10')).toBe('2816991120');
  });
});

describe('buildBridgeString', () => {
  const chain = resolveChain(
    route([
      step('FRACTEL', 0, [gw('fractel1')]),
      step('SIGNALWIRE', 1, [gw('signalwire', { numberFormat: 'E164' })]),
    ]),
    'SOFTPHONE_MANUAL',
    NOW
  );

  it('joins legs with | so FreeSWITCH fails over sequentially, not in parallel', () => {
    const s = buildBridgeString(chain, '2816991120')!;
    expect(s).toContain('sofia/gateway/fractel1/12816991120|sofia/gateway/signalwire/+12816991120');
    expect(s).not.toContain(',sofia/gateway');
  });

  it('applies each gateway its own number format within one chain', () => {
    const s = buildBridgeString(chain, '2816991120')!;
    expect(s).toContain('fractel1/12816991120');
    expect(s).toContain('signalwire/+12816991120');
  });

  it('carries channel variables and a per-leg timeout', () => {
    const s = buildBridgeString(chain, '2816991120', {
      channelVariables: { origination_caller_id_number: '19138999080' },
      legTimeoutSeconds: 15,
    })!;
    expect(s.startsWith('{')).toBe(true);
    expect(s).toContain('origination_caller_id_number=19138999080');
    expect(s).toContain('call_timeout=15');
  });

  it('bounds silence separately from ringing, so a dead primary fails over fast', () => {
    // The distinction that makes an unproven carrier safe to put first: a
    // carrier that never responds is abandoned after progress_timeout, while a
    // carrier that rings gets the full call_timeout to be answered.
    const s = buildBridgeString(chain, '2816991120', { legTimeoutSeconds: 30 })!;
    expect(s).toContain('call_timeout=30');
    expect(s).toContain(`progress_timeout=${DEFAULT_PROGRESS_TIMEOUT_SECONDS}`);
    expect(DEFAULT_PROGRESS_TIMEOUT_SECONDS).toBeLessThan(30);
  });

  it('allows the silence bound to be overridden per call', () => {
    const s = buildBridgeString(chain, '2816991120', { progressTimeoutSeconds: 4 })!;
    expect(s).toContain('progress_timeout=4');
  });

  it('strips characters that would split one variable into two', () => {
    const s = buildBridgeString(chain, '2816991120', {
      channelVariables: { origination_caller_id_name: 'PVN, LLC|{evil}' },
    })!;
    expect(s).toContain('origination_caller_id_name=PVN LLCevil');
  });

  it('returns null rather than a dead bridge for a non-routable destination', () => {
    expect(buildBridgeString(chain, 'Campaign')).toBeNull();
    expect(buildBridgeString(chain, '')).toBeNull();
  });
});

describe('per-carrier caller ID', () => {
  const fractelPool = ['12816991120', '18656000124'];

  function chainWith(overrides: Partial<StepRow>[] = []) {
    return resolveChain(
      route([
        step('FRACTEL', 0, [gw('fractel1')], {
          callerIdStrategy: 'POOL',
          callerIdPool: fractelPool,
          ...overrides[0],
        }),
        step('BULKVS', 1, [gw('bulkvs')], {
          callerIdStrategy: 'POOL',
          callerIdPool: ['12816991121'],
          ...overrides[1],
        }),
      ]),
      'SOFTPHONE_MANUAL',
      NOW
    );
  }

  it('gives each carrier a caller ID it issued', () => {
    const chain = chainWith();
    expect(chain.gateways.map(g => g.callerId)).toEqual(['12816991120', '12816991121']);
  });

  it("keeps the agent's own DID when the carrier already issued it, and swaps only on failover", () => {
    // The exact regression this guards: an agent dialing manually presents the
    // number assigned to them. FracTEL issued it, so FracTEL must keep it — a
    // pool rotation here would replace the agent's number on every call.
    const chain = resolveChain(
      route([
        step('FRACTEL', 0, [gw('fractel1')], {
          callerIdStrategy: 'POOL',
          callerIdPool: ['12816991120', '18656000124'],
        }),
        step('BULKVS', 1, [gw('bulkvs')], {
          callerIdStrategy: 'POOL',
          callerIdPool: ['12816991121'],
        }),
      ]),
      'SOFTPHONE_MANUAL',
      NOW,
      { currentCallerId: '18656000124', callerIdRotation: 0 }
    );

    expect(chain.gateways[0].callerId).toBeNull(); // FracTEL keeps the agent's DID
    expect(chain.gateways[1].callerId).toBe('12816991121'); // BulkVS must swap

    const s = buildBridgeString(chain, '8005551212', {
      channelVariables: { origination_caller_id_number: '18656000124' },
    })!;
    expect(s).toContain('{origination_caller_id_number=18656000124');
    expect(s).not.toContain('[origination_caller_id_number=12816991120');
    expect(s).toContain('[origination_caller_id_number=12816991121');
  });

  it('accepts the current caller ID in any format when deciding whether to keep it', () => {
    for (const cid of ['2816991120', '12816991120', '+1 (281) 699-1120']) {
      const chain = resolveChain(
        route([
          step('FRACTEL', 0, [gw('fractel1')], {
            callerIdStrategy: 'POOL',
            callerIdPool: ['12816991120'],
          }),
        ]),
        'SOFTPHONE_MANUAL',
        NOW,
        { currentCallerId: cid }
      );
      expect(chain.gateways[0].callerId).toBeNull();
    }
  });

  it('emits the swap as a per-leg [] override, not a chain-wide {} one', () => {
    const s = buildBridgeString(chainWith(), '8005551212', {
      channelVariables: { origination_caller_id_number: '19138999080' },
    })!;
    // The call-wide caller ID stays in {}, and each leg overrides it in [].
    expect(s).toMatch(/^\{[^}]*origination_caller_id_number=19138999080[^}]*\}/);
    expect(s).toContain('[origination_caller_id_number=12816991120');
    expect(s).toContain('[origination_caller_id_number=12816991121');
    expect(s.indexOf('[origination_caller_id_number=12816991121')).toBeGreaterThan(
      s.indexOf('sofia/gateway/fractel1/')
    );
  });

  it('rewrites From as well as P-Asserted-Identity so the carrier sees one number', () => {
    const s = buildBridgeString(chainWith(), '8005551212')!;
    expect(s).toContain('sip_from_user=12816991120');
    expect(s).toContain('effective_caller_id_number=12816991120');
  });

  it('PRESERVE leaves the call-wide caller ID untouched — required for inbound legs', () => {
    const chain = chainWith([{ callerIdStrategy: 'PRESERVE' }]);
    expect(chain.gateways[0].callerId).toBeNull();
    const s = buildBridgeString(chain, '8005551212', {
      channelVariables: { origination_caller_id_number: '19138999080' },
    })!;
    expect(s).not.toContain('[origination_caller_id_number=12816991120');
    expect(s).toContain('sofia/gateway/fractel1/');
  });

  it('FIXED presents its one configured number', () => {
    const chain = chainWith([{ callerIdStrategy: 'FIXED', callerIdNumber: '(281) 699-1120' }]);
    expect(chain.gateways[0].callerId).toBe('12816991120');
  });

  it('a POOL carrier owning no DIDs falls back to the existing caller ID, never to empty', () => {
    const chain = chainWith([{ callerIdStrategy: 'POOL', callerIdPool: [] }]);
    expect(chain.gateways[0].callerId).toBeNull();
    expect(chain.gateways[0].callerIdUnavailable).toBe(true);

    const s = buildBridgeString(chain, '8005551212', {
      channelVariables: { origination_caller_id_number: '19138999080' },
    })!;
    // No empty override — an anonymous caller ID is rejected outright.
    expect(s).not.toMatch(/\[[^\]]*origination_caller_id_number=(,|\])/);
    expect(s).toContain('origination_caller_id_number=19138999080');
  });

  it('flags an unusable configured number rather than presenting garbage', () => {
    const chain = chainWith([{ callerIdStrategy: 'FIXED', callerIdNumber: 'not-a-number' }]);
    expect(chain.gateways[0].callerId).toBeNull();
    expect(chain.gateways[0].callerIdUnavailable).toBe(true);
  });

  it('holds one number for the whole of one call, and spreads across calls', () => {
    const first = resolveChain(
      route([step('FRACTEL', 0, [gw('fractel1'), gw('fractel2', { priority: 1 })], {
        callerIdStrategy: 'POOL',
        callerIdPool: fractelPool,
      })]),
      'SOFTPHONE_MANUAL',
      NOW,
      { callerIdRotation: 0 }
    );
    // Every leg of a single call presents the same number.
    expect(new Set(first.gateways.map(g => g.callerId)).size).toBe(1);

    const second = resolveChain(
      route([step('FRACTEL', 0, [gw('fractel1')], {
        callerIdStrategy: 'POOL',
        callerIdPool: fractelPool,
      })]),
      'SOFTPHONE_MANUAL',
      NOW,
      { callerIdRotation: 1 }
    );
    expect(second.gateways[0].callerId).not.toBe(first.gateways[0].callerId);
  });
});

describe('rotatePrimaryGateways', () => {
  const chain = resolveChain(
    route([
      step('FRACTEL', 0, [1, 2, 3].map((n, i) => gw(`fractel${n}`, { priority: i }))),
      step('BULKVS', 1, [gw('bulkvs')]),
    ]),
    'PREDICTIVE_DIALER',
    NOW
  );

  it('spreads load across the primary carrier without promoting a fallback', () => {
    expect(rotatePrimaryGateways(chain, 0).gateways.map(g => g.gateway)).toEqual([
      'fractel1',
      'fractel2',
      'fractel3',
      'bulkvs',
    ]);
    expect(rotatePrimaryGateways(chain, 1).gateways.map(g => g.gateway)).toEqual([
      'fractel2',
      'fractel3',
      'fractel1',
      'bulkvs',
    ]);
    expect(rotatePrimaryGateways(chain, 2).gateways.map(g => g.gateway)).toEqual([
      'fractel3',
      'fractel1',
      'fractel2',
      'bulkvs',
    ]);
  });

  it('always keeps the fallback carrier last, at every rotation', () => {
    for (let i = 0; i < 12; i++) {
      const names = rotatePrimaryGateways(chain, i).gateways.map(g => g.gateway);
      expect(names[names.length - 1]).toBe('bulkvs');
      expect(new Set(names).size).toBe(4);
    }
  });

  it('is a no-op when the primary carrier has a single gateway', () => {
    const single = resolveChain(
      route([step('SIGNALWIRE', 0, [gw('signalwire')]), step('BULKVS', 1, [gw('bulkvs')])]),
      'PREDICTIVE_DIALER',
      NOW
    );
    expect(rotatePrimaryGateways(single, 7).gateways.map(g => g.gateway)).toEqual([
      'signalwire',
      'bulkvs',
    ]);
  });

  it('handles a negative rotation without dropping a gateway', () => {
    const names = rotatePrimaryGateways(chain, -1).gateways.map(g => g.gateway);
    expect(names).toEqual(['fractel3', 'fractel1', 'fractel2', 'bulkvs']);
  });
});

describe('health folding', () => {
  it('counts carrier faults and trips at the threshold', () => {
    let state = { consecutiveFailures: 0 };
    for (let i = 1; i < CIRCUIT_FAILURE_THRESHOLD; i++) {
      const u = applyOutcome(state, { ok: false, cause: 'NETWORK_OUT_OF_ORDER' }, NOW);
      expect(u.circuitOpenUntil).toBeNull();
      state = { consecutiveFailures: u.consecutiveFailures };
    }
    const tripped = applyOutcome(state, { ok: false, cause: 'NETWORK_OUT_OF_ORDER' }, NOW);
    expect(tripped.consecutiveFailures).toBe(CIRCUIT_FAILURE_THRESHOLD);
    expect(tripped.circuitOpenUntil).toBeInstanceOf(Date);
  });

  it('does not blame the carrier for the callee hanging up or being busy', () => {
    for (const cause of ['USER_BUSY', 'NO_ANSWER', 'NORMAL_CLEARING', 'ORIGINATOR_CANCEL']) {
      expect(isCarrierFault(cause)).toBe(false);
      const u = applyOutcome({ consecutiveFailures: 3 }, { ok: false, cause }, NOW);
      expect(u.consecutiveFailures).toBe(3);
      expect(u.circuitOpenUntil).toBeNull();
    }
  });

  it('fully resets on success so unrelated failures cannot accumulate into a trip', () => {
    const u = applyOutcome({ consecutiveFailures: CIRCUIT_FAILURE_THRESHOLD - 1 }, { ok: true }, NOW);
    expect(u.consecutiveFailures).toBe(0);
    expect(u.circuitOpenUntil).toBeNull();
    expect(u.lastSuccessAt).toEqual(NOW);
  });
});

describe('per-carrier attestation', () => {
  it('sends no header for a carrier that has no attestation configured', () => {
    const chain = resolveChain(route([step('FRACTEL', 0, [gw('fractel1')])]), 'SOFTPHONE_MANUAL', NOW);

    expect(chain.gateways[0].attestation).toBeNull();
    expect(buildBridgeString(chain, '8005551212')).not.toContain('P-Attestation-Indicator');
  });

  it('claims the configured attestation on that carrier only', () => {
    const chain = resolveChain(
      route([
        step('ANVEO', 0, [gw('anveo')], { attestation: 'A' }),
        step('FRACTEL', 1, [gw('fractel1')]),
      ]),
      'SOFTPHONE_MANUAL',
      NOW
    );

    const legs = buildBridgeString(chain, '8005551212')!.split('|');
    expect(legs[0]).toContain('sip_h_P-Attestation-Indicator=A');
    // FracTEL signs from its own records; carrying the claim down the waterfall
    // would assert an attestation to a carrier that never asked for one.
    expect(legs[1]).not.toContain('P-Attestation-Indicator');
  });

  it('emits the attestation even when the carrier preserves the existing caller ID', () => {
    // The per-leg block used to exist only to carry a caller-ID override, so a
    // PRESERVE carrier had nowhere to put a header.
    const chain = resolveChain(
      route([step('ANVEO', 0, [gw('anveo')], { attestation: 'A', callerIdStrategy: 'PRESERVE' })]),
      'SOFTPHONE_MANUAL',
      NOW
    );

    expect(chain.gateways[0].callerId).toBeNull();
    expect(buildBridgeString(chain, '8005551212')).toContain('sip_h_P-Attestation-Indicator=A');
  });

  it('never asserts an attestation on the legacy fallback chain', () => {
    const chain = resolveChain(null, 'SOFTPHONE_MANUAL', NOW);

    expect(chain.gateways.every(g => g.attestation === null)).toBe(true);
    expect(buildBridgeString(chain, '8005551212')).not.toContain('P-Attestation-Indicator');
  });
});
