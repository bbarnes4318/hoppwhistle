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
    const chain = resolveChain(input, 'INBOUND', NOW);
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

describe('Twilio and Vonage legs', () => {
  // The two carriers disagree about the destination format and each rejects
  // the other's spelling: Twilio wants sip:+1XXXXXXXXXX@<trunk>.pstn.twilio.com
  // and answers 404 to a bare 1XXXXXXXXXX; Vonage wants 1XXXXXXXXXX and
  // rejects the `+`. Getting this wrong produces a dead call on a carrier that
  // is perfectly healthy, which is the hardest kind to diagnose — so the
  // seeded formats are pinned here.
  const chain = resolveChain(
    route([
      step('TWILIO', 0, [gw('twilio', { numberFormat: 'E164' })], {
        callerIdStrategy: 'POOL',
        callerIdPool: ['12816991130'],
      }),
      step('VONAGE', 1, [gw('vonage', { numberFormat: 'NANP11' })], {
        callerIdStrategy: 'POOL',
        callerIdPool: ['12816991131'],
      }),
    ]),
    'SOFTPHONE_MANUAL',
    NOW
  );

  it('dials Twilio in E.164 and Vonage without the plus', () => {
    const s = buildBridgeString(chain, '2816991120')!;
    expect(s).toContain('sofia/gateway/twilio/+12816991120');
    expect(s).toContain('sofia/gateway/vonage/12816991120');
    expect(s).not.toContain('vonage/+1');
  });

  // Both carriers refuse an outbound call whose From number the account does
  // not own, so a leg that falls to either has to bring its own caller ID
  // rather than carry the previous carrier's DID across.
  it('presents each carrier a number it issued', () => {
    expect(chain.gateways.map(g => g.callerId)).toEqual(['12816991130', '12816991131']);

    const s = buildBridgeString(chain, '2816991120')!;
    expect(s).toContain('[origination_caller_id_number=12816991130');
    expect(s).toContain('[origination_caller_id_number=12816991131');
  });

  // An account with no DIDs at either carrier is the state right after the
  // credentials are set up. The resolver must not emit an empty caller ID —
  // carriers reject anonymous origination outright — and must flag it so the
  // settings page can warn before the carrier is switched on.
  it('flags a carrier that owns no numbers instead of sending an empty caller ID', () => {
    const bare = resolveChain(
      route([
        step('TWILIO', 0, [gw('twilio', { numberFormat: 'E164' })], {
          callerIdStrategy: 'POOL',
          callerIdPool: [],
        }),
      ]),
      'SOFTPHONE_MANUAL',
      NOW
    );

    expect(bare.gateways[0].callerId).toBeNull();
    expect(bare.gateways[0].callerIdUnavailable).toBe(true);
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

describe('tech prefix', () => {
  it('prepends the prefix to the formatted number, keeping the country code', () => {
    // The historical Anveo dial string was 0123451XXXXXXXXXX: prefix, then the
    // NANP11 number. The trailing 1 is the country code, not part of the prefix.
    expect(formatForGateway('8653173943', 'NANP11', '012345')).toBe('01234518653173943');
  });

  it('drops the plus when a prefixed carrier uses E164', () => {
    // A `+` in the middle of a dial string is not a number any carrier parses.
    expect(formatForGateway('8653173943', 'E164', '012345')).toBe('01234518653173943');
  });

  it('leaves the number alone when no prefix is configured', () => {
    expect(formatForGateway('8653173943', 'NANP11', null)).toBe('18653173943');
    expect(formatForGateway('8653173943', 'NANP11', '')).toBe('18653173943');
    expect(formatForGateway('8653173943', 'NANP11')).toBe('18653173943');
  });

  it('dials the prefix on that gateway only', () => {
    const chain = resolveChain(
      route([
        step('ANVEO', 0, [gw('anveo', { techPrefix: '012345' })]),
        step('FRACTEL', 1, [gw('fractel1')]),
      ]),
      'SOFTPHONE_MANUAL',
      NOW
    );

    const legs = buildBridgeString(chain, '8653173943')!.split('|');
    expect(legs[0]).toContain('sofia/gateway/anveo/01234518653173943');
    expect(legs[1]).toContain('sofia/gateway/fractel1/18653173943');
  });

  it('never prefixes the legacy fallback chain', () => {
    const bridge = buildBridgeString(resolveChain(null, 'SOFTPHONE_MANUAL', NOW), '8653173943')!;

    expect(bridge).toContain('sofia/gateway/fractel1/18653173943');
    expect(bridge).not.toContain('012345');
  });

  it('does not put the prefix on the caller ID', () => {
    const chain = resolveChain(
      route([
        step('ANVEO', 0, [gw('anveo', { techPrefix: '012345' })], {
          callerIdStrategy: 'FIXED',
          callerIdNumber: '18652809893',
        }),
      ]),
      'SOFTPHONE_MANUAL',
      NOW
    );

    const bridge = buildBridgeString(chain, '8653173943')!;
    expect(bridge).toContain('origination_caller_id_number=18652809893');
    expect(bridge).toContain('sofia/gateway/anveo/01234518653173943');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Vonage as a first-class carrier
// ────────────────────────────────────────────────────────────────────────────

describe('Vonage in a mixed waterfall', () => {
  // Every carrier the platform runs, each in the spelling its trunk accepts,
  // inside ONE chain — the property that lets a call fall from one carrier to
  // the next without the fallback being a dead call in the wrong format.
  const mixed = resolveChain(
    route([
      step('TWILIO', 0, [gw('twilio', { numberFormat: 'E164' })], {
        callerIdStrategy: 'POOL',
        callerIdPool: ['+12816991130'],
      }),
      step('VONAGE', 1, [gw('vonage', { numberFormat: 'NANP11' })], {
        callerIdStrategy: 'POOL',
        callerIdPool: ['+14155550101', '+14155550100'],
      }),
      step('FRACTEL', 2, [gw('fractel1'), gw('fractel2', { priority: 1 })]),
      step('ANVEO', 3, [gw('anveo', { techPrefix: '012345' })]),
      step('TELNYX', 4, [gw('telnyx', { numberFormat: 'E164' })]),
      step('BULKVS', 5, [gw('bulkvs')]),
      step('SIGNALWIRE', 6, [gw('signalwire', { numberFormat: 'E164' })]),
    ]),
    'CC_POWER_DIALER',
    NOW,
    { callerIdRotation: 0, currentCallerId: '19138999080' }
  );
  const legs = buildBridgeString(mixed, '(281) 699-1120', {
    channelVariables: { origination_caller_id_number: '19138999080' },
  })!.split('|');

  it('dials every carrier in its own format within one attempt chain', () => {
    expect(legs[0]).toMatch(/sofia\/gateway\/twilio\/\+12816991120$/);
    expect(legs[1]).toMatch(/sofia\/gateway\/vonage\/12816991120$/);
    expect(legs[2]).toMatch(/sofia\/gateway\/fractel1\/12816991120$/);
    expect(legs[3]).toMatch(/sofia\/gateway\/fractel2\/12816991120$/);
    expect(legs[4]).toMatch(/sofia\/gateway\/anveo\/01234512816991120$/);
    expect(legs[5]).toMatch(/sofia\/gateway\/telnyx\/\+12816991120$/);
    expect(legs[6]).toMatch(/sofia\/gateway\/bulkvs\/12816991120$/);
    expect(legs[7]).toMatch(/sofia\/gateway\/signalwire\/\+12816991120$/);
  });

  it('never sends Vonage a plus, in the destination or the caller ID', () => {
    expect(legs[1]).not.toContain('+');
    expect(legs[1]).toContain('sip_from_user=14155550100');
    expect(legs[1]).toContain('origination_caller_id_number=14155550100');
  });

  it("hands Vonage its own number and the next carrier its own strategy's", () => {
    expect(mixed.gateways.map(g => [g.carrierCode, g.callerId])).toEqual([
      ['TWILIO', '12816991130'],
      ['VONAGE', '14155550100'],
      ['FRACTEL', null],
      ['FRACTEL', null],
      ['ANVEO', null],
      ['TELNYX', null],
      ['BULKVS', null],
      ['SIGNALWIRE', null],
    ]);
    // The PRESERVE carriers after Vonage carry no override, so they present
    // the call's own number again rather than inheriting Vonage's.
    expect(legs[2]).not.toContain('origination_caller_id_number');
  });

  it('dials the legs sequentially — never ringing carriers in parallel', () => {
    const bridge = buildBridgeString(mixed, '2816991120')!;
    const outsideBlocks = bridge.replace(/\{[^}]*\}|\[[^\]]*\]/g, '');
    expect(outsideBlocks).not.toContain(',');
    expect(outsideBlocks.split('|')).toHaveLength(8);
  });
});

describe('Vonage caller ID', () => {
  const vonageStep = (over: Partial<StepRow> = {}) =>
    step('VONAGE', 0, [gw('vonage')], {
      callerIdStrategy: 'POOL',
      callerIdPool: ['+14155550100', '+14155550101', '+14155550102'],
      ...over,
    });

  it("keeps an agent's own DID when Vonage issued it", () => {
    const chain = resolveChain(route([vonageStep()]), 'SOFTPHONE_MANUAL', NOW, {
      currentCallerId: '(415) 555-0101',
    });
    expect(chain.gateways[0].callerId).toBeNull();
    expect(buildBridgeString(chain, '8005551212')).not.toContain('[origination_caller_id_number');
  });

  it("replaces another carrier's DID with one of Vonage's, rotating across calls", () => {
    const seen = [0, 1, 2, 3].map(
      r =>
        resolveChain(route([vonageStep()]), 'PREDICTIVE_DIALER', NOW, {
          callerIdRotation: r,
          currentCallerId: '12816991120',
        }).gateways[0].callerId
    );
    expect(seen).toEqual(['14155550100', '14155550101', '14155550102', '14155550100']);
  });

  it('flags a Vonage carrier that has no number of its own instead of handing it a foreign DID', () => {
    const chain = resolveChain(route([vonageStep({ callerIdPool: [] })]), 'CC_MANUAL', NOW, {
      currentCallerId: '12816991120',
    });
    expect(chain.gateways[0].callerId).toBeNull();
    expect(chain.gateways[0].callerIdUnavailable).toBe(true);
  });

  it('sends no attestation header unless one is configured for Vonage', () => {
    const plain = resolveChain(route([vonageStep()]), 'CC_MANUAL', NOW);
    expect(buildBridgeString(plain, '8005551212')).not.toContain('P-Attestation-Indicator');
  });
});

describe('Vonage failover and circuit breaking', () => {
  const steps = (vonageOpenUntil: Date | null) =>
    route([
      step('VONAGE', 0, [gw('vonage', { circuitOpenUntil: vonageOpenUntil })], {
        callerIdStrategy: 'POOL',
        callerIdPool: ['14155550100'],
      }),
      step('FRACTEL', 1, [gw('fractel1')]),
    ]);

  it('tries Vonage first and FracTEL after it when Vonage is primary', () => {
    expect(resolveChain(steps(null), 'PREDICTIVE_DIALER', NOW).gateways.map(g => g.gateway)).toEqual([
      'vonage',
      'fractel1',
    ]);
  });

  it('tries Vonage after FracTEL when Vonage is the fallback', () => {
    const r = steps(null);
    r.steps[0].position = 5;
    expect(resolveChain(r, 'PREDICTIVE_DIALER', NOW).gateways.map(g => g.gateway)).toEqual([
      'fractel1',
      'vonage',
    ]);
  });

  it('demotes Vonage behind FracTEL while its circuit is open, without touching FracTEL', () => {
    let health = { consecutiveFailures: 0 };
    let openUntil: Date | null = null;
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) {
      const update = applyOutcome(health, { ok: false, cause: 'NORMAL_TEMPORARY_FAILURE' }, NOW);
      health = { consecutiveFailures: update.consecutiveFailures };
      openUntil = update.circuitOpenUntil;
    }
    expect(openUntil).not.toBeNull();

    const chain = resolveChain(steps(openUntil), 'PREDICTIVE_DIALER', NOW);
    expect(chain.gateways.map(g => [g.gateway, g.demoted])).toEqual([
      ['fractel1', false],
      ['vonage', true],
    ]);
  });

  it('counts carrier-side failures — auth, 5xx, timeouts, network, no route, no progress', () => {
    for (const cause of [
      'CALL_REJECTED', // 401/403/407: the trunk refused our credentials or IP
      'NORMAL_TEMPORARY_FAILURE', // 500/503
      'NETWORK_OUT_OF_ORDER', // 502
      'RECOVERY_ON_TIMER_EXPIRE', // 408/504 or no response
      'DESTINATION_OUT_OF_ORDER',
      'NO_ROUTE_DESTINATION',
      'GATEWAY_DOWN',
      'INVALID_GATEWAY',
      'PROGRESS_TIMEOUT',
      'SERVICE_NOT_IMPLEMENTED', // 501
      'INTERWORKING',
      'NORMAL_CIRCUIT_CONGESTION',
    ]) {
      expect(isCarrierFault(cause), cause).toBe(true);
    }
  });

  it('never counts what the callee did as a carrier outage', () => {
    for (const cause of [
      'USER_BUSY',
      'NO_ANSWER',
      'NO_USER_RESPONSE',
      'ORIGINATOR_CANCEL',
      'NORMAL_CLEARING',
      'UNALLOCATED_NUMBER',
      'LOSE_RACE',
    ]) {
      expect(isCarrierFault(cause), cause).toBe(false);
      expect(applyOutcome({ consecutiveFailures: 4 }, { ok: false, cause }, NOW)).toMatchObject({
        consecutiveFailures: 4,
        circuitOpenUntil: null,
      });
    }
  });
});

describe('leg outcome reporting', () => {
  const chain = resolveChain(
    route([
      step('VONAGE', 0, [gw('vonage')], { callerIdStrategy: 'POOL', callerIdPool: ['14155550100'] }),
      step('FRACTEL', 1, [gw('fractel1')]),
    ]),
    'SOFTPHONE_MANUAL',
    NOW
  );

  it('is off unless asked for, so existing dial strings are unchanged', () => {
    const s = buildBridgeString(chain, '8005551212')!;
    expect(s).not.toContain('api_reporting_hook');
    expect(s).not.toContain('hopwhistle_gateway');
  });

  it('tags every leg with its own gateway and carrier and reports from the reporting hook', () => {
    const s = buildBridgeString(chain, '8005551212', {
      legOutcomeReporting: true,
      channelVariables: { hopwhistle_tenant_id: 't-1', hopwhistle_corr: 'abc' },
    })!;
    expect(s).toMatch(/^\{[^}]*api_reporting_hook=lua carrier_leg_result\.lua[^}]*\}/);
    // Reported at answer too, before the hangup handler rewrites the call row.
    expect(s).toMatch(/^\{[^}]*execute_on_answer=lua carrier_leg_result\.lua answer[^}]*\}/);
    const legs = s.split('|');
    expect(legs[0]).toContain('hopwhistle_gateway=vonage');
    expect(legs[0]).toContain('hopwhistle_carrier=VONAGE');
    expect(legs[1]).toContain('[hopwhistle_carrier=FRACTEL,hopwhistle_gateway=fractel1]');
  });

  // The recording upload rides on api_hangup_hook and that variable holds one
  // value; a second writer would silently stop recordings uploading.
  it('never touches api_hangup_hook, and carries no ${} the calling leg would expand', () => {
    const s = buildBridgeString(chain, '8005551212', { legOutcomeReporting: true })!;
    expect(s).not.toContain('api_hangup_hook');
    expect(s).not.toContain('${');
  });
});
